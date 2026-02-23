import { NextResponse } from "next/server";
import { getMetricsSnapshot } from "@/app/lib/metrics";
import { estimateDispatchWindowMs, formatDuration, getQueueConfig } from "@/app/lib/queue-config";
import { listOrders } from "@/app/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = listOrders();
  const orderCounts = {
    total: orders.length,
    pending: orders.filter((order) => order.status === "pending").length,
    envelope_created: orders.filter((order) => order.status === "envelope_created").length,
    signed: orders.filter((order) => order.status === "signed").length,
    paid: orders.filter((order) => order.status === "paid").length,
  };

  const queueConfig = getQueueConfig();
  const pendingDispatchWindowMs = estimateDispatchWindowMs(orderCounts.pending, queueConfig);
  const snapshot = getMetricsSnapshot({ orderCounts });

  return NextResponse.json({
    ...snapshot,
    queueEstimates: {
      pendingDispatchWindowMs,
      pendingDispatchWindowFormatted: formatDuration(pendingDispatchWindowMs),
    },
  });
}
