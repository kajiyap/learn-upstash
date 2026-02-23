export type OrderStatus = "pending" | "envelope_created" | "signed" | "paid";

export type CheckoutData = {
  name: string;
  email: string;
  cpf: string;
  phone?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  dueDay?: string;
  installmentPlan?: string;
  consent?: boolean;
  emphasis?: string;
  url?: string;
  utmSource?: string;
  selectedInstallmentsCount?: number;
  selectedInstallmentValue?: number;
  selectedTotalValue?: number;
  selectedInterestRate?: number;
};

export type OrderMetrics = {
  enqueuedAtMs?: number;
  workerStartedAtMs?: number;
  envelopeCreatedAtMs?: number;
  signedAtMs?: number;
  paidAtMs?: number;
  workerAttempts: number;
  lastWorkerDurationMs?: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  name: string;
  email: string;
  productId?: string;
  offerId?: string;
  checkoutData: CheckoutData;
  envelopeId?: string;
  documentId?: string;
  signerId?: string;
  hotmartTransactionId?: string;
  metrics: OrderMetrics;
  createdAt: string;
  updatedAt: string;
};

// Usa globalThis para sobreviver ao hot-reload do Next.js em dev.
const globalStore = globalThis as unknown as {
  __orders: Map<string, Order>;
  __nextId: number;
  __processedEvents: Set<string>;
  __workerLocks: Set<string>;
};

if (!globalStore.__orders) {
  globalStore.__orders = new Map<string, Order>();
}

if (!globalStore.__nextId) {
  globalStore.__nextId = 1;
}

if (!globalStore.__processedEvents) {
  globalStore.__processedEvents = new Set<string>();
}

if (!globalStore.__workerLocks) {
  globalStore.__workerLocks = new Set<string>();
}

const orders = globalStore.__orders;
const processedEvents = globalStore.__processedEvents;
const workerLocks = globalStore.__workerLocks;

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ["envelope_created"],
  envelope_created: ["signed"],
  signed: ["paid"],
  paid: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function touch(order: Order): void {
  order.updatedAt = nowIso();
}

function advanceStatus(order: Order, next: OrderStatus): "changed" | "noop" | "invalid" {
  if (order.status === next) return "noop";
  if (!allowedTransitions[order.status].includes(next)) return "invalid";
  order.status = next;
  touch(order);
  return "changed";
}

export function createOrder(params: {
  checkoutData: CheckoutData;
  productId?: string;
  offerId?: string;
}): Order {
  const id = String(globalStore.__nextId++);
  const now = nowIso();
  const order: Order = {
    id,
    status: "pending",
    name: params.checkoutData.name,
    email: params.checkoutData.email,
    productId: params.productId,
    offerId: params.offerId,
    checkoutData: params.checkoutData,
    metrics: {
      workerAttempts: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  orders.set(id, order);
  return order;
}

export function getOrder(id: string): Order | null {
  return orders.get(id) ?? null;
}

export function listOrders(): Order[] {
  return Array.from(orders.values());
}

export function findOrderByEmail(email: string): Order | null {
  for (const order of orders.values()) {
    if (order.email === email) return order;
  }
  return null;
}

export function findOrderByClicksignIdentifiers(params: {
  envelopeId?: string;
  documentId?: string;
  signerId?: string;
}): Order | null {
  for (const order of orders.values()) {
    if (params.documentId && order.documentId === params.documentId) return order;
    if (params.envelopeId && order.envelopeId === params.envelopeId) return order;
    if (params.signerId && order.signerId === params.signerId) return order;
  }
  return null;
}

export function markOrderEnvelopeCreated(
  orderId: string,
  clicksign: { envelopeId: string; documentId: string; signerId: string }
): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;

  // Dados de Clicksign podem chegar duplicados; sempre sincronizamos IDs.
  order.envelopeId = clicksign.envelopeId;
  order.documentId = clicksign.documentId;
  order.signerId = clicksign.signerId;
  order.metrics.envelopeCreatedAtMs = Date.now();

  const changed = advanceStatus(order, "envelope_created");
  if (changed === "invalid") return order;
  if (changed === "noop") {
    touch(order);
  }

  return order;
}

export function syncOrderClicksignData(
  orderId: string,
  clicksign: Partial<Pick<Order, "envelopeId" | "documentId" | "signerId">>
): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;
  Object.assign(order, clicksign);
  touch(order);
  return order;
}

export function markOrderSigned(orderId: string): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;
  order.metrics.signedAtMs = Date.now();
  const changed = advanceStatus(order, "signed");
  if (changed === "noop") touch(order);
  return order;
}

export function markOrderPaid(orderId: string, hotmartTransactionId?: string): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;

  if (hotmartTransactionId) {
    order.hotmartTransactionId = hotmartTransactionId;
  }
  order.metrics.paidAtMs = Date.now();

  const changed = advanceStatus(order, "paid");
  if (changed === "noop") touch(order);
  return order;
}

export function markOrderEnqueued(orderId: string, enqueuedAtMs: number): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;
  order.metrics.enqueuedAtMs = enqueuedAtMs;
  touch(order);
  return order;
}

export function markWorkerStarted(orderId: string, startedAtMs: number): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;
  order.metrics.workerAttempts += 1;
  order.metrics.workerStartedAtMs = startedAtMs;
  touch(order);
  return order;
}

export function markWorkerCompleted(orderId: string, durationMs: number): Order | null {
  const order = orders.get(orderId);
  if (!order) return null;
  order.metrics.lastWorkerDurationMs = durationMs;
  touch(order);
  return order;
}

export function recordProcessedEvent(source: string, eventId: string): boolean {
  const key = `${source}:${eventId}`;
  if (processedEvents.has(key)) return false;
  processedEvents.add(key);
  return true;
}

export function acquireWorkerLock(orderId: string): boolean {
  if (workerLocks.has(orderId)) return false;
  workerLocks.add(orderId);
  return true;
}

export function releaseWorkerLock(orderId: string): void {
  workerLocks.delete(orderId);
}

export function resetStore(): void {
  orders.clear();
  processedEvents.clear();
  workerLocks.clear();
  globalStore.__nextId = 1;
}
