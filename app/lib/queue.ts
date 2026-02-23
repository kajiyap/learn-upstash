import { Client } from "@upstash/qstash";
import { recordEnqueue } from "@/app/lib/metrics";
import { getQueueConfig } from "@/app/lib/queue-config";
import { markOrderEnqueued } from "@/app/lib/store";

let cachedClient: Client | null = null;
let queueSetupSignature: string | null = null;
let queueSetupAtMs = 0;

function getClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN nao configurado");
  }
  if (!cachedClient) {
    cachedClient = new Client({ token });
  }
  return cachedClient;
}

function getWorkerUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_BASE_URL nao configurado");
  }
  return `${baseUrl}/api/worker`;
}

function getQueueSetupSignature(config: ReturnType<typeof getQueueConfig>): string {
  return `${config.queueName}:${config.queueParallelism}`;
}

async function ensureQueueConfigured(
  client: Client,
  config: ReturnType<typeof getQueueConfig>
): Promise<void> {
  const signature = getQueueSetupSignature(config);
  const now = Date.now();

  if (queueSetupSignature === signature && now - queueSetupAtMs < 60_000) {
    return;
  }

  await client.queue({ queueName: config.queueName }).upsert({
    parallelism: config.queueParallelism,
  });

  queueSetupSignature = signature;
  queueSetupAtMs = now;
}

type EnqueueParams = {
  orderId: string;
  index?: number;
  createdAtMs?: number;
  flowKeyOverride?: string;
};

async function publishOrderJob(
  client: Client,
  config: ReturnType<typeof getQueueConfig>,
  params: EnqueueParams
): Promise<void> {
  const createdAtMs = params.createdAtMs ?? Date.now();

  await client.publishJSON({
    url: getWorkerUrl(),
    body: {
      orderId: params.orderId,
      index: params.index ?? 0,
      createdAt: createdAtMs,
    },
    retries: config.retries,
    flowControl: {
      key: params.flowKeyOverride || config.flowKey,
      rate: config.flowRate,
      period: config.flowPeriod,
      parallelism: config.flowParallelism,
    },
  });

  markOrderEnqueued(params.orderId, createdAtMs);
  recordEnqueue(params.orderId);
}

export async function enqueueOrderJob(params: {
  orderId: string;
  index?: number;
}): Promise<void> {
  const client = getClient();
  const config = getQueueConfig();
  await ensureQueueConfigured(client, config);
  await publishOrderJob(client, config, params);
}

export async function enqueueOrderBatch(params: {
  orderIds: string[];
  flowKeyOverride?: string;
}): Promise<void> {
  const client = getClient();
  const config = getQueueConfig();
  await ensureQueueConfigured(client, config);

  const createdAtMs = Date.now();
  await Promise.all(
    params.orderIds.map((orderId, index) =>
      publishOrderJob(client, config, {
        orderId,
        index,
        createdAtMs,
        flowKeyOverride: params.flowKeyOverride,
      })
    )
  );
}
