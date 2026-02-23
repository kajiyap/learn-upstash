"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Order = {
  id: string;
  status: "pending" | "envelope_created" | "signed" | "paid";
  name: string;
  email: string;
  hotmartTransactionId: string | null;
  updatedAt: string;
  checkoutData: {
    selectedInstallmentsCount?: number;
    selectedInstallmentValue?: number;
    selectedTotalValue?: number;
  };
};

async function fetchOrder(orderId: string): Promise<Order> {
  const res = await fetch(`/api/order/${orderId}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json?.order) {
    throw new Error(json?.error || "Falha ao consultar pedido");
  }
  return json.order as Order;
}

export default function PaymentPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("orderId");

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const shouldPoll = useMemo(() => !!order && order.status !== "paid", [order]);

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
    }, 3000);
    return () => clearInterval(interval);
  }, [loadOrder, orderId, shouldPoll]);

  useEffect(() => {
    if (order?.status === "paid") {
      router.replace(`/final-success?orderId=${order.id}`);
    }
  }, [order, router]);

  async function simulatePaymentWebhook() {
    if (!orderId || !order) return;
    setPaying(true);
    try {
      await fetch("/api/webhook/hotmart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "APPROVED",
          status: "approved",
          orderId: order.id,
          transactionId: `sim-txn-${Date.now()}`,
          buyer: { email: order.email },
        }),
      });
      await loadOrder();
    } finally {
      setPaying(false);
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 860, margin: "0 auto", fontFamily: "monospace" }}>
      <h1>Pagamento</h1>
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
            <p>Dados para prefill do pagamento (vindo do DB):</p>
            <p style={{ marginTop: 6 }}>Nome: {order.name}</p>
            <p>Email: {order.email}</p>
            <p>Parcelas: {order.checkoutData.selectedInstallmentsCount ?? "-"}</p>
            <p>Valor parcela: {order.checkoutData.selectedInstallmentValue ?? "-"}</p>
            <p>Total: {order.checkoutData.selectedTotalValue ?? "-"}</p>
          </div>

          {order.status !== "signed" && order.status !== "paid" && (
            <p style={{ marginTop: 16, color: "#b8860b" }}>
              Pedido ainda nao assinado. Volte para <Link href={`/sucesso?orderId=${order.id}`}>/sucesso</Link>.
            </p>
          )}

          {order.status !== "paid" && (
            <>
              <p style={{ marginTop: 16 }}>Polling no DB ativo a cada 3s aguardando webhook de pagamento.</p>
              <button
                onClick={simulatePaymentWebhook}
                disabled={paying}
                style={{
                  marginTop: 12,
                  padding: "10px 20px",
                  cursor: paying ? "not-allowed" : "pointer",
                  opacity: paying ? 0.7 : 1,
                }}
              >
                {paying ? "Processando..." : "Simular webhook Hotmart (paid)"}
              </button>
            </>
          )}

          {order.status === "paid" && (
            <p style={{ marginTop: 16, color: "green" }}>
              Pagamento confirmado via webhook. Redirecionando para confirmacao final...
            </p>
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
