"use client";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { db, stripLocal } from "@/client/db";
import {
  logEntry,
  now,
  orderPayments,
  reconcileOrderStatus,
  recordPayment,
  save,
  updateOrder,
} from "@/client/repo";
import { useSession } from "@/client/session";
import { useOpenOrders, useTables } from "@/client/hooks";
import { computeTotals, itemLineTotal, summarizePayments } from "@/lib/calc";
import { centsToInput, formatMoney, METHOD_LABEL, parseMoney, uid } from "@/lib/format";
import type { Customer, Discount, Order, OrderItem, Payment, PaymentMethod } from "@/lib/types";
import { printNode } from "./print";
import { Receipt } from "./Receipt";
import { Badge, Button, Field, Input, Modal, Segmented, Textarea, cx, useConfirm, useToast } from "./ui";

export const VOID_REASONS = ["Customer changed mind", "Entered by mistake", "Out of stock", "Quality issue", "Took too long"];
export const CANCEL_REASONS = ["Customer changed mind", "Duplicate order", "Entered by mistake", "Customer left", "Kitchen unable to prepare"];
export const REFUND_REASONS = ["Quality issue", "Wrong item served", "Item not received", "Customer complaint", "Overcharged"];

export function useMoney() {
  const { settings } = useSession();
  return (c: number) => formatMoney(c, settings.currency, settings.locale);
}

async function tableNameOf(order: Order): Promise<string | undefined> {
  if (!order.tableId) return undefined;
  return (await db.diningTables.get(order.tableId))?.name;
}

