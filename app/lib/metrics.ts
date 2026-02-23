import { estimateAverageClicksignRps, getQueueConfig } from "@/app/lib/queue-config";

type MetricsEvent = {
  at: string;
  type: string;
  orderId?: string;
  detail?: string;
};

type SampleBucket = {
  samples: number[];
  count: number;
  sum: number;
  max: number;
  min: number;
};

type RuntimeMetrics = {
  startedAtMs: number;
  enqueuedTotal: number;
  workerStartedTotal: number;
  workerSucceededTotal: number;
  workerFailedTotal: number;
  workerRateLimitedTotal: number;
  workerLockedTotal: number;
  workerIdempotentTotal: number;
  clicksignWebhookReceivedTotal: number;
  clicksignWebhookSignTotal: number;
  clicksignWebhookAddSignerTotal: number;
  clicksignWebhookDuplicateTotal: number;
  hotmartWebhookReceivedTotal: number;
  hotmartWebhookPaidTotal: number;
  hotmartWebhookDuplicateTotal: number;
  queueLagMs: SampleBucket;
  workerDurationMs: SampleBucket;
  endToEndToEnvelopeMs: SampleBucket;
  lastEvents: MetricsEvent[];
};

type SnapshotStats = {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
};

const MAX_SAMPLES = 1000;
const MAX_EVENTS = 120;

const globalMetrics = globalThis as unknown as {
  __runtimeMetrics?: RuntimeMetrics;
};

function createSampleBucket(): SampleBucket {
  return {
    samples: [],
    count: 0,
    sum: 0,
    max: 0,
    min: 0,
  };
}

function createRuntimeMetrics(): RuntimeMetrics {
  return {
    startedAtMs: Date.now(),
    enqueuedTotal: 0,
    workerStartedTotal: 0,
    workerSucceededTotal: 0,
    workerFailedTotal: 0,
    workerRateLimitedTotal: 0,
    workerLockedTotal: 0,
    workerIdempotentTotal: 0,
    clicksignWebhookReceivedTotal: 0,
    clicksignWebhookSignTotal: 0,
    clicksignWebhookAddSignerTotal: 0,
    clicksignWebhookDuplicateTotal: 0,
    hotmartWebhookReceivedTotal: 0,
    hotmartWebhookPaidTotal: 0,
    hotmartWebhookDuplicateTotal: 0,
    queueLagMs: createSampleBucket(),
    workerDurationMs: createSampleBucket(),
    endToEndToEnvelopeMs: createSampleBucket(),
    lastEvents: [],
  };
}

function getRuntimeMetrics(): RuntimeMetrics {
  if (!globalMetrics.__runtimeMetrics) {
    globalMetrics.__runtimeMetrics = createRuntimeMetrics();
  }
  return globalMetrics.__runtimeMetrics;
}

function pushEvent(type: string, orderId?: string, detail?: string): void {
  const metrics = getRuntimeMetrics();
  metrics.lastEvents.unshift({
    at: new Date().toISOString(),
    type,
    orderId,
    detail,
  });
  if (metrics.lastEvents.length > MAX_EVENTS) {
    metrics.lastEvents.length = MAX_EVENTS;
  }
}

