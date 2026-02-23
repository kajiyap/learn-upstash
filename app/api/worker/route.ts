import { Receiver } from "@upstash/qstash";
import { NextRequest, NextResponse } from "next/server";
import {
  acquireWorkerLock,
  getOrder,
  markWorkerCompleted,
  markWorkerStarted,
  markOrderEnvelopeCreated,
  releaseWorkerLock,
} from "@/app/lib/store";
import {
  recordEndToEndEnvelope,
  recordWorkerFailed,
  recordWorkerIdempotent,
  recordWorkerStarted,
  recordWorkerSucceeded,
} from "@/app/lib/metrics";
import { getQueueConfig } from "@/app/lib/queue-config";

const receiver =
  process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;

// --- CONFIGURACAO ---------------------------------------------------------------
const TOKEN = process.env.CLICKSIGN_TOKEN!;
const BASE_URL = process.env.CLICKSIGN_BASE_URL || "https://sandbox.clicksign.com/api/v3";
const TEMPLATE_ID = process.env.CLICKSIGN_TEMPLATE_ID!;
let bulkRequirementsSupport: "unknown" | "supported" | "unsupported" = "unknown";

type ClicksignResourceResponse = {
  data: {
    id: string;
  };
};

type ClicksignError = Error & {
  status?: number;
  retryAfter?: string | null;
};

type WorkerPayload = {
  orderId?: string;
  index?: number;
  createdAt?: number;
};

// --- UTILITARIOS ----------------------------------------------------------------

function apiUrl(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${sep}access_token=${encodeURIComponent(TOKEN)}`;
}

async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const started = Date.now();
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  console.log(`  [POST ${path}] ${res.status} (${ms}ms)`);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Clicksign ${res.status}: ${text}`) as ClicksignError;
    err.status = res.status;
    err.retryAfter = res.headers.get("retry-after");
    throw err;
  }
  return res.json() as Promise<T>;
}

