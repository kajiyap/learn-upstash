"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Order = {
  id: string;
  status: "pending" | "envelope_created" | "signed" | "paid";
  name: string;
  email: string;
  envelopeId: string | null;
  documentId: string | null;
  signerId: string | null;
  updatedAt: string;
};

async function fetchOrder(orderId: string): Promise<Order> {
  const res = await fetch(`/api/order/${orderId}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json?.order) {
    throw new Error(json?.error || "Falha ao consultar pedido");
  }
  return json.order as Order;
}

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("orderId");

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [widgetSigned, setWidgetSigned] = useState(false);

  const shouldPoll = useMemo(() => order?.status === "pending", [order?.status]);

  const loadOrder = useCallback(async () => {
    if (!orderId) {
      setError("orderId ausente na URL");
      setLoading(false);
      return;
    }

    try {
      const nextOrder = await fetchOrder(orderId);
      setOrder(nextOrder);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao buscar pedido");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    if (!orderId || !shouldPoll) return;
    const interval = setInterval(() => {
      loadOrder();
    }, 2000);
    return () => clearInterval(interval);
  }, [loadOrder, orderId, shouldPoll]);

  async function simulateWidgetSign() {
    if (!orderId || !order) return;

    setSigning(true);
    setWidgetSigned(true);

    try {
      await fetch("/api/webhook/clicksign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            id: `sim-sign-${orderId}-${Date.now()}`,
            name: "sign",
            data: {
              envelope: { id: order.envelopeId },
              document: { id: order.documentId },
              signer: {
                id: order.signerId,
                email: order.email,
                name: order.name,
              },
            },
          },
        }),
      });

      router.push(`/payment?orderId=${orderId}`);
    } finally {
      setSigning(false);
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 860, margin: "0 auto", fontFamily: "monospace" }}>
      <h1>Sucesso</h1>
      <p style={{ marginTop: 8 }}>
        Pedido: <strong>{orderId ?? "sem orderId"}</strong>
      </p>

      {loading && <p style={{ marginTop: 24 }}>Carregando pedido...</p>}
      {error && (
        <p style={{ marginTop: 24, color: "red" }}>
          {error} - <Link href="/">voltar</Link>
        </p>
      )}

      {order && (
        <section style={{ marginTop: 24, border: "1px solid #ccc", padding: 20, borderRadius: 6 }}>
          <p>
            Status atual: <strong>{order.status}</strong>
          </p>
          <p style={{ marginTop: 8 }}>
            Ultima atualizacao: {new Date(order.updatedAt).toLocaleTimeString("pt-BR")}
          </p>

          {order.status === "pending" && (
            <p style={{ marginTop: 16 }}>
              Preparando seu contrato... polling no DB ativo a cada 2s.
            </p>
          )}

          {(order.status === "envelope_created" || order.status === "signed" || order.status === "paid") && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "var(--surface-soft)",
                borderRadius: 4,
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              <p>Contrato pronto no Clicksign.</p>
              <p style={{ marginTop: 6 }}>envelopeId: {order.envelopeId}</p>
              <p>documentId: {order.documentId}</p>
              <p>signerId: {order.signerId}</p>
            </div>
          )}

          {widgetSigned && (
            <p style={{ marginTop: 16, color: "green" }}>
              Evento do widget disparado. Encaminhando para pagamento...
            </p>
          )}

          {order.status === "envelope_created" && (
            <button
              onClick={simulateWidgetSign}
              disabled={signing}
              style={{
                marginTop: 18,
                padding: "10px 20px",
                cursor: signing ? "not-allowed" : "pointer",
                opacity: signing ? 0.7 : 1,
              }}
            >
              {signing ? "Assinando..." : "Simular assinatura no widget"}
            </button>
          )}

          {(order.status === "signed" || order.status === "paid") && (
            <button
              onClick={() => router.push(`/payment?orderId=${order.id}`)}
              style={{ marginTop: 18, padding: "10px 20px", cursor: "pointer" }}
            >
              Ir para pagamento
            </button>
          )}

          <div style={{ marginTop: 16 }}>
            <button onClick={loadOrder} style={{ padding: "8px 14px", cursor: "pointer" }}>
              Atualizar agora
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
