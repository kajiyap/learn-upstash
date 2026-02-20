import { Receiver } from "@upstash/qstash";
import { NextRequest, NextResponse } from "next/server";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

// --- CONFIGURACAO ---------------------------------------------------------------
const TOKEN = process.env.CLICKSIGN_TOKEN!;
const BASE_URL = process.env.CLICKSIGN_BASE_URL || "https://sandbox.clicksign.com/api/v3";
const TEMPLATE_ID = process.env.CLICKSIGN_TEMPLATE_ID!;

// --- UTILITARIOS ----------------------------------------------------------------

function apiUrl(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${sep}access_token=${encodeURIComponent(TOKEN)}`;
}

async function apiPost<T = any>(path: string, body: unknown): Promise<T> {
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
    const err = new Error(`Clicksign ${res.status}: ${text}`);
    (err as any).status = res.status;
    (err as any).retryAfter = res.headers.get("retry-after");
    throw err;
  }
  return res.json() as Promise<T>;
}

async function apiPatch<T = any>(path: string, body: unknown): Promise<T> {
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
    const err = new Error(`Clicksign ${res.status}: ${text}`);
    (err as any).status = res.status;
    (err as any).retryAfter = res.headers.get("retry-after");
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
  // 1. Criar envelope
  const envRes: any = await apiPost("/envelopes", {
    data: { type: "envelopes", attributes: { name: envelopeName } },
  });
  const envelopeId: string = envRes.data.id;
  console.log(`    envelope: ${envelopeId}`);

  // 2. Criar documento via template
  const docRes: any = await apiPost(`/envelopes/${envelopeId}/documents`, {
    data: {
      type: "documents",
      attributes: {
        filename,
        template: { key: TEMPLATE_ID, data: templateData },
      },
    },
  });
  const documentId: string = docRes.data.id;
  console.log(`    document: ${documentId}`);

  // 3. Adicionar signatario
  const sigRes: any = await apiPost(`/envelopes/${envelopeId}/signers`, {
    data: { type: "signers", attributes: { name: signerName, email: signerEmail } },
  });
  const signerId: string = sigRes.data.id;
  console.log(`    signer:   ${signerId}`);

  // 4. Requirement: agree (role: sign)
  await apiPost(`/envelopes/${envelopeId}/requirements`, {
    data: {
      type: "requirements",
      attributes: { action: "agree", role: "sign" },
      relationships: {
        document: { data: { type: "documents", id: documentId } },
        signer: { data: { type: "signers", id: signerId } },
      },
    },
  });
  console.log(`    requirement agree: OK`);

  // 5. Requirement: provide_evidence (auth: email)
  await apiPost(`/envelopes/${envelopeId}/requirements`, {
    data: {
      type: "requirements",
      attributes: { action: "provide_evidence", auth: "email" },
      relationships: {
        document: { data: { type: "documents", id: documentId } },
        signer: { data: { type: "signers", id: signerId } },
      },
    },
  });
  console.log(`    requirement provide_evidence: OK`);

  // 6. Ativar envelope (status: running)
  await apiPatch(`/envelopes/${envelopeId}`, {
    data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } },
  });
  console.log(`    envelope activated: OK`);

  return { envelopeId, documentId, signerId };
}

// --- TEMPLATE DATA A PARTIR DO CHECKOUT DATA ------------------------------------

function buildTemplateData(data: any): Record<string, string> {
  const now = new Date();
  return {
    nome: data.name,
    cpf: data.cpf,
    endereco_completo: `${data.street}, ${data.number}${data.complement ? `, ${data.complement}` : ""} - ${data.district}, ${data.city}/${data.state} - CEP: ${data.cep}`,
    dia_hoje: now.getDate().toString().padStart(2, "0"),
    mes_hoje: (now.getMonth() + 1).toString().padStart(2, "0"),
    ano_hoje: now.getFullYear().toString(),
    plano_pagamento: `${data.selectedInstallmentsCount}x de R$ ${Number(data.selectedInstallmentValue).toFixed(2)}`,
    preco_total: `R$ ${Number(data.selectedTotalValue).toFixed(2)}`,
    valor_parcela: `R$ ${Number(data.selectedInstallmentValue).toFixed(2)}`,
    num_parcela: `${data.selectedInstallmentsCount}x`,
    taxa_mensal_juros: Number(data.selectedInterestRate).toFixed(2),
    taxa_anual_juros: (((1 + Number(data.selectedInterestRate) / 100) ** 12 - 1) * 100).toFixed(2),
    carga_horaria: data.cargaHoraria || "100 horas",
    curso: data.curso || "Acelerador 2.0 - Curso completo + apostilas",
    prazo_desistencia: data.prazoDesistencia || "7 dias",
  };
}

// --- ROUTE HANDLER (worker chamado pelo QStash) ---------------------------------

export async function POST(req: NextRequest) {
  const started = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // Verificar assinatura do QStash
    const rawBody = await req.text();
    const signature = req.headers.get("upstash-signature") ?? "";

    const isValid = await receiver.verify({
      signature,
      body: rawBody,
      clockTolerance: 5,
    }).catch(() => false);

    if (!isValid) {
      console.warn("  [WORKER] Assinatura invalida — request rejeitado");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const { index, createdAt, checkoutData } = body;

    console.log(`\n========== WORKER index=${index} | enqueued=${new Date(createdAt).toISOString()} | started=${timestamp} ==========`);

    if (!checkoutData) {
      throw new Error("checkoutData nao recebido no body");
    }

    // ETAPA 1: Validar dados basicos
    console.log("[1/3] Validando dados...");
    if (!checkoutData.name || !checkoutData.email || !checkoutData.cpf) {
      throw new Error("Dados invalidos: name, email e cpf sao obrigatorios");
    }
    console.log("  ok dados validos");

    // ETAPA 2: Criar documento Clicksign (REAL)
    console.log("[2/3] Criando documento Clicksign...");
    const envelopeName = `Contrato - ${checkoutData.name} - ${new Date().toLocaleDateString("pt-BR")} - job${index}`;
    const safeName = checkoutData.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-");
    const filename = `contrato-${safeName}-job${index}.docx`;
    const templateData = buildTemplateData(checkoutData);

    const clicksign = await clicksignCreateCompleteEnvelope(
      envelopeName,
      checkoutData.name,
      checkoutData.email,
      filename,
      templateData
    );
    console.log("  ok clicksign completo");

    // ETAPA 3: Finalizar (aqui voce pode chamar seu DB real)
    console.log("[3/3] Finalizando...");
    // TODO: salvar clicksign.envelopeId / documentId / signerId no banco
    console.log("  ok finalizado");

    const durationMs = Date.now() - started;
    console.log(`  => Worker index=${index} concluido em ${durationMs}ms`);

    return NextResponse.json({
      success: true,
      index,
      durationMs,
      clicksign,
    });
  } catch (error: any) {
    const durationMs = Date.now() - started;
    const is429 = error?.status === 429;

    console.error(`  WORKER FALHOU${is429 ? " (429 RATE LIMITED)" : ""}: ${error?.message}`);

    // Retorna 500 para que o QStash faça retry automaticamente
    return NextResponse.json(
      {
        success: false,
        error: error?.message || String(error),
        rateLimited: is429,
        retryAfter: error?.retryAfter ?? null,
        durationMs,
      },
      { status: is429 ? 429 : 500 }
    );
  }
}