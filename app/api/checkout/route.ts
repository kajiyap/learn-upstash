import { NextRequest, NextResponse } from "next/server";
import { validateCheckoutData } from "@/app/lib/checkout";
import { createOrder } from "@/app/lib/store";
import { enqueueOrderJob } from "@/app/lib/queue";
import { getQueueConfig } from "@/app/lib/queue-config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const checkoutData = validateCheckoutData(body?.checkoutData);

    const order = createOrder({
      checkoutData,
      productId: typeof body?.productId === "string" ? body.productId : undefined,
      offerId: typeof body?.offerId === "string" ? body.offerId : undefined,
    });

    await enqueueOrderJob({ orderId: order.id });
    const queueConfig = getQueueConfig();
    console.log(
      `[CHECKOUT] orderId=${order.id} enqueued flowRate=${queueConfig.flowRate}/${queueConfig.flowPeriod} flowParallelism=${queueConfig.flowParallelism}`
    );

    return NextResponse.json({
      success: true,
      orderId: order.id,
      status: order.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao criar checkout";
    const isValidationError =
      typeof message === "string" &&
      (message.includes("invalido") || message.includes("obrigatorio"));

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isValidationError ? 400 : 500 }
    );
  }
}
