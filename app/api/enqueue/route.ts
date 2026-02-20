import { Client } from "@upstash/qstash";
import { NextRequest, NextResponse } from "next/server";

const client = new Client({
  token: process.env.QSTASH_TOKEN!,
});

const queueName = "fila-rate-limit-test";

export async function POST(req: NextRequest) {
  const { quantity, checkoutData } = await req.json();

  if (!checkoutData) {
    return NextResponse.json(
      { success: false, error: "checkoutData é obrigatório" },
      { status: 400 }
    );
  }

  await client.queue({ queueName }).upsert({
    parallelism: 1,
  });

  const workerUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/worker`;
  const jobs = [];

  for (let i = 0; i < quantity; i++) {
    jobs.push(
      client.queue({ queueName: queueName }).enqueueJSON({
        url: workerUrl,
        body: {
          index: i,
          createdAt: Date.now(),
          checkoutData,
        },
        retries: 3,
      })
    );
  }

  await Promise.all(jobs);

  return NextResponse.json({
    success: true,
    enqueued: quantity,
  });
}