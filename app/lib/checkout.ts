import type { CheckoutData } from "@/app/lib/store";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function validateCheckoutData(input: unknown): CheckoutData {
  if (!input || typeof input !== "object") {
    throw new Error("checkoutData invalido");
  }

  const data = input as Record<string, unknown>;

  const name = asString(data.name);
  const email = asString(data.email).toLowerCase();
  const cpf = asString(data.cpf);

  if (!name) throw new Error("name e obrigatorio");
  if (!email || !email.includes("@")) throw new Error("email invalido");
  if (!cpf) throw new Error("cpf e obrigatorio");

  return {
    name,
    email,
    cpf,
    phone: asString(data.phone) || undefined,
    cep: asString(data.cep) || undefined,
    street: asString(data.street) || undefined,
    number: asString(data.number) || undefined,
    complement: asString(data.complement) || undefined,
    district: asString(data.district) || undefined,
    city: asString(data.city) || undefined,
    state: asString(data.state) || undefined,
    dueDay: asString(data.dueDay) || undefined,
    installmentPlan: asString(data.installmentPlan) || undefined,
    consent: Boolean(data.consent),
    emphasis: asString(data.emphasis) || undefined,
    url: asString(data.url) || undefined,
    utmSource: asString(data.utmSource) || undefined,
    selectedInstallmentsCount: asNumber(data.selectedInstallmentsCount),
    selectedInstallmentValue: asNumber(data.selectedInstallmentValue),
    selectedTotalValue: asNumber(data.selectedTotalValue),
    selectedInterestRate: asNumber(data.selectedInterestRate),
  };
}
