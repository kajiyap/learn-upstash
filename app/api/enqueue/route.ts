import { NextRequest, NextResponse } from "next/server";
import { validateCheckoutData } from "@/app/lib/checkout";
import { enqueueOrderBatch } from "@/app/lib/queue";
import { estimateDispatchWindowMs, formatDuration, getQueueConfig } from "@/app/lib/queue-config";
import { createOrder } from "@/app/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { quantity, checkoutData, productId, offerId } = await req.json();
    const parsedData = validateCheckoutData(checkoutData);
    const total = Number(quantity);

    if (!Number.isInteger(total) || total < 1 || total > 100) {
      return NextResponse.json(
        { success: false, error: "quantity deve ser um inteiro entre 1 e 100" },
        { status: 400 }
      );
    }

    const orders = Array.from({ length: total }).map((_, index) => {
      const emailSuffix = total === 1 ? "" : `+lote${index + 1}`;
      const [localPart, domainPart = "email.com"] = parsedData.email.split("@");

      return createOrder({
        checkoutData: {
          ...parsedData,
          email: `${localPart}${emailSuffix}@${domainPart}`,
        },
        productId: typeof productId === "string" ? productId : undefined,
        offerId: typeof offerId === "string" ? offerId : undefined,
      });
    });

    const queueConfig = getQueueConfig();
    const dispatchWindowMs = estimateDispatchWindowMs(total, queueConfig);
    const runFlowKey = `${queueConfig.flowKey}-batch-${Date.now()}`;
    console.log(
      `[ENQUEUE] total=${total} flowRate=${queueConfig.flowRate}/${queueConfig.flowPeriod} flowParallelism=${queueConfig.flowParallelism} retries=${queueConfig.retries} flowKey=${runFlowKey} estimated_dispatch_window=${formatDuration(dispatchWindowMs)}`
    );

    await enqueueOrderBatch({
      orderIds: orders.map((order) => order.id),
      flowKeyOverride: runFlowKey,
    });

    return NextResponse.json({
      success: true,
      enqueued: total,
      orderIds: orders.map((order) => order.id),
      flowKey: runFlowKey,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao enfileirar pedidos";
    const isValidationError =
      typeof message === "string" &&
      (message.includes("invalido") || message.includes("obrigatorio") || message.includes("quantity"));

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isValidationError ? 400 : 500 }
    );
  }

}
