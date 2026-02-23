import { NextResponse } from "next/server";
import { resetMetrics } from "@/app/lib/metrics";
import { resetStore } from "@/app/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  resetStore();
  resetMetrics();
  return NextResponse.json({ success: true });
}
