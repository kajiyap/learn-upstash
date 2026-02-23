"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Order = {
  id: string;
  status: string;
  name: string;
  email: string;
  envelopeId?: string;
  documentId?: string;
  signerId?: string;
  hotmartTransactionId?: string;
  createdAt: string;
  updatedAt: string;
};

type MetricsSnapshot = {
  counters: {
    enqueuedTotal: number;
    workerStartedTotal: number;
    workerSucceededTotal: number;
    workerFailedTotal: number;
    workerRateLimitedTotal: number;
    workerLockedTotal: number;
    workerIdempotentTotal: number;
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

const DEFAULT_CHECKOUT_DATA = {
  name: "Joao da Silva Teste",
  email: "joao.teste@email.com",
  phone: "(11) 99999-0001",
  cpf: "111.222.333-04",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Apto 42",
  district: "Bela Vista",
  city: "Sao Paulo",
  state: "SP",
  dueDay: "10",
  installmentPlan: "12x",
  consent: true,
  emphasis: "tecnico-em-enfermagem",
  url: "https://checkout.example.com/test",
  utmSource: "rate-tester",
  selectedInstallmentsCount: 12,
  selectedInstallmentValue: 144.68,
  selectedTotalValue: 1736.16,
  selectedInterestRate: 2.1,
};

export default function Home() {
  const router = useRouter();
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(5);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [checkoutData, setCheckoutData] = useState(
    JSON.stringify(DEFAULT_CHECKOUT_DATA, null, 2)
  );
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const estimatedWindowForBatch = useMemo(() => {
    if (!metrics?.queueConfig) return null;
    const batches = Math.ceil(quantity / metrics.queueConfig.flowRate);
    return batches * metrics.queueConfig.flowPeriodMs;
  }, [metrics?.queueConfig, quantity]);

  function handleCheckoutChange(value: string) {
    setCheckoutData(value);
    try {
      JSON.parse(value);
      setCheckoutError(null);
    } catch {
      setCheckoutError("JSON inválido");
    }
  }

  async function fetchStatus() {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/status");
      const json = await res.json();
      setOrders(json.orders ?? []);
    } catch {
      setOrders([]);
    } finally {
      setStatusLoading(false);
    }
  }

  async function fetchMetrics() {
    setMetricsLoading(true);
    try {
      const res = await fetch("/api/metrics");
      const json = (await res.json()) as MetricsSnapshot;
      setMetrics(json);
    } catch {
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }

  async function handleResetData() {
    setResetLoading(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setOrders([]);
      setMetrics(null);
      setBatchResult(null);
      setSingleResult(null);
      await fetchStatus();
      await fetchMetrics();
    } finally {
      setResetLoading(false);
    }
  }

  async function handleCheckout() {
    if (checkoutError) return;

    setSingleLoading(true);
    setSingleResult(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutData: JSON.parse(checkoutData),
        }),
      });

      const json = await res.json();
      setSingleResult(JSON.stringify(json, null, 2));

      if (json?.success && json?.orderId) {
        router.push(`/sucesso?orderId=${json.orderId}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      setSingleResult(`Erro: ${message}`);
    } finally {
      setSingleLoading(false);
    }
  }

  async function handleBatchEnqueue() {
    if (checkoutError) return;

    setBatchLoading(true);
    setBatchResult(null);

    try {
      const res = await fetch("/api/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          checkoutData: JSON.parse(checkoutData),
        }),
      });

      const json = await res.json();
      setBatchResult(JSON.stringify(json, null, 2));
      fetchStatus();
      fetchMetrics();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      setBatchResult(`Erro: ${message}`);
    } finally {
      setBatchLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    fetchMetrics();
  }, []);

  return (
    <main style={{ padding: 40, maxWidth: 960, margin: "0 auto", fontFamily: "monospace" }}>
      <h1>Fluxo checkout realtime (estudo)</h1>
      <p style={{ marginTop: 8, color: "var(--muted)" }}>
        Novo contrato: <code>POST /api/checkout</code> e <code>GET /api/order/[orderId]</code>.
      </p>
      <p style={{ marginTop: 8 }}>
        Painel ao vivo: <Link href="/monitor">/monitor</Link>
      </p>

      <section style={{ marginTop: 24 }}>
        <label style={{ fontWeight: "bold" }}>
          checkoutData{" "}
          <span style={{ fontWeight: "normal", color: "var(--muted)" }}>(JSON editavel)</span>
        </label>
        <textarea
          value={checkoutData}
          onChange={(e) => handleCheckoutChange(e.target.value)}
          rows={16}
          style={{
            display: "block",
            marginTop: 8,
            width: "100%",
            padding: 12,
            fontFamily: "monospace",
            fontSize: 13,
            border: checkoutError ? "2px solid red" : "1px solid #ccc",
            borderRadius: 4,
            resize: "vertical",
          }}
        />
        {checkoutError && <p style={{ color: "red", marginTop: 4 }}>{checkoutError}</p>}
      </section>

      <section style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={handleCheckout}
          disabled={singleLoading || !!checkoutError}
          style={{
            padding: "10px 24px",
            fontSize: 15,
            cursor: singleLoading || !!checkoutError ? "not-allowed" : "pointer",
            opacity: singleLoading || !!checkoutError ? 0.6 : 1,
          }}
        >
          {singleLoading ? "Criando checkout..." : "1. Iniciar checkout"}
        </button>
        <span style={{ color: "var(--muted)" }}>
          Redireciona para <code>/sucesso?orderId=...</code>
        </span>
      </section>

      {singleResult && (
        <section style={{ marginTop: 12 }}>
          <label style={{ fontWeight: "bold" }}>Resposta do checkout</label>
          <pre
            style={{
              marginTop: 8,
              padding: 16,
              background: "var(--surface-soft)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 13,
              overflowX: "auto",
            }}
          >
            {singleResult}
          </pre>
        </section>
      )}

      <section style={{ marginTop: 32, borderTop: "2px solid #ccc", paddingTop: 24 }}>
        <h2>Simulacao em lote (20-30 alunos)</h2>
        <label style={{ fontWeight: "bold" }}>Quantidade de jobs</label>
        <div style={{ marginTop: 8 }}>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            style={{ padding: 8, width: 80 }}
          />
        </div>
        <button
          onClick={handleBatchEnqueue}
          disabled={batchLoading || !!checkoutError}
          style={{
            padding: "10px 24px",
            fontSize: 15,
            marginTop: 12,
            cursor: batchLoading || !!checkoutError ? "not-allowed" : "pointer",
            opacity: batchLoading || !!checkoutError ? 0.6 : 1,
          }}
        >
          {batchLoading ? "Enfileirando..." : `2. Disparar ${quantity} job(s)`}
        </button>
      </section>

      {batchResult && (
        <section style={{ marginTop: 24 }}>
          <label style={{ fontWeight: "bold" }}>Resposta do enqueue em lote</label>
          <pre
            style={{
              marginTop: 8,
              padding: 16,
              background: "var(--surface-soft)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 13,
              overflowX: "auto",
            }}
          >
            {batchResult}
          </pre>
        </section>
      )}

      <section style={{ marginTop: 40, borderTop: "2px solid #ccc", paddingTop: 24 }}>
        <h2>Status dos Pedidos</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={fetchStatus}
            disabled={statusLoading}
            style={{
              padding: "8px 20px",
              fontSize: 14,
              cursor: statusLoading ? "not-allowed" : "pointer",
              opacity: statusLoading ? 0.6 : 1,
            }}
          >
            {statusLoading ? "Carregando..." : "Ver Status"}
          </button>
          <button
            onClick={fetchMetrics}
            disabled={metricsLoading}
            style={{
              padding: "8px 20px",
              fontSize: 14,
              cursor: metricsLoading ? "not-allowed" : "pointer",
              opacity: metricsLoading ? 0.6 : 1,
            }}
          >
            {metricsLoading ? "Carregando..." : "Ver Metricas"}
          </button>
          <button
            onClick={handleResetData}
            disabled={resetLoading}
            style={{
              padding: "8px 20px",
              fontSize: 14,
              cursor: resetLoading ? "not-allowed" : "pointer",
              opacity: resetLoading ? 0.6 : 1,
            }}
          >
            {resetLoading ? "Limpando..." : "Resetar dados de teste"}
          </button>
        </div>

        {orders.length > 0 && (
          <table
            style={{
              marginTop: 16,
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>ID</th>
                <th style={{ padding: "6px 8px" }}>Nome</th>
                <th style={{ padding: "6px 8px" }}>Email</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Envelope</th>
                <th style={{ padding: "6px 8px" }}>Acoes</th>
                <th style={{ padding: "6px 8px" }}>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "6px 8px" }}>{o.id}</td>
                  <td style={{ padding: "6px 8px" }}>{o.name}</td>
                  <td style={{ padding: "6px 8px" }}>{o.email}</td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontWeight: "bold",
                      color:
                        o.status === "signed"
                          ? "green"
                          : o.status === "envelope_created"
                            ? "#b8860b"
                            : o.status === "paid"
                              ? "blue"
                              : "var(--muted)",
                    }}
                  >
                    {o.status}
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 11 }}>
                    {o.envelopeId ?? "-"}
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12 }}>
                    <Link href={`/sucesso?orderId=${o.id}`}>abrir fluxo</Link>
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 11 }}>
                    {new Date(o.updatedAt).toLocaleTimeString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {orders.length === 0 && !statusLoading && (
          <p style={{ marginTop: 12, color: "var(--muted)" }}>
            Nenhum pedido ainda. Dispare jobs e clique em &quot;Ver Status&quot;.
          </p>
        )}
      </section>

      <section style={{ marginTop: 32, borderTop: "2px solid #ccc", paddingTop: 24 }}>
        <h2>Metricas da fila</h2>
        {!metrics && (
          <p style={{ color: "var(--muted)" }}>Clique em &quot;Ver Metricas&quot; para carregar.</p>
        )}
        {metrics && (
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                padding: 12,
                background: "var(--surface-soft)",
                borderRadius: 4,
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              <strong>Configuracao atual (publishJSON)</strong>
              <p style={{ marginTop: 6 }}>
                flowControl: rate={metrics.queueConfig.flowRate}, period={metrics.queueConfig.flowPeriod},
                parallelism={metrics.queueConfig.flowParallelism}, retries={metrics.queueConfig.retries}
              </p>
              <p>
                media de carga na Clicksign (estimada):{" "}
                <strong>{metrics.derived.averageClicksignRps} req/s</strong> (considerando{" "}
                {metrics.queueConfig.clicksignRequestsPerJob} requests por job)
              </p>
              <p>
                janela estimada para enfileirar {quantity} jobs:{" "}
                <strong>{estimatedWindowForBatch !== null ? formatMs(estimatedWindowForBatch) : "-"}</strong>
              </p>
              <p>
                backlog atual (`pending`) deve drenar em:{" "}
                <strong>{metrics.queueEstimates.pendingDispatchWindowFormatted}</strong>
              </p>
            </div>

            <div
              style={{
                padding: 12,
                background: "var(--surface-soft)",
                borderRadius: 4,
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              <strong>Contadores</strong>
              <p style={{ marginTop: 6 }}>
                enqueued={metrics.counters.enqueuedTotal} | worker started={metrics.counters.workerStartedTotal} |
                success={metrics.counters.workerSucceededTotal} | failed={metrics.counters.workerFailedTotal} |
                429={metrics.counters.workerRateLimitedTotal}
              </p>
              <p>
                idempotent={metrics.counters.workerIdempotentTotal} | locked={metrics.counters.workerLockedTotal}
              </p>
              <p>
                status pedidos: pending={metrics.orderCounts.pending}, envelope_created=
                {metrics.orderCounts.envelope_created}, signed={metrics.orderCounts.signed}, paid=
                {metrics.orderCounts.paid}
              </p>
            </div>

            <div
              style={{
                padding: 12,
                background: "var(--surface-soft)",
                borderRadius: 4,
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              <strong>Latencias</strong>
              <p style={{ marginTop: 6 }}>
                queue lag avg/p95/max: {formatMs(metrics.stats.queueLagMs.avg)} /{" "}
                {formatMs(metrics.stats.queueLagMs.p95)} / {formatMs(metrics.stats.queueLagMs.max)}
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
            </div>

            <div
              style={{
                padding: 12,
                background: "var(--surface-soft)",
                borderRadius: 4,
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              <strong>Ultimos eventos</strong>
              <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", fontSize: 12 }}>
                {metrics.lastEvents.length === 0 && <p>Sem eventos ainda.</p>}
                {metrics.lastEvents.slice(0, 12).map((event, index) => (
                  <p key={`${event.at}-${index}`}>
                    {new Date(event.at).toLocaleTimeString("pt-BR")} | {event.type}
                    {event.orderId ? ` | orderId=${event.orderId}` : ""}
                    {event.detail ? ` | ${event.detail}` : ""}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
