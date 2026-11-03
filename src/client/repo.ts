"use client";
import { db, getMeta, setMeta, stripLocal, type Local } from "./db";
import { requestSync } from "./sync";
import { dayKey, uid } from "@/lib/format";
import { computeTotals, summarizePayments } from "@/lib/calc";
import type {
  EntityMap,
  EntityName,
  Order,
  OrderItem,
  OrderType,
  Payment,
  PaymentMethod,
  Settings,
  Staff,
} from "@/lib/types";

export interface DeviceInfo {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  token?: string; // absent when set up offline and not yet paired
  pairedAt?: number;
}

let lastTs = 0;
/** Strictly increasing timestamp so rapid successive edits order correctly. */
export function now(): number {
  const t = Date.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}

let outboxSeq = 0;

/**
 * Persist a record locally and queue it for sync — atomically, in one IndexedDB
 * transaction, so a crash can never leave a saved change that won't be uploaded.
 */
export async function save<E extends EntityName>(
  entity: E,
  record: EntityMap[E],
  opts: { keepTimestamp?: boolean } = {},
): Promise<EntityMap[E]> {
  const table = db.entity(entity);
  const rec = { ...stripLocal(record), updatedAt: opts.keepTimestamp ? record.updatedAt : now() } as EntityMap[E];
  await db.transaction("rw", table, db.outbox, async () => {
    const existing = await table.get(rec.id);
    const v = existing?._v ?? 0;
    await table.put({ ...rec, _v: v } as Local<EntityMap[E]>);
    const key = `${entity}:${rec.id}`;
    const pending = await db.outbox.get(key);
    outboxSeq = Math.max(outboxSeq + 1, Date.now() * 1000);
    await db.outbox.put({
      key,
      seq: pending?.seq ?? outboxSeq,
      mutationId: uid(),
      entity,
      recordId: rec.id,
      // Keep the version the *first* unsynced edit was based on, so the server can detect conflicts.
      baseVersion: pending ? pending.baseVersion : v,
      data: rec,
      attempts: 0,
      createdAt: pending?.createdAt ?? Date.now(),
    });
  });
  requestSync();
  return rec;
}

export async function softDelete<E extends EntityName>(entity: E, id: string) {
  const row = await db.entity(entity).get(id);
  if (!row) return;
  await save(entity, { ...stripLocal(row), deleted: true } as EntityMap[E]);
}

// ---------------------------------------------------------------- device & seq

export async function getDevice(): Promise<DeviceInfo | undefined> {
  return getMeta<DeviceInfo>("device");
}

export async function nextOrderNumber(deviceCode: string): Promise<string> {
  const key = `orderSeq:${dayKey()}`;
  let n = 0;
  await db.transaction("rw", db.meta, async () => {
    n = ((await getMeta<number>(key)) ?? 0) + 1;
    await setMeta(key, n);
  });
  return `${deviceCode}-${String(n).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- staff / pins

export async function hashPin(staffId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`pos:${staffId}:${pin}`);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback for non-secure contexts (plain http on LAN): FNV-1a, weaker but functional.
  let h = 0x811c9dc5;
  for (const b of data) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return `fnv-${(h >>> 0).toString(16)}`;
}

export async function findStaffByPin(pin: string): Promise<Staff | undefined> {
  const staff = (await db.staff.toArray()).filter((s) => s.active && !s.deleted);
  for (const s of staff) {
    if ((await hashPin(s.id, pin)) === s.pinHash) return stripLocal(s);
  }
  return undefined;
}

export async function isPinTaken(pin: string, exceptId?: string): Promise<boolean> {
  const staff = (await db.staff.toArray()).filter((s) => !s.deleted && s.id !== exceptId);
  for (const s of staff) if ((await hashPin(s.id, pin)) === s.pinHash) return true;
  return false;
}

// ---------------------------------------------------------------- orders

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get("store");
  return s ? stripLocal(s) : defaultSettings();
}

export function defaultSettings(): Settings {
  const t = Date.now();
  return {
    id: "store",
    createdAt: t,
    updatedAt: 0,
    businessName: "My Cafe",
    address: "123 Main Street",
    phone: "",
    taxId: "",
    currency: "USD",
    locale: "en-US",
    taxRate: 8,
    taxInclusive: false,
    serviceChargeRate: 0,
    deliveryFee: 300,
    tipsEnabled: true,
    tipPresets: [10, 15, 20],
    receiptHeader: "",
    receiptFooter: "Thank you! Please come again.",
    paperWidth: "80",
    discountApprovalThreshold: 15,
    autoPrintReceipt: false,
  };
}

export function blankOrder(
  type: OrderType,
  settings: Settings,
  device: DeviceInfo,
  by: string,
  extra: Partial<Order> = {},
): Order {
  const t = now();
  return {
    id: uid(),
    createdAt: t,
    updatedAt: t,
    number: "",
    deviceCode: device.deviceCode,
    type,
    status: "open",
    fulfillment: "new",
    customer: { name: "", phone: "", address: "" },
    items: [],
    serviceCharge: settings.serviceChargeRate > 0,
    tip: 0,
    deliveryFee: type === "delivery" ? settings.deliveryFee : 0,
    adjustments: [],
    note: "",
    createdBy: by,
    receiptPrints: 0,
    log: [],
    taxRate: settings.taxRate,
    taxInclusive: settings.taxInclusive,
    serviceChargeRate: settings.serviceChargeRate,
    ...extra,
  };
}

export function logEntry(by: string, action: string, detail?: string) {
  return { id: uid(), at: now(), by, action, detail };
}

/** Persist an order (assigning its number on first save). */
export async function saveOrder(order: Order, by: string, action?: string, detail?: string): Promise<Order> {
  const o: Order = { ...order, log: [...order.log] };
  if (!o.number) {
    const device = await getDevice();
    o.number = await nextOrderNumber(device?.deviceCode ?? o.deviceCode ?? "X");
    o.log.push(logEntry(by, "Order created", `#${o.number}`));
  }
  if (action) o.log.push(logEntry(by, action, detail));
  return save("orders", o);
}