export function useOrderActions() {
  const { staff, settings, requestApproval } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const money = useMoney();
  const by = staff.name;

  return useMemo(
    () => ({
      async printReceipt(order: Order, reprint?: boolean) {
        const payments = await orderPayments(order.id);
        const tableName = await tableNameOf(order);
        const isReprint = reprint ?? order.receiptPrints > 0;
        await updateOrder(order.id, by, (o) => {
          o.receiptPrints = (o.receiptPrints ?? 0) + 1;
        }, isReprint ? "Receipt reprinted" : "Receipt printed");
        await printNode(
          <Receipt order={order} payments={payments} settings={settings} kind="receipt" tableName={tableName} reprint={isReprint} />,
          settings.paperWidth,
        );
      },

      async printBill(order: Order) {
        const payments = await orderPayments(order.id);
        const tableName = await tableNameOf(order);
        await updateOrder(order.id, by, (o) => {
          o.billPrintedAt = now();
        }, "Guest check printed");
        await printNode(<Receipt order={order} payments={payments} settings={settings} kind="bill" tableName={tableName} />, settings.paperWidth);
      },

      async printKitchen(order: Order, items?: OrderItem[]) {
        const tableName = await tableNameOf(order);
        await printNode(
          <Receipt order={order} payments={[]} settings={settings} kind="kitchen" tableName={tableName} items={items ?? order.items} />,
          settings.paperWidth,
        );
      },

      /** Returns true when the order was cancelled. */
      async cancelOrder(order: Order): Promise<boolean> {
        const payments = await orderPayments(order.id);
        const sum = summarizePayments(computeTotals(order).total, payments);
        if (sum.net > 0) {
          toast.error(`This order has ${money(sum.net)} paid. Refund the payment first, then cancel.`);
          return false;
        }
        const sent = order.items.some((i) => i.status !== "new" && !i.voided);
        const res = await confirm({
          title: `Cancel order #${order.number || "new"}?`,
          message: sent ? "Some items were already sent to the kitchen. The kitchen will see this order as cancelled." : "The order will be voided and kept for reporting.",
          confirmLabel: "Cancel order",
          cancelLabel: "Keep order",
          tone: "danger",
          reason: { label: "Reason", options: CANCEL_REASONS },
        });
        if (!res.ok) return false;
        let approver = staff;
        if (sent) {
          const a = await requestApproval(`Cancel order #${order.number} (items already in kitchen)`);
          if (!a) return false;
          approver = a;
        }
        await updateOrder(order.id, by, (o) => {
          o.status = "cancelled";
          o.cancelled = { reason: res.reason, by: approver.name, at: now() };
        }, "Order cancelled", `${res.reason}${approver.id !== staff.id ? ` · approved by ${approver.name}` : ""}`);
        toast.success(`Order #${order.number} cancelled`);
        return true;
      },

      /** Void `qty` units of a line. Sent items require a reason and manager approval. */
      async voidItem(order: Order, item: OrderItem, qty = item.qty): Promise<boolean> {
        if (item.status === "new") {
          await updateOrder(order.id, by, (o) => {
            const it = o.items.find((x) => x.id === item.id);
            if (!it) return;
            if (qty >= it.qty) o.items = o.items.filter((x) => x.id !== item.id);
            else {
              it.qty -= qty;
              it.updatedAt = now();
            }
          }, "Item removed", `${qty}× ${item.name}`);
          return true;
        }
        const res = await confirm({
          title: `Void ${qty}× ${item.name}?`,
          message: "This item was already sent to the kitchen. The void is recorded and shown on the kitchen display.",
          confirmLabel: "Void item",
          tone: "danger",
          reason: { label: "Reason", options: VOID_REASONS },
        });
        if (!res.ok) return false;
        const approver = await requestApproval(`Void ${qty}× ${item.name} on #${order.number}`);
        if (!approver) return false;
        await updateOrder(order.id, by, (o) => {
          const it = o.items.find((x) => x.id === item.id);
          if (!it) return;
          const voided = { reason: res.reason, by: approver.name, at: now() };
          if (qty >= it.qty) {
            it.voided = voided;
            it.updatedAt = now();
          } else {
            it.qty -= qty;
            it.updatedAt = now();
            o.items.push({ ...structuredClone(it), id: uid(), qty, voided, updatedAt: now() });
          }
        }, "Item voided", `${qty}× ${item.name} · ${res.reason} · approved by ${approver.name}`);
        await reconcileOrderStatus(order.id, by);
        return true;
      },

      async voidPayment(payment: Payment): Promise<boolean> {
        const res = await confirm({
          title: `Void ${METHOD_LABEL[payment.method]} payment of ${money(payment.amount)}?`,
          message: "Use this only when a payment was recorded by mistake. For money returned to a customer, use Refund instead.",
          confirmLabel: "Void payment",
          tone: "danger",
          reason: { label: "Reason", options: ["Recorded by mistake", "Wrong amount", "Wrong method", "Duplicate payment"] },
        });
        if (!res.ok) return false;
        const approver = await requestApproval(`Void payment ${money(payment.amount)} on #${payment.orderNumber}`);
        if (!approver) return false;
        await save("payments", { ...payment, status: "voided", reason: `${res.reason} · approved by ${approver.name}` });
        await updateOrder(payment.orderId, by, () => {}, "Payment voided", `${METHOD_LABEL[payment.method]} ${money(payment.amount)} · ${res.reason}`);
        await reconcileOrderStatus(payment.orderId, by);
        toast.success("Payment voided");
        return true;
      },

      /** Unlock a closed (paid) order for editing. */
      async unlockClosed(order: Order): Promise<boolean> {
        const a = await requestApproval(`Edit paid order #${order.number}`);
        if (!a) return false;
        await updateOrder(order.id, by, () => {}, "Paid order unlocked for editing", `approved by ${a.name}`);
        return true;
      },
    }),
    [by, settings, staff, confirm, toast, money, requestApproval],
  );
}

// ------------------------------------------------------------------ Discount