async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const started = Date.now();
  const res = await fetch(apiUrl(path), {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  console.log(`  [PATCH ${path}] ${res.status} (${ms}ms)`);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Clicksign ${res.status}: ${text}`) as ClicksignError;
    err.status = res.status;
    err.retryAfter = res.headers.get("retry-after");
    throw err;
  }
  return res.json() as Promise<T>;
}

// --- FLUXO REAL DO CLICKSIGN ----------------------------------------------------

async function clicksignCreateCompleteEnvelope(
  envelopeName: string,
  signerName: string,
  signerEmail: string,
  filename: string,
  templateData: Record<string, string>
): Promise<{ envelopeId: string; documentId: string; signerId: string }> {
  const queueConfig = getQueueConfig();
  // 1. Criar envelope
  const envRes = await apiPost<ClicksignResourceResponse>("/envelopes", {
    data: { type: "envelopes", attributes: { name: envelopeName } },
  });
  const envelopeId = envRes.data.id;
  console.log(`    envelope: ${envelopeId}`);

  // 2. Criar documento via template
  const docRes = await apiPost<ClicksignResourceResponse>(`/envelopes/${envelopeId}/documents`, {
    data: {
      type: "documents",
      attributes: {
        filename,
        template: { key: TEMPLATE_ID, data: templateData },
      },
    },
  });
  const documentId = docRes.data.id;
  console.log(`    document: ${documentId}`);

  // 3. Adicionar signatario
  const sigRes = await apiPost<ClicksignResourceResponse>(`/envelopes/${envelopeId}/signers`, {
    data: { type: "signers", attributes: { name: signerName, email: signerEmail } },
  });
  const signerId = sigRes.data.id;
  console.log(`    signer:   ${signerId}`);

  const requirementAgree = {
    type: "requirements",
    attributes: { action: "agree", role: "sign" },
    relationships: {
      document: { data: { type: "documents", id: documentId } },
      signer: { data: { type: "signers", id: signerId } },
    },
  };

  const requirementEvidence = {
    type: "requirements",
    attributes: { action: "provide_evidence", auth: "email" },
    relationships: {
      document: { data: { type: "documents", id: documentId } },
      signer: { data: { type: "signers", id: signerId } },
    },
  };

  // 4. Requisitos: preferir bulk (1 request). Fallback para modo legado (2 requests).
  if (queueConfig.clicksignBulkRequirementsEnabled && bulkRequirementsSupport !== "unsupported") {
    try {
      await apiPost(`/envelopes/${envelopeId}/bulk_requirements`, {
        "atomic:operations": [
          { op: "add", data: requirementAgree },
          { op: "add", data: requirementEvidence },
        ],
      });
      bulkRequirementsSupport = "supported";
      console.log("    requirements bulk: OK");
    } catch (error) {
      const parsedError = error as ClicksignError;
      if (
        typeof parsedError.status === "number" &&
        parsedError.status < 500 &&
        parsedError.status !== 429
      ) {
        bulkRequirementsSupport = "unsupported";
      }
      console.warn(
        `    requirements bulk falhou (${parsedError.status ?? "?"}) - fallback para modo legado`
      );

      await apiPost(`/envelopes/${envelopeId}/requirements`, {
        data: requirementAgree,
      });
      console.log("    requirement agree: OK");

      await apiPost(`/envelopes/${envelopeId}/requirements`, {
        data: requirementEvidence,
      });
      console.log("    requirement provide_evidence: OK");
    }
  } else {
    await apiPost(`/envelopes/${envelopeId}/requirements`, {
      data: requirementAgree,
    });
    console.log("    requirement agree: OK");

    await apiPost(`/envelopes/${envelopeId}/requirements`, {
      data: requirementEvidence,
    });
    console.log("    requirement provide_evidence: OK");
  }

  // 5. Ativar envelope (status: running)
  await apiPatch(`/envelopes/${envelopeId}`, {
    data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } },
  });
  console.log(`    envelope activated: OK`);

  // 6. Notificacao opcional (normalmente desnecessaria quando o widget esta embedado no fluxo).
  if (queueConfig.clicksignSendNotification) {
    await apiPost(`/envelopes/${envelopeId}/notifications`, {
      data: { type: "notifications", attributes: { message: "" } },
    });
    console.log(`    notification sent: OK`);
  }

  return { envelopeId, documentId, signerId };
}

function stringOrFallback(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// --- TEMPLATE DATA A PARTIR DO CHECKOUT DATA ------------------------------------

function buildTemplateData(data: Record<string, unknown>): Record<string, string> {
  const now = new Date();
  const street = stringOrFallback(data.street, "Rua nao informada");
  const number = stringOrFallback(data.number, "S/N");
  const complement = stringOrFallback(data.complement);
  const district = stringOrFallback(data.district, "Bairro nao informado");
  const city = stringOrFallback(data.city, "Cidade nao informada");
  const state = stringOrFallback(data.state, "UF");
  const cep = stringOrFallback(data.cep, "00000-000");
  const installmentsCount = numberOrFallback(data.selectedInstallmentsCount, 1);
  const installmentValue = numberOrFallback(data.selectedInstallmentValue, 0);
  const totalValue = numberOrFallback(data.selectedTotalValue, 0);
  const interestRate = numberOrFallback(data.selectedInterestRate, 0);

  return {
    nome: stringOrFallback(data.name, "Aluno"),
    cpf: stringOrFallback(data.cpf, "000.000.000-00"),
    endereco_completo: `${street}, ${number}${complement ? `, ${complement}` : ""} - ${district}, ${city}/${state} - CEP: ${cep}`,
    dia_hoje: now.getDate().toString().padStart(2, "0"),
    mes_hoje: (now.getMonth() + 1).toString().padStart(2, "0"),
    ano_hoje: now.getFullYear().toString(),
    plano_pagamento: `${installmentsCount}x de R$ ${installmentValue.toFixed(2)}`,
    preco_total: `R$ ${totalValue.toFixed(2)}`,
    valor_parcela: `R$ ${installmentValue.toFixed(2)}`,
    num_parcela: `${installmentsCount}x`,
    taxa_mensal_juros: interestRate.toFixed(2),
    taxa_anual_juros: (((1 + interestRate / 100) ** 12 - 1) * 100).toFixed(2),
    carga_horaria: stringOrFallback(data.cargaHoraria, "100 horas"),
    curso: stringOrFallback(data.curso, "Acelerador 2.0 - Curso completo + apostilas"),
    prazo_desistencia: stringOrFallback(data.prazoDesistencia, "7 dias"),
  };
}

async function verifyQstashSignature(rawBody: string, signature: string): Promise<boolean> {
  if (!receiver) {
    return true;
  }
  return receiver
    .verify({
      signature,
      body: rawBody,
      clockTolerance: 5,
    })
    .catch(() => false);
}

function safeNameForFilename(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- ROUTE HANDLER (worker chamado pelo QStash) ---------------------------------

export async function POST(req: NextRequest) {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  let orderId = "";

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("upstash-signature") ?? "";

    const isValid = await verifyQstashSignature(rawBody, signature);

    if (!isValid) {
      console.warn("  [WORKER] Assinatura invalida - request rejeitado");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as WorkerPayload;
    const { index = 0, createdAt, orderId: payloadOrderId } = body;

    if (!payloadOrderId || typeof payloadOrderId !== "string") {
      throw new Error("orderId nao recebido no body");
    }

    orderId = payloadOrderId;

    const enqueuedAt = new Date(
      typeof createdAt === "number" ? createdAt : Date.now()
    ).toISOString();
    console.log(
      `\n========== WORKER orderId=${orderId} | index=${index} | enqueued=${enqueuedAt} | started=${timestamp} ==========`
    );

    const order = getOrder(orderId);
    if (!order) {
      throw new Error(`Pedido ${orderId} nao encontrado`);
    }

    const workerStartedAtMs = Date.now();
    const fallbackEnqueuedAtMs =
      typeof createdAt === "number"
        ? createdAt
        : typeof order.metrics.enqueuedAtMs === "number"
          ? order.metrics.enqueuedAtMs
          : workerStartedAtMs;
    const queueLagMs = Math.max(0, workerStartedAtMs - fallbackEnqueuedAtMs);
    markWorkerStarted(orderId, workerStartedAtMs);
    recordWorkerStarted(orderId, queueLagMs);

    if (order.status !== "pending") {
      console.log(
        `  [WORKER] Pedido ${orderId} ja processado com status=${order.status}, ignorando retry`
      );
      recordWorkerIdempotent(orderId, "already_processed");
      return NextResponse.json({
        success: true,
        idempotent: true,
        orderId,
        status: order.status,
      });
    }

    if (!acquireWorkerLock(orderId)) {
      console.log(`  [WORKER] Pedido ${orderId} esta em processamento por outro worker`);
      recordWorkerIdempotent(orderId, "locked");
      return NextResponse.json({
        success: true,
        idempotent: true,
        locked: true,
        orderId,
      });
    }

    const checkoutData = order.checkoutData;
    if (!checkoutData.name || !checkoutData.email || !checkoutData.cpf) {
      releaseWorkerLock(orderId);
      throw new Error("Dados invalidos: name, email e cpf sao obrigatorios");
    }

    console.log("[1/2] Criando documento Clicksign...");
    const envelopeName = `Contrato - ${checkoutData.name} - ${new Date().toLocaleDateString(
      "pt-BR"
    )} - order${orderId}`;
    const safeName = safeNameForFilename(checkoutData.name);
    const filename = `contrato-${safeName}-job${index}.docx`;
    const templateData = buildTemplateData(checkoutData as unknown as Record<string, unknown>);

    const clicksign = await clicksignCreateCompleteEnvelope(
      envelopeName,
      checkoutData.name,
      checkoutData.email,
      filename,
      templateData
    );
    console.log("  ok clicksign completo");

    console.log("[2/2] Atualizando pedido...");
    const updatedOrder = markOrderEnvelopeCreated(orderId, {
      envelopeId: clicksign.envelopeId,
      documentId: clicksign.documentId,
      signerId: clicksign.signerId,
    });
    releaseWorkerLock(orderId);

    if (!updatedOrder) {
      throw new Error(`Falha ao atualizar pedido ${orderId}`);
    }

    console.log(`  ok pedido ${orderId} salvo como envelope_created`);

    const durationMs = Date.now() - started;
    markWorkerCompleted(orderId, durationMs);
    recordWorkerSucceeded(orderId, durationMs);
    if (
      typeof updatedOrder.metrics.enqueuedAtMs === "number" &&
      typeof updatedOrder.metrics.envelopeCreatedAtMs === "number"
    ) {
      const endToEndMs = updatedOrder.metrics.envelopeCreatedAtMs - updatedOrder.metrics.enqueuedAtMs;
      recordEndToEndEnvelope(orderId, endToEndMs);
    }

    console.log(
      `  [METRIC] orderId=${orderId} queueLagMs=${Math.round(queueLagMs)} workerDurationMs=${durationMs}`
    );
    console.log(`  => Worker orderId=${orderId} concluido em ${durationMs}ms`);

    return NextResponse.json({
      success: true,
      index,
      orderId,
      durationMs,
      clicksign,
    });
  } catch (error: unknown) {
    if (orderId) {
      releaseWorkerLock(orderId);
    }

    const durationMs = Date.now() - started;
    const parsedError = error as ClicksignError;
    const message = parsedError?.message || String(error);
    const is429 = parsedError?.status === 429;
    recordWorkerFailed(orderId || undefined, is429, message);

    console.error(`  WORKER FALHOU${is429 ? " (429 RATE LIMITED)" : ""}: ${message}`);

    // Retorna 429/500 para que o QStash faça retry automaticamente
    const headers: HeadersInit = {};
    if (is429 && parsedError?.retryAfter) {
      headers["Retry-After"] = parsedError.retryAfter;
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
        rateLimited: is429,
        retryAfter: parsedError?.retryAfter ?? null,
        durationMs,
      },
      { status: is429 ? 429 : 500, headers }
    );
  }
}
