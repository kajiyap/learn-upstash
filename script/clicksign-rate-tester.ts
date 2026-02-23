/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Clicksign rate tester - FLUXO REAL DA APLICACAO
 *
 * Espelha exatamente o fluxo de checkout-with-progress.ts:
 *   1. validateCheckoutData   -> stub (apenas validacao Zod, sem DB)
 *   2. createCheckoutEnvelope -> stub (retorna fake orderId, sem DB)
 *   3. createCheckoutDocument -> REAL (Clicksign: envelope + template + signer + requirements + activate)
 *   4. finalizeCheckoutOrder  -> stub (noop, sem DB)
 *
 * Edite as constantes de configuracao abaixo e rode com:
 *   pnpm tsx scripts/clicksign-rate-tester.ts
 */

import process from "process";
import "dotenv/config";

// --- CONFIGURACAO ---------------------------------------------------------------
const TOKEN       = process.env.CLICKSIGN_TOKEN ?? "";
const BASE_URL    = process.env.CLICKSIGN_BASE_URL ?? "https://sandbox.clicksign.com/api/v3";
const TEMPLATE_ID = process.env.CLICKSIGN_TEMPLATE_ID ?? "";

// Quantas vezes rodar o fluxo completo.
// Aumente REPEAT para descobrir em qual iteracao comeca o 429.
const REPEAT = 5;

// --- DADOS ESTATICOS DE CHECKOUT (espelha CreateCheckoutOrderInput) -------------
// Substituem o formulario preenchido pelo aluno; DB nao e chamado.
const CHECKOUT_DATA = {
  name: "Joao da Silva Teste",
  email: "joao.teste@email.com",
  phone: "(11) 99999-0001",
  cpf: "111.222.333-04",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Apto 42",
  district: "Bela Vista",
  city: "Sao Paulo",
  state: "SP",
  dueDay: "10" as const,
  installmentPlan: "12x",
  consent: true,
  emphasis: "tecnico-em-enfermagem",
  url: "https://checkout.example.com/test",
  utmSource: "rate-tester",
  selectedInstallmentsCount: 12,
  selectedInstallmentValue: 144.68,
  selectedTotalValue: 1736.16,
  selectedInterestRate: 2.1,
};

// Template data fixo (substitui calculos de oferta/produto do DB)
const TEMPLATE_DATA: Record<string, string> = {
  nome:              CHECKOUT_DATA.name,
  cpf:               CHECKOUT_DATA.cpf,
  endereco_completo: `${CHECKOUT_DATA.street}, ${CHECKOUT_DATA.number}${CHECKOUT_DATA.complement ? `, ${CHECKOUT_DATA.complement}` : ""} - ${CHECKOUT_DATA.district}, ${CHECKOUT_DATA.city}/${CHECKOUT_DATA.state} - CEP: ${CHECKOUT_DATA.cep}`,
  dia_hoje:          new Date().getDate().toString().padStart(2, "0"),
  mes_hoje:          (new Date().getMonth() + 1).toString().padStart(2, "0"),
  ano_hoje:          new Date().getFullYear().toString(),
  plano_pagamento:   `${CHECKOUT_DATA.selectedInstallmentsCount}x de R$ ${CHECKOUT_DATA.selectedInstallmentValue.toFixed(2)}`,
  preco_total:       `R$ ${CHECKOUT_DATA.selectedTotalValue.toFixed(2)}`,
  valor_parcela:     `R$ ${CHECKOUT_DATA.selectedInstallmentValue.toFixed(2)}`,
  num_parcela:       `${CHECKOUT_DATA.selectedInstallmentsCount}x`,
  taxa_mensal_juros: CHECKOUT_DATA.selectedInterestRate.toFixed(2),
  taxa_anual_juros:  (((1 + CHECKOUT_DATA.selectedInterestRate / 100) ** 12 - 1) * 100).toFixed(2),
  carga_horaria:     "100 horas",
  curso:             "Acelerador 2.0 - Curso completo + apostilas",
  prazo_desistencia: "7 dias",
};

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

// --- STUBS (substituem chamadas ao DB) ------------------------------------------

function stubValidateCheckoutData(data: typeof CHECKOUT_DATA) {
  if (!data.name || !data.email || !data.cpf) {
    return { success: false as const, error: "Dados invalidos no stub" };
  }
  return { success: true as const, data };
}

function stubCreateCheckoutEnvelope(_data: typeof CHECKOUT_DATA) {
  return { success: true as const, data: { id: 99999 } };
}

function stubFinalizeCheckoutOrder(_params: {
  orderId: string;
  clicksignData: { envelopeId: string; documentId: string; signerId: string };
}) {
  return { success: true as const };
}

// --- FLUXO REAL DO CLICKSIGN (espelha createCompleteEnvelopeWithNewTemplate) ----

async function clicksignCreateCompleteEnvelope(
  envelopeName: string,
  signerName: string,
  signerEmail: string,
  filename: string,
  templateData: Record<string, string>,
): Promise<{ envelopeId: string; documentId: string; signerId: string }> {
  // 1. Criar envelope
  const envRes: any = await apiPost("/envelopes", {
    data: { type: "envelopes", attributes: { name: envelopeName } },
  });
  const envelopeId: string = envRes.data.id;
  console.log(`    envelope: ${envelopeId}`);

  // 2. Criar documento via template (createDocumentFromTemplate)
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
        signer:   { data: { type: "signers",   id: signerId   } },
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
        signer:   { data: { type: "signers",   id: signerId   } },
      },
    },
  });
  console.log(`    requirement provide_evidence: OK`);

  // 6. Ativar envelope (status: running)
  await apiPatch(`/envelopes/${envelopeId}`, {
    data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } },
  });
  console.log(`    envelope activated: OK`);

  // 7. Disparar notificação por email ao signatário
  await apiPost(`/envelopes/${envelopeId}/notifications`, {
    data: { type: "notifications", attributes: { message: "" } },
  });
  console.log(`    notification sent: OK`);

  return { envelopeId, documentId, signerId };
}

