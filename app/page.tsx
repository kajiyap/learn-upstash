"use client";

import { useState } from "react";

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
  const [quantity, setQuantity] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [checkoutData, setCheckoutData] = useState(
    JSON.stringify(DEFAULT_CHECKOUT_DATA, null, 2)
  );
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  function handleCheckoutChange(value: string) {
    setCheckoutData(value);
    try {
      JSON.parse(value);
      setCheckoutError(null);
    } catch {
      setCheckoutError("JSON inválido");
    }
  }

  async function handleClick() {
    if (checkoutError) return;

    setLoading(true);
    setResult(null);

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
      setResult(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setResult(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 800, margin: "0 auto", fontFamily: "monospace" }}>
      <h1>Teste QStash + Clicksign</h1>

      {/* Quantidade de jobs */}
      <section style={{ marginTop: 24 }}>
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
      </section>

      {/* CheckoutData (JSON editável) */}
      <section style={{ marginTop: 24 }}>
        <label style={{ fontWeight: "bold" }}>
          checkoutData{" "}
          <span style={{ fontWeight: "normal", color: "#888" }}>(JSON editável)</span>
        </label>
        <textarea
          value={checkoutData}
          onChange={(e) => handleCheckoutChange(e.target.value)}
          rows={20}
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
        {checkoutError && (
          <p style={{ color: "red", marginTop: 4 }}>{checkoutError}</p>
        )}
      </section>

      {/* Botão */}
      <section style={{ marginTop: 24 }}>
        <button
          onClick={handleClick}
          disabled={loading || !!checkoutError}
          style={{
            padding: "10px 24px",
            fontSize: 15,
            cursor: loading || !!checkoutError ? "not-allowed" : "pointer",
            opacity: loading || !!checkoutError ? 0.6 : 1,
          }}
        >
          {loading ? "Enviando..." : `Disparar ${quantity} job(s)`}
        </button>
      </section>

      {/* Resultado */}
      {result && (
        <section style={{ marginTop: 24 }}>
          <label style={{ fontWeight: "bold" }}>Resposta do enqueue</label>
          <pre
            style={{
              marginTop: 8,
              padding: 16,
              background: "#f4f4f4",
              borderRadius: 4,
              fontSize: 13,
              overflowX: "auto",
            }}
          >
            {result}
          </pre>
        </section>
      )}
    </main>
  );
}