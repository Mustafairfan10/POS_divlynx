import type { BaseRecord, EntityName, ItemStatus, Order, OrderItem, Payment } from "./types";

/**
 * Conflict resolution used by the server when a client pushes a change based on
 * a stale version. Merges must be deterministic, commutative where possible and
 * must never drop money-related data (items, payments, adjustments, audit log).
 */

function lww<T extends BaseRecord>(a: T, b: T): T {
  return (b.updatedAt ?? 0) >= (a.updatedAt ?? 0) ? b : a;
}

const ITEM_RANK: Record<ItemStatus, number> = { new: 0, sent: 1, ready: 2, served: 3 };

function mergeItem(a: OrderItem, b: OrderItem): OrderItem {
  const newer = b.updatedAt >= a.updatedAt ? b : a;
  const merged: OrderItem = { ...newer };
  // Progress never goes backwards: a kitchen bump on one device must survive
  // a stale edit on another.
  merged.status = ITEM_RANK[a.status] >= ITEM_RANK[b.status] ? a.status : b.status;
  merged.sentAt = a.sentAt && b.sentAt ? Math.min(a.sentAt, b.sentAt) : a.sentAt ?? b.sentAt;
  // A void is a deliberate, approved action: it sticks.
  merged.voided = newer.voided ?? a.voided ?? b.voided;
  return merged;
}

function unionById<T extends { id: string }>(
  a: T[] = [],
  b: T[] = [],
  pick: (x: T, y: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    map.set(y.id, x ? pick(x, y) : y);
  }
  return [...map.values()];
}

export function mergeOrders(server: Order, client: Order): Order {
  const base = lww(server, client);
  const items = unionById(server.items, client.items, mergeItem);
  // Preserve the original insertion order: server items first, then new client items.
  const order = new Map<string, number>();
  [...server.items, ...client.items].forEach((i, idx) => {
    if (!order.has(i.id)) order.set(i.id, idx);
  });
  items.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));

  const log = unionById(server.log, client.log, (x) => x).sort((x, y) => x.at - y.at);
  const adjustments = unionById(server.adjustments, client.adjustments, (x) => x);

  const merged: Order = {
    ...base,
    items,
    log,
    adjustments,
    receiptPrints: Math.max(server.receiptPrints ?? 0, client.receiptPrints ?? 0),
    billPrintedAt: server.billPrintedAt ?? client.billPrintedAt,
    createdAt: Math.min(server.createdAt, client.createdAt),
    updatedAt: Math.max(server.updatedAt, client.updatedAt),
  };
  // Cancellation is sticky unless the cancelling side is older than an explicit reopen.
  if (server.status === "cancelled" && client.status !== "cancelled" && client.updatedAt < server.updatedAt) {
    merged.status = "cancelled";
    merged.cancelled = server.cancelled;
  }
  return merged;
}

function mergePayments(server: Payment, client: Payment): Payment {
  const base = lww(server, client);
  // Voiding a payment is irreversible.
  if (server.status === "voided" || client.status === "voided") {
    return { ...base, status: "voided" };
  }
  return base;
}

export function mergeRecords(entity: EntityName, server: BaseRecord, client: BaseRecord): BaseRecord {
  switch (entity) {
    case "orders":
      return mergeOrders(server as Order, client as Order);
    case "payments":
      return mergePayments(server as Payment, client as Payment);
    default: {
      // Deletion wins if it is the most recent action.
      return lww(server, client);
    }
  }
}
