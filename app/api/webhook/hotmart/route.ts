import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { findOrderByEmail, getOrder, markOrderPaid, recordProcessedEvent } from "@/app/lib/store";
import { recordHotmartWebhook } from "@/app/lib/metrics";

const WEBHOOK_SECRET = process.env.HOTMART_WEBHOOK_SECRET;

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function verifyHmac(body: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) return true;
  if (!signature) return false;

  const expectedHex = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  const receivedHex = signature.replace(/^sha256=/, "");

  if (!/^[a-f0-9]+$/i.test(receivedHex) || expectedHex.length !== receivedHex.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}

function isPaidStatus(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized === "paid" || normalized === "approved" || normalized === "billet_printed";
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hotmart-signature");

  if (!verifyHmac(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const status = pickFirstString(payload?.status, payload?.purchase?.status, payload?.event);

  if (!isPaidStatus(status)) {
    recordHotmartWebhook(false, false);
    return NextResponse.json({ ok: true, ignored: true, status });
  }

  const orderId = pickFirstString(payload?.orderId, payload?.metadata?.orderId, payload?.data?.orderId);
  const transactionId = pickFirstString(
    payload?.transactionId,
    payload?.purchase?.transaction,
    payload?.data?.transactionId
  );
  const buyerEmail = pickFirstString(payload?.buyer?.email, payload?.data?.buyer?.email);

  const isDuplicate = transactionId ? !recordProcessedEvent("hotmart", transactionId) : false;
  recordHotmartWebhook(true, isDuplicate);

  if (isDuplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let order = orderId ? getOrder(orderId) : null;

  // Fallback temporario apenas para testes e migracao.
  if (!order && buyerEmail) {
    order = findOrderByEmail(buyerEmail);
  }

  if (!order) {
    return NextResponse.json({ ok: true, message: "No matching order" });
  }

  const updatedOrder = markOrderPaid(order.id, transactionId) ?? order;

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    status: updatedOrder.status,
    transactionId: transactionId ?? null,
  });
}