export function DiscountModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const { staff, settings, requestApproval } = useSession();
  const money = useMoney();
  const toast = useToast();
  const [type, setType] = useState<Discount["type"]>("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setType(order.discount?.type ?? "percent");
    setValue(order.discount ? (order.discount.type === "percent" ? String(order.discount.value) : centsToInput(order.discount.value)) : "");
    setReason(order.discount?.reason ?? "");
  }, [open, order.discount]);

  const subtotal = computeTotals(order).subtotal;
  const numeric = type === "percent" ? Number(value) : parseMoney(value);
  const valid = value !== "" && Number.isFinite(numeric) && numeric > 0 && (type === "percent" ? numeric <= 100 : numeric <= subtotal);
  const pct = type === "percent" ? numeric : subtotal ? (numeric / subtotal) * 100 : 0;
  const amount = type === "percent" ? Math.round((subtotal * (numeric || 0)) / 100) : numeric || 0;
  const needsApproval = valid && pct > settings.discountApprovalThreshold;

  async function apply() {
    let approvedBy: string | undefined;
    if (needsApproval) {
      const a = await requestApproval(`Discount of ${type === "percent" ? `${numeric}%` : money(numeric)} on #${order.number || "new order"}`);
      if (!a) return;
      approvedBy = a.name;
    }
    await updateOrder(order.id, staff.name, (o) => {
      o.discount = { type, value: numeric, reason: reason.trim(), approvedBy };
    }, "Discount applied", `${type === "percent" ? `${numeric}%` : money(numeric)}${reason ? ` · ${reason}` : ""}${approvedBy ? ` · approved by ${approvedBy}` : ""}`);
    toast.success("Discount applied");
    onClose();
  }

  async function remove() {
    await updateOrder(order.id, staff.name, (o) => {
      o.discount = undefined;
    }, "Discount removed");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order discount"
      size="sm"
      footer={
        <>
          {order.discount && (
            <Button variant="ghost" className="mr-auto text-rose-600" onClick={remove}>
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={apply}>
            Apply {valid ? `−${money(amount)}` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={type} onChange={(v) => { setType(v); setValue(""); }} options={[{ value: "percent", label: "Percent %" }, { value: "amount", label: "Fixed amount" }]} />
        <div className="flex flex-wrap gap-2">
          {(type === "percent" ? ["5", "10", "15", "20", "50"] : ["1.00", "2.00", "5.00", "10.00"]).map((v) => (
            <button key={v} onClick={() => setValue(v)} className={cx("h-10 rounded-full border px-4 text-sm font-semibold", value === v ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong")}>
              {type === "percent" ? `${v}%` : money(parseMoney(v))}
            </button>
          ))}
        </div>
        <Field label={type === "percent" ? "Percent" : "Amount"} error={value && !valid ? (type === "percent" ? "Enter 0–100" : `Max ${money(subtotal)}`) : undefined}>
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "e.g. 10" : "e.g. 5.00"} />
        </Field>
        <Field label="Reason (shown on receipt)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Staff meal, Loyalty, Promo" />
        </Field>
        {needsApproval && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Discounts over {settings.discountApprovalThreshold}% need manager approval.</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Customer details

export function CustomerModal({
  open,
  onClose,
  initial,
  onSave,
  requireAddress,
  title = "Customer details",
}: {
  open: boolean;
  onClose: () => void;
  initial: Customer;
  onSave: (c: Customer) => void;
  requireAddress?: boolean;
  title?: string;
}) {
  const [c, setC] = useState<Customer>(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setC(initial);
      setTouched(false);
    }
  }, [open, initial]);
  const errors = {
    name: requireAddress && !c.name.trim() ? "Name is required for delivery" : undefined,
    phone: requireAddress && c.phone.replace(/\D/g, "").length < 6 ? "Enter a valid phone number" : undefined,
    address: requireAddress && c.address.trim().length < 5 ? "Delivery address is required" : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              onSave({ name: c.name.trim(), phone: c.phone.trim(), address: c.address.trim() });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" error={touched ? errors.name : undefined}>
          <Input autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="Customer name" />
        </Field>
        <Field label="Phone" error={touched ? errors.phone : undefined}>
          <Input type="tel" inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} placeholder="Phone number" />
        </Field>
        {requireAddress && (
          <Field label="Delivery address" error={touched ? errors.address : undefined}>
            <Textarea value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} placeholder="Street, building, apartment, landmark" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Table picker

export function TablePickerModal({
  open,
  onClose,
  currentOrderId,
  selectedId,
  guests,
  onPick,
  onOpenExisting,
}: {
  open: boolean;
  onClose: () => void;
  currentOrderId?: string;
  selectedId?: string;
  guests?: number;
  onPick: (tableId: string, guests: number) => void;
  onOpenExisting: (orderId: string) => void;
}) {
  const tables = useTables();
  const openOrders = useOpenOrders();
  const confirm = useConfirm();
  const [g, setG] = useState(guests ?? 2);
  useEffect(() => {
    if (open) setG(guests || 2);
  }, [open, guests]);

  const occupied = new Map<string, Order[]>();
  for (const o of openOrders ?? []) {
    if (o.tableId && o.id !== currentOrderId && o.type === "dine_in") occupied.set(o.tableId, [...(occupied.get(o.tableId) ?? []), o]);
  }
  const areas = [...new Set((tables ?? []).map((t) => t.area || "Main"))];

  async function pick(id: string) {
    const existing = occupied.get(id);
    if (existing?.length) {
      const res = await confirm({
        title: `Table already has an open order`,
        message: (
          <>
            Order <b>#{existing[0].number}</b> is open on this table. Open that order instead of starting a second check?
          </>
        ),
        confirmLabel: `Open #${existing[0].number}`,
        cancelLabel: "Use as separate check",
      });
      if (res.ok) {
        onOpenExisting(existing[0].id);
        onClose();
        return;
      }
    }
    onPick(id, g);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Choose a table" size="lg">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
        <span className="flex items-center gap-2 font-semibold">
          <Users className="size-5 text-muted" /> Guests
        </span>
        <div className="flex items-center gap-2">
          <button className="flex size-10 items-center justify-center rounded-xl bg-surface-3" onClick={() => setG((x) => Math.max(1, x - 1))} aria-label="Fewer guests">
            <Minus className="size-4" />
          </button>
          <span className="w-8 text-center text-lg font-bold tabular">{g}</span>
          <button className="flex size-10 items-center justify-center rounded-xl bg-surface-3" onClick={() => setG((x) => Math.min(50, x + 1))} aria-label="More guests">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      {areas.map((area) => (
        <div key={area} className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{area}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {(tables ?? [])
              .filter((t) => (t.area || "Main") === area)
              .map((t) => {
                const occ = occupied.get(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t.id)}
                    className={cx(
                      "flex h-20 flex-col items-center justify-center rounded-2xl border-2 text-center transition active:scale-95",
                      selectedId === t.id
                        ? "border-brand bg-brand-soft"
                        : occ
                          ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
                          : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span className="text-lg font-bold">{t.name}</span>
                    <span className="text-xs text-muted">{occ ? `#${occ[0].number}` : `${t.seats} seats`}</span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {tables?.length === 0 && <p className="py-8 text-center text-muted">No tables yet. Add tables in Settings → Tables.</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Refund

export function RefundModal({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const { staff, requestApproval } = useSession();
  const money = useMoney();
  const toast = useToast();
  const [mode, setMode] = useState<"items" | "amount" | "full">("items");
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [amountStr, setAmountStr] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQtys({});
    setAmountStr("");
    setReason("");
    setReference("");
    setMode("items");
    orderPayments(order.id).then((ps) => {
      setPayments(ps);
      const main = ps.filter((p) => p.kind === "payment" && p.status === "approved").sort((a, b) => b.amount - a.amount)[0];
      if (main) setMethod(main.method);
    });
  }, [open, order.id]);

  const totals = computeTotals(order);
  const sum = summarizePayments(totals.total, payments);
  const refundable = Math.max(0, sum.net);
  const items = order.items.filter((i) => !i.voided);

  // Item mode: amount = how much the order total drops when those units are removed.
  const itemRefund = useMemo(() => {
    const sim = structuredClone(order);
    for (const it of sim.items) {
      const q = qtys[it.id] ?? 0;
      if (q > 0) it.qty -= q;
    }
    return Math.max(0, totals.total - computeTotals(sim).total);
  }, [order, qtys, totals.total]);

  const amount = mode === "items" ? Math.min(itemRefund, refundable) : mode === "full" ? refundable : Math.min(parseMoney(amountStr) || 0, refundable);
  const valid = amount > 0 && reason.trim().length > 0 && (mode !== "items" || Object.values(qtys).some((q) => q > 0));

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const approver = await requestApproval(`Refund ${money(amount)} on #${order.number}`);
      if (!approver) return;
      const detail = `${money(amount)} via ${METHOD_LABEL[method]} · ${reason}${approver.id !== staff.id ? ` · approved by ${approver.name}` : ""}`;
      // Adjust the order first so totals and the refund stay consistent.
      await updateOrder(order.id, staff.name, (o) => {
        const t = now();
        if (mode === "items") {
          for (const it of o.items) {
            const q = qtys[it.id] ?? 0;
            if (q <= 0) continue;
            const voided = { reason: `Refunded: ${reason}`, by: approver.name, at: t, refunded: true };
            if (q >= it.qty) {
              it.voided = voided;
              it.updatedAt = t;
            } else {
              it.qty -= q;
              it.updatedAt = t;
              o.items.push({ ...structuredClone(it), id: uid(), qty: q, voided, updatedAt: t });
            }
          }
        } else {
          o.adjustments = [...(o.adjustments ?? []), { id: uid(), amount, reason: `Refund · ${reason}`, by: approver.name, at: t }];
        }
        o.log.push(logEntry(staff.name, "Refund issued", detail));
      });
      await recordPayment({ order, method, amount, by: staff.name, kind: "refund", reason, reference });
      await reconcileOrderStatus(order.id, staff.name);
      toast.success(`Refunded ${money(amount)}${method === "cash" ? " — give cash back to customer" : ""}`);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Refund order #${order.number}`}
      subtitle={`Paid ${money(sum.paid)}${sum.refunded ? ` · already refunded ${money(sum.refunded)}` : ""} · refundable ${money(refundable)}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!valid} loading={busy} onClick={submit}>
            Refund {amount > 0 ? money(amount) : ""}
          </Button>
        </>
      }
    >
      {refundable <= 0 ? (
        <p className="py-6 text-center text-muted">Nothing left to refund on this order.</p>
      ) : (
        <div className="space-y-4">
          <Segmented value={mode} onChange={setMode} options={[{ value: "items", label: "By item" }, { value: "amount", label: "Custom amount" }, { value: "full", label: "Full refund" }]} />
          {mode === "items" && (
            <div className="divide-y divide-line rounded-2xl border border-line">
              {items.map((it) => {
                const q = qtys[it.id] ?? 0;
                return (
                  <div key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {it.qty}× {it.name}
                      </p>
                      <p className="text-sm text-muted">{money(itemLineTotal(it))}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button className="flex size-9 items-center justify-center rounded-lg bg-surface-3 disabled:opacity-40" disabled={q <= 0} onClick={() => setQtys({ ...qtys, [it.id]: q - 1 })} aria-label="Less">
                        <Minus className="size-4" />
                      </button>
                      <span className={cx("w-7 text-center font-bold tabular", q > 0 && "text-rose-600")}>{q}</span>
                      <button className="flex size-9 items-center justify-center rounded-lg bg-surface-3 disabled:opacity-40" disabled={q >= it.qty} onClick={() => setQtys({ ...qtys, [it.id]: q + 1 })} aria-label="More">
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {mode === "amount" && (
            <Field label="Refund amount" hint={`Up to ${money(refundable)}`}>
              <Input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0.00" autoFocus />
            </Field>
          )}
          {mode === "full" && <p className="rounded-xl bg-surface-2 px-4 py-3 text-[15px]">The full remaining amount of <b>{money(refundable)}</b> will be refunded.</p>}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-2">Refund to</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <button key={m} onClick={() => setMethod(m)} className={cx("h-10 rounded-full border px-4 text-sm font-semibold", method === m ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong")}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          {method !== "cash" && (
            <Field label="Reference (optional)">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Terminal refund ref / last 4 digits" />
            </Field>
          )}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-2">Reason</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {REFUND_REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} className={cx("rounded-full border px-3.5 py-2 text-sm font-medium", reason === r ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong")}>
                  {r}
                </button>
              ))}
            </div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" />
          </div>
          {mode === "items" && itemRefund > refundable && (
            <Badge tone="amber">Capped at the refundable amount of {money(refundable)}</Badge>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Note

export function NoteModal({ open, onClose, initial, onSave, title = "Order note" }: { open: boolean; onClose: () => void; initial: string; onSave: (v: string) => void; title?: string }) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(v.trim());
              onClose();
            }}
          >
            Save note
          </Button>
        </>
      }
    >
      <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Birthday — bring dessert with candle" />
    </Modal>
  );
}

export async function getFreshOrder(id: string): Promise<Order | undefined> {
  const row = await db.orders.get(id);
  return row ? stripLocal(row) : undefined;
}
