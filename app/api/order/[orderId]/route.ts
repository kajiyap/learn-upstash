import { NextResponse } from "next/server";
import { getOrder } from "@/app/lib/store";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ orderId: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { orderId } = await params;
  const order = getOrder(orderId);

  if (!order) {
    return NextResponse.json({ success: false, error: "Pedido nao encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    order: {
      id: order.id,
      status: order.status,
      name: order.name,
      email: order.email,
      productId: order.productId,
      offerId: order.offerId,
      envelopeId: order.envelopeId ?? null,
      documentId: order.documentId ?? null,
      signerId: order.signerId ?? null,
      hotmartTransactionId: order.hotmartTransactionId ?? null,
      metrics: order.metrics,
      checkoutData: order.checkoutData,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  });
}