function addSample(bucket: SampleBucket, value: number): void {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  bucket.samples.push(safeValue);
  bucket.count += 1;
  bucket.sum += safeValue;
  bucket.max = bucket.count === 1 ? safeValue : Math.max(bucket.max, safeValue);
  bucket.min = bucket.count === 1 ? safeValue : Math.min(bucket.min, safeValue);

  if (bucket.samples.length > MAX_SAMPLES) {
    bucket.samples.splice(0, bucket.samples.length - MAX_SAMPLES);
  }
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(bucket: SampleBucket): SnapshotStats {
  if (bucket.count === 0) {
    return { count: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0 };
  }
  return {
    count: bucket.count,
    avg: Math.round(bucket.sum / bucket.count),
    min: Math.round(bucket.min),
    max: Math.round(bucket.max),
    p50: Math.round(percentile(bucket.samples, 50)),
    p95: Math.round(percentile(bucket.samples, 95)),
  };
}

export function recordEnqueue(orderId: string): void {
  const metrics = getRuntimeMetrics();
  metrics.enqueuedTotal += 1;
  pushEvent("enqueue", orderId);
}

export function recordWorkerStarted(orderId: string, queueLagMs: number): void {
  const metrics = getRuntimeMetrics();
  metrics.workerStartedTotal += 1;
  addSample(metrics.queueLagMs, queueLagMs);
  pushEvent("worker_started", orderId, `queueLagMs=${Math.round(queueLagMs)}`);
}

export function recordWorkerSucceeded(orderId: string, workerDurationMs: number): void {
  const metrics = getRuntimeMetrics();
  metrics.workerSucceededTotal += 1;
  addSample(metrics.workerDurationMs, workerDurationMs);
  pushEvent("worker_succeeded", orderId, `durationMs=${Math.round(workerDurationMs)}`);
}

export function recordWorkerFailed(orderId: string | undefined, isRateLimited: boolean, detail: string): void {
  const metrics = getRuntimeMetrics();
  metrics.workerFailedTotal += 1;
  if (isRateLimited) {
    metrics.workerRateLimitedTotal += 1;
  }
  pushEvent("worker_failed", orderId, detail);
}

export function recordWorkerIdempotent(orderId: string, type: "locked" | "already_processed"): void {
  const metrics = getRuntimeMetrics();
  metrics.workerIdempotentTotal += 1;
  if (type === "locked") {
    metrics.workerLockedTotal += 1;
  }
  pushEvent("worker_idempotent", orderId, type);
}

export function recordEndToEndEnvelope(orderId: string, elapsedMs: number): void {
  const metrics = getRuntimeMetrics();
  addSample(metrics.endToEndToEnvelopeMs, elapsedMs);
  pushEvent("order_envelope_created", orderId, `elapsedMs=${Math.round(elapsedMs)}`);
}

export function recordClicksignWebhook(eventName: string, duplicate: boolean): void {
  const metrics = getRuntimeMetrics();
  metrics.clicksignWebhookReceivedTotal += 1;
  if (eventName === "sign") metrics.clicksignWebhookSignTotal += 1;
  if (eventName === "add_signer") metrics.clicksignWebhookAddSignerTotal += 1;
  if (duplicate) metrics.clicksignWebhookDuplicateTotal += 1;
}

export function recordHotmartWebhook(isPaid: boolean, duplicate: boolean): void {
  const metrics = getRuntimeMetrics();
  metrics.hotmartWebhookReceivedTotal += 1;
  if (isPaid) metrics.hotmartWebhookPaidTotal += 1;
  if (duplicate) metrics.hotmartWebhookDuplicateTotal += 1;
}

export function getMetricsSnapshot(extra?: { orderCounts?: Record<string, number> }) {
  const metrics = getRuntimeMetrics();
  const queueConfig = getQueueConfig();

  return {
    startedAt: new Date(metrics.startedAtMs).toISOString(),
    uptimeMs: Date.now() - metrics.startedAtMs,
    queueConfig,
    derived: {
      averageClicksignRps: Number(estimateAverageClicksignRps(queueConfig).toFixed(3)),
    },
    counters: {
      enqueuedTotal: metrics.enqueuedTotal,
      workerStartedTotal: metrics.workerStartedTotal,
      workerSucceededTotal: metrics.workerSucceededTotal,
      workerFailedTotal: metrics.workerFailedTotal,
      workerRateLimitedTotal: metrics.workerRateLimitedTotal,
      workerLockedTotal: metrics.workerLockedTotal,
      workerIdempotentTotal: metrics.workerIdempotentTotal,
      clicksignWebhookReceivedTotal: metrics.clicksignWebhookReceivedTotal,
      clicksignWebhookSignTotal: metrics.clicksignWebhookSignTotal,
      clicksignWebhookAddSignerTotal: metrics.clicksignWebhookAddSignerTotal,
      clicksignWebhookDuplicateTotal: metrics.clicksignWebhookDuplicateTotal,
      hotmartWebhookReceivedTotal: metrics.hotmartWebhookReceivedTotal,
      hotmartWebhookPaidTotal: metrics.hotmartWebhookPaidTotal,
      hotmartWebhookDuplicateTotal: metrics.hotmartWebhookDuplicateTotal,
    },
    stats: {
      queueLagMs: summarize(metrics.queueLagMs),
      workerDurationMs: summarize(metrics.workerDurationMs),
      endToEndToEnvelopeMs: summarize(metrics.endToEndToEnvelopeMs),
    },
    lastEvents: metrics.lastEvents,
    orderCounts: extra?.orderCounts ?? {},
  };
}

export function resetMetrics(): void {
  globalMetrics.__runtimeMetrics = createRuntimeMetrics();
}
