import type { Order, OrderItem, Payment } from "./types";

/** Round half away from zero to an integer number of cents. */
export function roundCents(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function itemUnitPrice(item: Pick<OrderItem, "basePrice" | "modifiers">): number {
  return item.basePrice + item.modifiers.reduce((s, m) => s + m.price, 0);
}

export function itemLineTotal(item: OrderItem): number {
  return itemUnitPrice(item) * item.qty;
}

export function activeItems(order: Pick<Order, "items">): OrderItem[] {
  return order.items.filter((i) => !i.voided && i.qty > 0);
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  deliveryFee: number;
  adjustments: number;
  tax: number;
  tip: number;
  total: number;
  itemCount: number;
}

export function computeTotals(order: Order): OrderTotals {
  const items = activeItems(order);
  const subtotal = items.reduce((s, i) => s + itemLineTotal(i), 0);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  let discount = 0;
  if (order.discount && order.discount.value > 0) {
    discount =
      order.discount.type === "percent"
        ? roundCents((subtotal * Math.min(order.discount.value, 100)) / 100)
        : Math.min(order.discount.value, subtotal);
  }
  const afterDiscount = subtotal - discount;

  const serviceCharge =
    order.type === "dine_in" && order.serviceCharge && order.serviceChargeRate > 0
      ? roundCents((afterDiscount * order.serviceChargeRate) / 100)
      : 0;

  const deliveryFee = order.type === "delivery" ? order.deliveryFee : 0;

  const taxable = Math.max(0, afterDiscount + serviceCharge);
  const rate = order.taxRate / 100;
  let tax = 0;
  let gross: number;
  if (order.taxInclusive) {
    tax = rate > 0 ? roundCents(taxable - taxable / (1 + rate)) : 0;
    gross = afterDiscount + serviceCharge + deliveryFee + order.tip;
  } else {
    tax = roundCents(taxable * rate);
    gross = afterDiscount + serviceCharge + deliveryFee + tax + order.tip;
  }
  // Adjustments (goodwill refunds / credits) come off the final amount, after tax.
  const adjustments = Math.min(
    (order.adjustments ?? []).reduce((s, a) => s + a.amount, 0),
    Math.max(0, gross),
  );
  const total = gross - adjustments;

  return {
    subtotal,
    discount,
    serviceCharge,
    deliveryFee,
    adjustments,
    tax,
    tip: order.tip,
    total: Math.max(0, total),
    itemCount,
  };
}

export interface PaymentSummary {
  paid: number; // approved payments
  refunded: number; // approved refunds
  net: number; // paid - refunded
  balance: number; // total - net; > 0 due, < 0 owed to customer
  status: "unpaid" | "partial" | "paid" | "overpaid" | "refunded";
}

export function summarizePayments(total: number, payments: Payment[]): PaymentSummary {
  let paid = 0;
  let refunded = 0;
  for (const p of payments) {
    if (p.deleted || p.status !== "approved") continue;
    if (p.kind === "payment") paid += p.amount;
    else refunded += p.amount;
  }
  const net = paid - refunded;
  const balance = total - net;
  let status: PaymentSummary["status"];
  if (paid === 0) status = "unpaid";
  else if (refunded > 0 && net <= 0) status = "refunded";
  else if (balance > 0) status = "partial";
  else if (balance < 0) status = "overpaid";
  else status = "paid";
  return { paid, refunded, net, balance, status };
}

/** Split an amount into n parts that sum exactly to the amount. */
export function splitEvenly(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const rem = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Suggested cash notes for quick tender buttons. */
export function quickCashAmounts(due: number): number[] {
  if (due <= 0) return [];
  const steps = [100, 500, 1000, 2000, 5000, 10000];
  const set = new Set<number>([due]);
  for (const s of steps) {
    const v = Math.ceil(due / s) * s;
    if (v > due) set.add(v);
    if (set.size >= 5) break;
  }
  return [...set].sort((a, b) => a - b).slice(0, 5);
}
