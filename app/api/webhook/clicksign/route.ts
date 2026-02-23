import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  findOrderByClicksignIdentifiers,
  findOrderByEmail,
  getOrder,
  markOrderEnvelopeCreated,
  markOrderSigned,
  recordProcessedEvent,
  syncOrderClicksignData,
} from "@/app/lib/store";
import { recordClicksignWebhook } from "@/app/lib/metrics";

const WEBHOOK_SECRET = process.env.CLICKSIGN_WEBHOOK_SECRET;

function verifyHmac(body: string, headerHmac: string | null): boolean {
  if (!WEBHOOK_SECRET) return true;
  if (!headerHmac) return false;

  // Content-Hmac format: "sha256=<hex>"
  const expectedHex = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  const receivedHex = headerHmac.replace(/^sha256=/, "");

  if (!/^[a-f0-9]+$/i.test(receivedHex) || expectedHex.length !== receivedHex.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const contentHmac = req.headers.get("Content-Hmac");

  if (!verifyHmac(rawBody, contentHmac)) {
    console.warn("[WEBHOOK] HMAC invalido - rejeitado");
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName = pickFirstString(payload?.event?.name, payload?.name);
  const eventId = pickFirstString(payload?.event?.id, payload?.id);

  console.log(`[WEBHOOK] Evento recebido: ${eventName ?? "desconhecido"}`);

  if (eventName !== "sign" && eventName !== "add_signer") {
    console.log(`[WEBHOOK] Evento "${eventName}" ignorado`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  const isDuplicate = eventId ? !recordProcessedEvent("clicksign", eventId) : false;
  recordClicksignWebhook(eventName, isDuplicate);

  if (isDuplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const envelopeId = pickFirstString(
    payload?.event?.data?.envelope?.id,
    payload?.event?.data?.document?.relationships?.envelope?.data?.id,
    payload?.data?.envelope?.id
  );
  const documentId = pickFirstString(
    payload?.event?.data?.document?.id,
    payload?.event?.data?.document?.key,
    payload?.data?.document?.id
  );
  const signerId = pickFirstString(payload?.event?.data?.signer?.id, payload?.data?.signer?.id);
  const signerEmail = pickFirstString(payload?.event?.data?.signer?.email, payload?.data?.signer?.email);

  let order = findOrderByClicksignIdentifiers({
    envelopeId,
    documentId,
    signerId,
  });

  // Fallback temporario de migracao: busca por email.
  if (!order && signerEmail) {
    order = findOrderByEmail(signerEmail);
  }

  if (!order) {
    console.warn("[WEBHOOK] Nenhum pedido encontrado para correlacao");
    return NextResponse.json({ ok: true, message: "No matching order" });
  }

  if (envelopeId || documentId || signerId) {
    syncOrderClicksignData(order.id, {
      envelopeId,
      documentId,
      signerId,
    });
  }

  let currentOrder = getOrder(order.id);
  if (!currentOrder) {
    return NextResponse.json({ ok: false, error: "Order not found after sync" }, { status: 500 });
  }

  if (
    currentOrder.status === "pending" &&
    currentOrder.envelopeId &&
    currentOrder.documentId &&
    currentOrder.signerId
  ) {
    currentOrder = markOrderEnvelopeCreated(order.id, {
      envelopeId: currentOrder.envelopeId,
      documentId: currentOrder.documentId,
      signerId: currentOrder.signerId,
    })!;
  }

  if (eventName === "sign") {
    currentOrder = markOrderSigned(order.id) ?? currentOrder;
  }

  console.log(`[WEBHOOK] Pedido ${order.id} atualizado para status="${currentOrder.status}"`);

  return NextResponse.json({ ok: true, orderId: order.id, status: currentOrder.status });
}