// --- FLUXO PRINCIPAL (espelha createCheckoutWithProgress) -----------------------

type RunResult = {
  iteration: number;
  success: boolean;
  durationMs: number;
  error?: string;
  rateLimited?: boolean;
  retryAfter?: string | null;
  clicksign?: { envelopeId: string; documentId: string; signerId: string };
  timestamp: string;
};

async function runCheckoutFlow(iteration: number): Promise<RunResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`\n========== ITERACAO ${iteration} -- ${timestamp} ==========`);

  try {
    // ETAPA 1: validateCheckoutData (stub)
    console.log("[1/4] Validando dados...");
    const validation = stubValidateCheckoutData(CHECKOUT_DATA);
    if (!validation.success) throw new Error(validation.error);
    console.log("  ok dados validos");

    // ETAPA 2: createCheckoutEnvelope (stub --- sem DB)
    console.log("[2/4] Criando envelope no DB (stub)...");
    const envelopeStub = stubCreateCheckoutEnvelope(CHECKOUT_DATA);
    if (!envelopeStub.success) throw new Error("Stub falhou");
    const fakeOrderId = envelopeStub.data.id.toString();
    console.log(`  ok fake orderId: ${fakeOrderId}`);

    // ETAPA 3: createCheckoutDocument (REAL --- Clicksign)
    console.log("[3/4] Criando documento Clicksign (REAL)...");
    const envelopeName = `Contrato - ${CHECKOUT_DATA.name} - ${new Date().toLocaleDateString("pt-BR")} - iter${iteration}`;
    const filename = `contrato-joao-da-silva-teste-iter${iteration}.docx`;

    const clicksign = await clicksignCreateCompleteEnvelope(
      envelopeName,
      CHECKOUT_DATA.name,
      CHECKOUT_DATA.email,
      filename,
      TEMPLATE_DATA,
    );
    console.log("  ok clicksign completo");

    // ETAPA 4: finalizeCheckoutOrder (stub --- sem DB)
    console.log("[4/4] Finalizando pedido no DB (stub)...");
    const finalizeResult = stubFinalizeCheckoutOrder({
      orderId: fakeOrderId,
      clicksignData: clicksign,
    });
    if (!finalizeResult.success) throw new Error("Stub de finalizacao falhou");
    console.log("  ok finalizado");

    const durationMs = Date.now() - started;
    console.log(`  => Iteracao ${iteration} concluida em ${durationMs}ms`);

    return { iteration, success: true, durationMs, clicksign, timestamp };
  } catch (error: any) {
    const durationMs = Date.now() - started;
    const is429 = error?.status === 429;
    const retryAfter: string | null = error?.retryAfter ?? null;

    console.error(`  FALHOU iter ${iteration}${is429 ? " (429 RATE LIMITED)" : ""}: ${error?.message}`);
    if (retryAfter) console.error(`    Retry-After: ${retryAfter}`);

    return {
      iteration,
      success: false,
      durationMs,
      error: error?.message || String(error),
      rateLimited: is429,
      retryAfter,
      timestamp,
    };
  }
}

// --- MAIN -----------------------------------------------------------------------

async function main() {
  console.log("Clicksign Rate Tester -- Fluxo Real da Aplicacao");
  console.log(`  API:       ${BASE_URL}`);
  console.log(`  Template:  ${TEMPLATE_ID}`);
  console.log(`  Iteracoes: ${REPEAT}`);
  console.log("");

  if (!TOKEN || !TEMPLATE_ID) {
    console.error("ERRO: Configure CLICKSIGN_TOKEN e CLICKSIGN_TEMPLATE_ID no .env.local!");
    process.exit(1);
  }

  const results: RunResult[] = [];

  for (let i = 1; i <= REPEAT; i++) {
    const result = await runCheckoutFlow(i);
    results.push(result);

    // Para imediatamente ao encontrar o primeiro 429
    if (result.rateLimited) {
      console.log(`\nRate limit atingido na iteracao ${i}. Parando.`);
      break;
    }
  }

  // --- RESUMO ------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("RESUMO FINAL");
  console.log("=".repeat(60));

  const ok  = results.filter((r) => r.success).length;
  const err = results.filter((r) => !r.success && !r.rateLimited).length;
  const rl  = results.filter((r) => r.rateLimited).length;
  console.log(`Total: ${results.length} | Sucesso: ${ok} | Erro: ${err} | 429: ${rl}`);

  for (const r of results) {
    const icon = r.success ? "OK " : r.rateLimited ? "429" : "ERR";
    console.log(
      `  [${icon}] iter ${r.iteration} | ${r.durationMs}ms` +
      (r.clicksign ? ` | envelopeId=${r.clicksign.envelopeId}` : "") +
      (r.error ? ` | ${r.error}` : "") +
      (r.retryAfter ? ` | retry-after=${r.retryAfter}` : ""),
    );
  }

  const firstRl = results.find((r) => r.rateLimited);
  if (firstRl) {
    console.log(`\nPrimeiro 429 na iteracao ${firstRl.iteration} (${firstRl.timestamp})`);
  } else {
    console.log(`\nNenhum 429 nas ${results.length} iteracoes.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
