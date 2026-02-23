"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Order = {
  id: string;
  status: "pending" | "envelope_created" | "signed" | "paid";
  name: string;
  email: string;
  hotmartTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function FinalSuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!orderId) {
        setError("orderId ausente na URL");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/order/${orderId}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json?.order) {
          throw new Error(json?.error || "Falha ao consultar pedido");
        }
        setOrder(json.order as Order);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erro ao buscar pedido");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [orderId]);

  return (
    <main style={{ padding: 40, maxWidth: 860, margin: "0 auto", fontFamily: "monospace" }}>
      <h1>Confirmacao final</h1>
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
            Status: <strong>{order.status}</strong>
          </p>
          <p style={{ marginTop: 8 }}>Aluno: {order.name}</p>
          <p>Email: {order.email}</p>
          <p>Transacao Hotmart: {order.hotmartTransactionId ?? "-"}</p>
          <p style={{ marginTop: 12 }}>
            Criado em: {new Date(order.createdAt).toLocaleString("pt-BR")}
          </p>
          <p>Atualizado em: {new Date(order.updatedAt).toLocaleString("pt-BR")}</p>
          <p style={{ marginTop: 16 }}>
            Fluxo finalizado usando somente <code>orderId</code> + estado no DB.
          </p>

          <div style={{ marginTop: 16 }}>
            <Link href="/">Iniciar novo checkout</Link>
          </div>
        </section>
      )}
    </main>
  );
}
