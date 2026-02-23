export type QueueConfig = {
  queueName: string;
  queueParallelism: number;
  flowKey: string;
  flowRate: number;
  flowPeriod: `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d`;
  flowPeriodMs: number;
  flowParallelism: number;
  retries: number;
  clicksignRequestsPerJob: number;
  clicksignBulkRequirementsEnabled: boolean;
  clicksignSendNotification: boolean;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePeriodToMs(period: string): number {
  const trimmed = period.trim().toLowerCase();
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(trimmed);
  if (!match) return 10_000;

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  return amount * 86_400_000;
}

function normalizeFlowPeriod(
  value: string | undefined
): `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d` {
  if (!value) return "10s";
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+)(s|m|h|d)$/.exec(trimmed);
  if (!match) return "10s";
  return `${match[1]}${match[2]}` as `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d`;
}

export function getQueueConfig(): QueueConfig {
  const flowPeriod = normalizeFlowPeriod(process.env.QSTASH_FLOW_PERIOD);
  const clicksignBulkRequirementsEnabled = toBoolean(
    process.env.CLICKSIGN_BULK_REQUIREMENTS_ENABLED,
    true
  );
  const clicksignSendNotification = toBoolean(process.env.CLICKSIGN_SEND_NOTIFICATION, false);
  const autoEstimatedRequestsPerJob =
    3 + // envelope + document + signer
    (clicksignBulkRequirementsEnabled ? 1 : 2) + // requirements
    1 + // activate
    (clicksignSendNotification ? 1 : 0); // notification (optional)

  return {
    queueName: process.env.QSTASH_QUEUE_NAME || "fila-rate-limit-test",
    queueParallelism: toPositiveInt(process.env.QSTASH_QUEUE_PARALLELISM, 2),
    flowKey: process.env.QSTASH_FLOW_KEY || "clicksign-worker",
    flowRate: toPositiveInt(process.env.QSTASH_FLOW_RATE, 2),
    flowPeriod,
    flowPeriodMs: parsePeriodToMs(flowPeriod),
    flowParallelism: toPositiveInt(process.env.QSTASH_FLOW_PARALLELISM, 2),
    retries: toPositiveInt(process.env.QSTASH_RETRIES, 3),
    clicksignRequestsPerJob: toPositiveInt(
      process.env.CLICKSIGN_REQUESTS_PER_JOB,
      autoEstimatedRequestsPerJob
    ),
    clicksignBulkRequirementsEnabled,
    clicksignSendNotification,
  };
}

export function estimateDispatchWindowMs(totalJobs: number, config = getQueueConfig()): number {
  if (!Number.isFinite(totalJobs) || totalJobs <= 0) return 0;
  const batches = Math.ceil(totalJobs / config.flowRate);
  return batches * config.flowPeriodMs;
}

export function estimateAverageClicksignRps(config = getQueueConfig()): number {
  const jobsPerSecond = config.flowRate / (config.flowPeriodMs / 1000);
  return jobsPerSecond * config.clicksignRequestsPerJob;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