/** Read the freshest copy, apply a change and save. Avoids clobbering concurrent edits from other tabs. */
export async function updateOrder(
  id: string,
  by: string,
  fn: (o: Order) => Order | void,
  action?: string,
  detail?: string,
): Promise<Order | undefined> {
  const row = await db.orders.get(id);
  if (!row) return undefined;
  const o = structuredClone(stripLocal(row));
  const res = fn(o) ?? o;
  return saveOrder(res, by, action, detail);
}

export async function sendToKitchen(id: string, by: string): Promise<number> {
  let count = 0;
  await updateOrder(
    id,
    by,
    (o) => {
      const t = now();
      for (const it of o.items) {
        if (it.status === "new" && !it.voided) {
          it.status = "sent";
          it.sentAt = t;
          it.updatedAt = t;
          count++;
        }
      }
      if (count && (o.fulfillment === "new" || o.fulfillment === "ready" || o.fulfillment === "done")) {
        o.fulfillment = "in_kitchen";
      }
    },
    "Sent to kitchen",
  );
  return count;
}

export async function orderPayments(orderId: string): Promise<Payment[]> {
  return (await db.payments.where("orderId").equals(orderId).toArray()).filter((p) => !p.deleted).map(stripLocal);
}

export async function recordPayment(args: {
  order: Order;
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
  status?: Payment["status"];
  by: string;
  kind?: Payment["kind"];
  reason?: string;
}): Promise<Payment> {
  const device = await getDevice();
  const t = now();
  const p: Payment = {
    id: uid(),
    createdAt: t,
    updatedAt: t,
    orderId: args.order.id,
    orderNumber: args.order.number,
    kind: args.kind ?? "payment",
    method: args.method,
    amount: args.amount,
    tendered: args.tendered,
    change: args.tendered != null ? Math.max(0, args.tendered - args.amount) : undefined,
    status: args.status ?? "approved",
    reference: args.reference ?? "",
    reason: args.reason,
    by: args.by,
    deviceCode: device?.deviceCode ?? "",
  };
  await save("payments", p);
  return p;
}

/** Close the order automatically when fully paid; reopen it when an edit leaves a balance. */
export async function reconcileOrderStatus(orderId: string, by: string): Promise<void> {
  const row = await db.orders.get(orderId);
  if (!row || row.status === "cancelled") return;
  const order = stripLocal(row);
  const payments = await orderPayments(orderId);
  const totals = computeTotals(order);
  const sum = summarizePayments(totals.total, payments);
  if (order.status === "open" && totals.itemCount > 0 && sum.balance <= 0) {
    await updateOrder(orderId, by, (o) => {
      o.status = "closed";
      o.closedAt = now();
      if (o.type === "takeaway" && o.fulfillment === "new") o.fulfillment = "in_kitchen";
    }, "Order paid & closed");
  } else if (order.status === "closed" && sum.balance > 0) {
    await updateOrder(orderId, by, (o) => {
      o.status = "open";
      o.closedAt = undefined;
    }, "Order reopened", "Balance due after edit");
  }
}

export function newItemFromMenu(args: {
  menuItemId: string;
  name: string;
  basePrice: number;
  modifiers: OrderItem["modifiers"];
  qty: number;
  notes: string;
  by: string;
}): OrderItem {
  return {
    id: uid(),
    menuItemId: args.menuItemId,
    name: args.name,
    basePrice: args.basePrice,
    modifiers: args.modifiers,
    qty: args.qty,
    notes: args.notes,
    status: "new",
    addedBy: args.by,
    updatedAt: now(),
  };
}

/** Same item with same modifiers & notes that hasn't gone to the kitchen yet → merge qty. */
export function sameLine(a: OrderItem, b: OrderItem): boolean {
  if (a.menuItemId !== b.menuItemId || a.notes.trim() !== b.notes.trim() || a.voided || b.voided) return false;
  if (a.status !== "new" || b.status !== "new") return false;
  const ka = a.modifiers.map((m) => m.optionId).sort().join(",");
  const kb = b.modifiers.map((m) => m.optionId).sort().join(",");
  return ka === kb;
}

/** Look for a very similar order placed on this device recently (double submit / duplicate ticket). */
export async function findPossibleDuplicate(order: Order): Promise<Order | undefined> {
  const since = Date.now() - 3 * 60_000;
  const recent = await db.orders.where("createdAt").above(since).toArray();
  const sig = (o: Order) =>
    o.items
      .filter((i) => !i.voided)
      .map((i) => `${i.menuItemId}x${i.qty}:${i.modifiers.map((m) => m.optionId).sort().join("+")}`)
      .sort()
      .join("|");
  const mine = sig(order);
  if (!mine) return undefined;
  return recent
    .map(stripLocal)
    .find(
      (o) =>
        o.id !== order.id &&
        o.status !== "cancelled" &&
        !o.deleted &&
        o.type === order.type &&
        (o.tableId ?? "") === (order.tableId ?? "") &&
        sig(o) === mine,
    );
}
