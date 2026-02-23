"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type MetricsSnapshot = {
  counters: {
    enqueuedTotal: number;
    workerStartedTotal: number;
    workerSucceededTotal: number;
    workerFailedTotal: number;
    workerRateLimitedTotal: number;
    workerLockedTotal: number;
    workerIdempotentTotal: number;
    clicksignWebhookReceivedTotal: number;
    clicksignWebhookSignTotal: number;
    hotmartWebhookReceivedTotal: number;
    hotmartWebhookPaidTotal: number;
  };
  stats: {
    queueLagMs: { avg: number; p95: number; max: number };
    workerDurationMs: { avg: number; p95: number; max: number };
    endToEndToEnvelopeMs: { avg: number; p95: number; max: number };
  };
  queueConfig: {
    flowRate: number;
    flowPeriod: string;
    flowPeriodMs: number;
    flowParallelism: number;
    retries: number;
    clicksignRequestsPerJob: number;
  };
  derived: {
    averageClicksignRps: number;
  };
  queueEstimates: {
    pendingDispatchWindowMs: number;
    pendingDispatchWindowFormatted: string;
  };
  orderCounts: {
    total: number;
    pending: number;
    envelope_created: number;
    signed: number;
    paid: number;
  };
  lastEvents: Array<{
    at: string;
    type: string;
    orderId?: string;
    detail?: string;
  }>;
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function getHealth(snapshot: MetricsSnapshot | null): {
  label: "ok" | "atencao" | "critico";
  color: string;
  reason: string;
} {
  if (!snapshot) {
    return { label: "atencao", color: "#b8860b", reason: "Aguardando primeira coleta" };
  }

  if (snapshot.counters.workerRateLimitedTotal > 0 || snapshot.counters.workerFailedTotal > 0) {
    return {
      label: "critico",
      color: "#b22222",
      reason: "Falha/429 detectado. Necessario reduzir taxa ou paralelismo.",
    };
  }

  if (snapshot.queueEstimates.pendingDispatchWindowMs > 180_000) {
    return {
      label: "atencao",
      color: "#b8860b",
      reason: "Backlog acima de 3 minutos. UX pode ficar lenta na tela de sucesso.",
    };
  }

  return {
    label: "ok",
    color: "#228b22",
    reason: "Fila estavel e sem rate-limit no periodo observado.",
  };
}

export default function MonitorPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshMs, setRefreshMs] = useState(3000);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const health = useMemo(() => getHealth(metrics), [metrics]);

  async function fetchMetrics() {
    setLoading(true);
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      const json = (await res.json()) as MetricsSnapshot;
      setMetrics(json);
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMetrics();
  }, []);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const interval = setInterval(() => {
      fetchMetrics();
    }, refreshMs);
    return () => clearInterval(interval);
  }, [refreshMs]);

  return (
    <main
      style={{
        padding: 32,
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "monospace",
        color: "var(--foreground)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Monitoramento em tempo real</h1>
        <Link href="/">voltar</Link>
      </div>

      <section style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          style={{
            padding: "8px 16px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Atualizando..." : "Atualizar agora"}
        </button>

        <label>
          auto-refresh:
          <select
            value={String(refreshMs)}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            style={{ marginLeft: 8, padding: "6px 8px" }}
          >
            <option value="1000">1s</option>
            <option value="2000">2s</option>
            <option value="3000">3s</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="0">desligado</option>
          </select>
        </label>

        <span style={{ color: "var(--muted)" }}>
          ultima coleta: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString("pt-BR") : "-"}
        </span>
      </section>

      <section
        style={{
          marginTop: 16,
          border: `2px solid ${health.color}`,
          borderRadius: 6,
          padding: 12,
          background: "var(--surface-soft)",
          color: "var(--foreground)",
        }}
      >
        <strong style={{ color: health.color }}>Saude: {health.label.toUpperCase()}</strong>
        <p style={{ marginTop: 6 }}>{health.reason}</p>
      </section>

      {!metrics && (
        <p style={{ marginTop: 20, color: "var(--muted)" }}>
          Sem dados ainda. Abra a home e dispare jobs para comecar a observar o comportamento.
        </p>
      )}

      {metrics && (
        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          <section
            style={{
              padding: 12,
              background: "var(--surface-soft)",
              borderRadius: 6,
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            <strong>Config da fila (publishJSON)</strong>
            <p style={{ marginTop: 6 }}>
              flowRate={metrics.queueConfig.flowRate} / {metrics.queueConfig.flowPeriod}, flowParallelism=
              {metrics.queueConfig.flowParallelism}, retries={metrics.queueConfig.retries}
            </p>
            <p>
              carga media estimada Clicksign: <strong>{metrics.derived.averageClicksignRps} req/s</strong>
            </p>
            <p>
              backlog pendente: <strong>{metrics.orderCounts.pending}</strong> | janela estimada de drenagem:{" "}
              <strong>{metrics.queueEstimates.pendingDispatchWindowFormatted}</strong>
            </p>
          </section>

          <section
            style={{
              padding: 12,
              background: "var(--surface-soft)",
              borderRadius: 6,
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            <strong>Contadores</strong>
            <p style={{ marginTop: 6 }}>
              enqueued={metrics.counters.enqueuedTotal} | started={metrics.counters.workerStartedTotal} | success=
              {metrics.counters.workerSucceededTotal} | failed={metrics.counters.workerFailedTotal} | 429=
              {metrics.counters.workerRateLimitedTotal}
            </p>
            <p>
              pending={metrics.orderCounts.pending} | envelope_created={metrics.orderCounts.envelope_created} |
              signed={metrics.orderCounts.signed} | paid={metrics.orderCounts.paid}
            </p>
          </section>

          <section
            style={{
              padding: 12,
              background: "var(--surface-soft)",
              borderRadius: 6,
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            <strong>Latencias</strong>
            <p style={{ marginTop: 6 }}>
              queue lag avg/p95/max: {formatMs(metrics.stats.queueLagMs.avg)} / {formatMs(metrics.stats.queueLagMs.p95)}
              {" / "}
              {formatMs(metrics.stats.queueLagMs.max)}
            </p>
            <p>
              worker duration avg/p95/max: {formatMs(metrics.stats.workerDurationMs.avg)} /{" "}
              {formatMs(metrics.stats.workerDurationMs.p95)} / {formatMs(metrics.stats.workerDurationMs.max)}
            </p>
            <p>
              end-to-end ate envelope avg/p95/max: {formatMs(metrics.stats.endToEndToEnvelopeMs.avg)} /{" "}
              {formatMs(metrics.stats.endToEndToEnvelopeMs.p95)} /{" "}
              {formatMs(metrics.stats.endToEndToEnvelopeMs.max)}
            </p>
          </section>

          <section
            style={{
              padding: 12,
              background: "var(--surface-soft)",
              borderRadius: 6,
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            <strong>Eventos recentes</strong>
            <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto", fontSize: 12 }}>
              {metrics.lastEvents.slice(0, 30).map((event, idx) => (
                <p key={`${event.at}-${idx}`}>
                  {new Date(event.at).toLocaleTimeString("pt-BR")} | {event.type}
                  {event.orderId ? ` | orderId=${event.orderId}` : ""}
                  {event.detail ? ` | ${event.detail}` : ""}
                </p>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
