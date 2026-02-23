import { NextResponse } from "next/server";
import { listOrders } from "@/app/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = listOrders();
  const summary = {
    total: orders.length,
    pending: orders.filter((order) => order.status === "pending").length,
    envelope_created: orders.filter((order) => order.status === "envelope_created").length,
    signed: orders.filter((order) => order.status === "signed").length,
    paid: orders.filter((order) => order.status === "paid").length,
  };
  return NextResponse.json({ orders, summary });
}
