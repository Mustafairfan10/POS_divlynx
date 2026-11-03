"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  Lock,
  Minus,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  Smartphone,
  Split,
  Wallet,
  XCircle,
} from "lucide-react";
import { useSession } from "@/client/session";
import { useOrder, useOrderPayments, useTables } from "@/client/hooks";
import { orderPayments, reconcileOrderStatus, recordPayment, sameLine, sendToKitchen, now, updateOrder } from "@/client/repo";
import { computeTotals, quickCashAmounts, splitEvenly, summarizePayments } from "@/lib/calc";
import { centsToInput, formatTime, METHOD_LABEL, parseMoney, uid } from "@/lib/format";
import type { Order, OrderItem, Payment, PaymentMethod } from "@/lib/types";
import { Badge, Button, EmptyState, Field, Input, Modal, Segmented, Spinner, Toggle, cx, useBusy, useConfirm, useToast } from "../ui";
import { Receipt } from "../Receipt";
import { OrderLines } from "../OrderLines";
import { DiscountModal, getFreshOrder, useMoney, useOrderActions } from "../orderActions";
import { ItemModal } from "../ItemModal";
import { useMenuItems, useModifierGroups } from "@/client/hooks";

const METHODS: Array<{ id: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "wallet", label: "Wallet", icon: Smartphone },
  { id: "other", label: "Other", icon: Wallet },
];

export function CheckoutView() {
  const { activeOrderId, go, startNewOrder } = useSession();
  const order = useOrder(activeOrderId);
  const payments = useOrderPayments(activeOrderId);

  if (order === undefined || payments === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (!order) {
    return (
      <EmptyState icon={<ReceiptIcon className="size-7" />} title="No order selected" action={<Button variant="primary" onClick={() => startNewOrder()}>Start a new order</Button>}>
        Pick an order from Orders or Tables, or <button className="font-semibold text-brand underline" onClick={() => go("orders")}>view all orders</button>.
      </EmptyState>
    );
  }
  return <Checkout order={order} payments={payments} />;
}

function Checkout({ order, payments }: { order: Order; payments: Payment[] }) {
  const { go, settings, startNewOrder } = useSession();
  const tables = useTables();
  const actions = useOrderActions();
  const [panel, setPanel] = useState<"pay" | "slip" | "edit">("pay");
  const [leftMode, setLeftMode] = useState<"slip" | "edit">("slip");

  const totals = computeTotals(order);
  const approved = payments.filter((p) => p.status === "approved");
  const sum = summarizePayments(totals.total, approved);
  const tableName = tables?.find((t) => t.id === order.tableId)?.name;
  const slipKind = sum.balance > 0 ? "bill" : "receipt";

  const slip = (
    <div className="rounded-2xl bg-surface-3 p-3 sm:p-6">
      <div className="mx-auto max-w-[360px] overflow-hidden rounded-md shadow-pop">
        <Receipt order={order} payments={approved} settings={settings} kind={slipKind} tableName={tableName} />
      </div>
      <div className="mx-auto mt-4 flex max-w-[360px] gap-2">
        <Button variant="outline" block icon={<FileText className="size-4" />} onClick={() => actions.printBill(order)}>
          Print bill
        </Button>
        <Button variant="outline" block icon={<Printer className="size-4" />} onClick={() => actions.printReceipt(order)} disabled={sum.paid === 0}>
          {order.receiptPrints > 0 ? "Reprint" : "Receipt"}
        </Button>
      </div>
    </div>
  );

  const editor = <EditOrderPanel order={order} onAddItems={() => go("register")} />;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => go("register")}>
          Order
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">Checkout · #{order.number}</p>
          <p className="truncate text-xs text-muted">
            {order.type === "dine_in" ? `Dine-in${tableName ? ` · Table ${tableName}` : ""}` : order.type === "takeaway" ? "Takeaway" : "Delivery"}
            {order.customer.name ? ` · ${order.customer.name}` : ""} · {totals.itemCount} items
          </p>
        </div>
        <PayStatusBadge status={order.status === "cancelled" ? "cancelled" : sum.status} />
      </div>
      {/* Phone/tablet tabs */}
      <div className="shrink-0 border-b border-line bg-surface px-3 py-2 lg:hidden">
        <Segmented
          value={panel}
          onChange={setPanel}
          options={[
            { value: "pay", label: "Payment", icon: <CreditCard className="size-4" /> },
            { value: "slip", label: "Slip", icon: <ReceiptIcon className="size-4" /> },
            { value: "edit", label: "Edit order", icon: <Pencil className="size-4" /> },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: live slip / editor (desktop) */}
        <section className="hidden min-w-0 flex-1 flex-col border-r border-line lg:flex">
          <div className="flex items-center justify-between gap-3 px-5 pt-4">
            <Segmented
              className="w-72"
              value={leftMode}
              onChange={setLeftMode}
              options={[
                { value: "slip", label: "Checkout slip", icon: <ReceiptIcon className="size-4" /> },
                { value: "edit", label: "Edit order", icon: <Pencil className="size-4" /> },
              ]}
            />
            <p className="text-sm text-muted">{leftMode === "slip" ? "Updates live as the order changes" : "Changes update the slip and amount due instantly"}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{leftMode === "slip" ? slip : editor}</div>
        </section>

        {/* Right: payment */}
        <section className={cx("min-h-0 w-full flex-col overflow-y-auto lg:flex lg:w-[440px] lg:shrink-0", panel === "pay" ? "flex" : "hidden")}>
          <PaymentPanel order={order} payments={payments} onDone={() => (order.type === "dine_in" ? go("tables") : startNewOrder())} />
        </section>
        {panel === "slip" && <section className="min-h-0 w-full overflow-y-auto p-3 lg:hidden">{slip}</section>}
        {panel === "edit" && <section className="min-h-0 w-full overflow-y-auto p-3 lg:hidden">{editor}</section>}
      </div>
    </div>
  );
}

export function PayStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "gray" | "green" | "amber" | "red" | "blue" | "violet"; label: string }> = {
    unpaid: { tone: "amber", label: "Unpaid" },
    partial: { tone: "blue", label: "Partially paid" },
    paid: { tone: "green", label: "Paid" },
    overpaid: { tone: "violet", label: "Overpaid" },
    refunded: { tone: "red", label: "Refunded" },
    cancelled: { tone: "red", label: "Cancelled" },
  };
  const m = map[status] ?? map.unpaid;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

// ------------------------------------------------------------------ Edit order (inline in checkout)

function EditOrderPanel({ order, onAddItems }: { order: Order; onAddItems: () => void }) {
  const { staff, settings } = useSession();
  const money = useMoney();
  const actions = useOrderActions();
  const toast = useToast();
  const menuItems = useMenuItems();
  const groups = useModifierGroups();
  const [unlocked, setUnlocked] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [editing, setEditing] = useState<OrderItem | null>(null);
  const locked = order.status === "cancelled" || (order.status === "closed" && !unlocked);
  const totals = computeTotals(order);

  const update = async (fn: (o: Order) => void, action?: string, detail?: string) => {
    await updateOrder(order.id, staff.name, fn, action, detail);
    await reconcileOrderStatus(order.id, staff.name);
  };

  const handlers = {
    onIncrement: (it: OrderItem) =>
      update((o) => {
        if (it.status === "new") {
          const x = o.items.find((i) => i.id === it.id);
          if (x) {
            x.qty++;
            x.updatedAt = now();
          }
        } else {
          const clone: OrderItem = { ...structuredClone(it), id: uid(), qty: 1, status: "new", sentAt: undefined, addedBy: staff.name, updatedAt: now() };
          const same = o.items.find((i) => sameLine(i, clone));
          if (same) same.qty++;
          else o.items.push(clone);
        }
      }, "Quantity increased", it.name),
    onDecrement: (it: OrderItem) =>
      it.status === "new"
        ? update((o) => {
            const x = o.items.find((i) => i.id === it.id);
            if (x && x.qty > 1) {
              x.qty--;
              x.updatedAt = now();
            }
          }, "Quantity decreased", it.name)
        : actions.voidItem(order, it, 1),
    onRemove: async (it: OrderItem) => {
      if (order.items.filter((i) => !i.voided).length === 1 && it.qty <= 1) {
        toast.warning("An order needs at least one item. Cancel the order instead.");
        return;
      }
      if (it.status === "new") await update((o) => void (o.items = o.items.filter((i) => i.id !== it.id)), "Item removed", `${it.qty}× ${it.name}`);
      else await actions.voidItem(order, it, it.qty);
    },
    onEdit: (it: OrderItem) => setEditing(it),
  };

  if (locked) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3">
          <Lock className="size-7 text-muted" />
        </div>
        <p className="text-lg font-bold">{order.status === "cancelled" ? "Cancelled orders can’t be edited" : "This order is fully paid"}</p>
        {order.status === "closed" && (
          <>
            <p className="mt-1 text-muted">Editing a paid order needs manager approval. If the total changes you’ll be guided to collect the difference or refund it.</p>
            <Button className="mt-4" variant="primary" icon={<Lock className="size-4" />} onClick={async () => (await actions.unlockClosed(order)) && setUnlocked(true)}>
              Unlock to edit
            </Button>
          </>
        )}
      </div>
    );
  }

  const editingMenu = editing ? menuItems?.find((m) => m.id === editing.menuItemId) ?? null : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-bold">Items</h3>
          <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={onAddItems}>
            Add items
          </Button>
        </div>
        <OrderLines order={order} {...handlers} />
      </div>

      <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface p-4">
        <h3 className="font-bold">Adjustments</h3>
        <button onClick={() => setDiscountOpen(true)} className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-surface-2">
          <Percent className="size-5 text-muted" />
          <span className="flex-1 font-semibold">Discount</span>
          <span className="text-sm text-muted">
            {order.discount ? `${order.discount.type === "percent" ? `${order.discount.value}%` : money(order.discount.value)} · −${money(totals.discount)}` : "None"}
          </span>
        </button>
        {order.type === "dine_in" && order.serviceChargeRate > 0 && (
          <Toggle
            checked={order.serviceCharge}
            onChange={(v) => update((o) => void (o.serviceCharge = v), v ? "Service charge added" : "Service charge removed")}
            label={`Service charge (${order.serviceChargeRate}%)`}
            description={order.serviceCharge ? money(totals.serviceCharge) : "Not applied"}
          />
        )}
        {order.type === "delivery" && (
          <Toggle
            checked={order.deliveryFee > 0}
            onChange={(v) => update((o) => void (o.deliveryFee = v ? settings.deliveryFee || 300 : 0), v ? "Delivery fee added" : "Delivery fee waived")}
            label="Delivery fee"
            description={order.deliveryFee > 0 ? money(order.deliveryFee) : "Waived"}
          />
        )}
      </div>
      <DiscountModal order={order} open={discountOpen} onClose={() => setDiscountOpen(false)} />
      <ItemModal
        open={!!editing}
        onClose={() => setEditing(null)}
        menuItem={editingMenu}
        groups={groups ?? []}
        initial={editing ?? undefined}
        locked={!!editing && editing.status !== "new"}
        onSave={(c) => {
          const id = editing?.id;
          void update((o) => {
            const x = o.items.find((i) => i.id === id);
            if (!x) return;
            x.modifiers = c.modifiers;
            x.qty = c.qty;
            x.notes = c.notes;
            x.updatedAt = now();
          }, "Item changed", editing?.name);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Payment panel

function PaymentPanel({ order, payments, onDone }: { order: Order; payments: Payment[]; onDone: () => void }) {
  const { staff, settings } = useSession();
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();
  const actions = useOrderActions();
  const [run, busy] = useBusy();

  const totals = computeTotals(order);
  const approved = payments.filter((p) => p.status === "approved");
  const sum = summarizePayments(totals.total, approved);
  const paymentCount = approved.filter((p) => p.kind === "payment").length;

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [splitN, setSplitN] = useState(1);
  const shares = useMemo(() => splitEvenly(totals.total, splitN), [totals.total, splitN]);
  const suggested = splitN > 1 ? Math.min(shares[Math.min(paymentCount, splitN - 1)], Math.max(0, sum.balance)) : Math.max(0, sum.balance);
  const [amountStr, setAmountStr] = useState(centsToInput(suggested));
  const [tenderedStr, setTenderedStr] = useState("");
  const [terminal, setTerminal] = useState<{ amount: number; method: PaymentMethod } | null>(null);
  const [reference, setReference] = useState("");
  const [lastChange, setLastChange] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState(false);
  const [tipStr, setTipStr] = useState("");

  useEffect(() => {
    setAmountStr(centsToInput(suggested));
    setTenderedStr("");
  }, [suggested]);

  const amount = parseMoney(amountStr);
  const tendered = parseMoney(tenderedStr);
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= sum.balance;
  const cashOk = method !== "cash" || !tenderedStr || (Number.isFinite(tendered) && tendered >= amount);
  const change = method === "cash" && Number.isFinite(tendered) && tendered > amount ? tendered - amount : 0;

  const tipBase = totals.subtotal - totals.discount;
  const canTip = settings.tipsEnabled && order.status === "open" && sum.balance > 0;

  async function setTip(cents: number) {
    await updateOrder(order.id, staff.name, (o) => void (o.tip = Math.max(0, cents)), "Tip set", money(cents));
  }

  /** Record a payment, re-checking the balance against the freshest data to prevent double charging. */
  async function commit(m: PaymentMethod, amt: number, extra: { tendered?: number; reference?: string } = {}) {
    const fresh = await getFreshOrder(order.id);
    if (!fresh) return;
    const freshPays = await orderPayments(order.id);
    const bal = summarizePayments(computeTotals(fresh).total, freshPays).balance;
    if (amt > bal) {
      toast.error(bal <= 0 ? "This order is already paid." : `Only ${money(bal)} is left to pay.`);
      return false;
    }
    await recordPayment({ order: fresh, method: m, amount: amt, tendered: extra.tendered, reference: extra.reference, by: staff.name });
    await updateOrder(order.id, staff.name, () => {}, "Payment received", `${METHOD_LABEL[m]} ${money(amt)}`);
    await reconcileOrderStatus(order.id, staff.name);
    const after = await getFreshOrder(order.id);
    if (after?.status === "closed") {
      // Pay-first flows (counter service): fire anything not yet sent to the kitchen.
      const sent = await sendToKitchen(order.id, staff.name);
      if (sent) toast.info(`${sent} item${sent > 1 ? "s" : ""} sent to the kitchen`);
      if (settings.autoPrintReceipt) void actions.printReceipt(after, false);
    }
    return true;
  }

  const charge = () =>
    run(async () => {
      if (!amountValid) {
        toast.error(amount > sum.balance ? `Amount can't exceed the ${money(sum.balance)} due` : "Enter a valid amount");
        return;
      }
      if (method === "cash") {
        const t = tenderedStr ? tendered : amount;
        if (t < amount) {
          toast.error("Cash received is less than the amount");
          return;
        }
        const ok = await commit("cash", amount, { tendered: t });
        if (ok) {
          setLastChange(t - amount);
          if (t > amount) toast.success(`Give ${money(t - amount)} change`);
          else toast.success(`${money(amount)} cash received`);
        }
      } else {
        setReference("");
        setTerminal({ amount, method });
      }
    });

  const terminalResult = (result: "approved" | "declined") =>
    run(async () => {
      if (!terminal) return;
      if (result === "declined") {
        const fresh = await getFreshOrder(order.id);
        if (fresh) {
          await recordPayment({ order: fresh, method: terminal.method, amount: terminal.amount, status: "declined", reference, by: staff.name });
          await updateOrder(order.id, staff.name, () => {}, "Payment declined", `${METHOD_LABEL[terminal.method]} ${money(terminal.amount)}`);
        }
        toast.error("Payment declined — nothing was charged. Try again or use another method.");
        setTerminal(null);
        return;
      }
      const ok = await commit(terminal.method, terminal.amount, { reference: reference.trim() });
      if (ok) {
        toast.success(`${METHOD_LABEL[terminal.method]} payment of ${money(terminal.amount)} approved`);
        setLastChange(0);
      }
      setTerminal(null);
    });

  const refundOverpayment = () =>
    run(async () => {
      const owed = -sum.balance;
      const main = approved.filter((p) => p.kind === "payment").sort((a, b) => b.createdAt - a.createdAt)[0];
      const m = main?.method ?? "cash";
      const res = await confirm({
        title: `Return ${money(owed)} to the customer?`,
        message: `The order total is now lower than what was paid. This records a ${METHOD_LABEL[m].toLowerCase()} refund of ${money(owed)}.`,
        confirmLabel: `Refund ${money(owed)}`,
        tone: "warning",
      });
      if (!res.ok) return;
      await recordPayment({ order, method: m, amount: owed, kind: "refund", reason: "Order changed after payment", by: staff.name });
      await updateOrder(order.id, staff.name, () => {}, "Overpayment refunded", `${METHOD_LABEL[m]} ${money(owed)}`);
      await reconcileOrderStatus(order.id, staff.name);
      toast.success(m === "cash" ? `Give ${money(owed)} back in cash` : `Refund ${money(owed)} recorded`);
    });

  // ---------------------------------------------------------------- render
  if (order.status === "cancelled") {
    return (
      <div className="p-6">
        <EmptyState icon={<XCircle className="size-7" />} title="Order cancelled">
          {order.cancelled?.reason} · by {order.cancelled?.by}
        </EmptyState>
      </div>
    );
  }

  const paid = totals.itemCount > 0 && sum.balance === 0 && sum.paid > 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      {/* Amount due */}
      <div className={cx("rounded-3xl p-5 text-center", paid ? "bg-emerald-50 dark:bg-emerald-500/10" : sum.balance < 0 ? "bg-violet-50 dark:bg-violet-500/10" : "bg-surface-2 border border-line")}>
        {paid ? (
          <>
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Paid in full</p>
            <p className="text-4xl font-bold tabular">{money(totals.total)}</p>
            {lastChange != null && lastChange > 0 && (
              <p className="mt-2 rounded-xl bg-white/70 py-2 text-lg font-bold text-emerald-800 dark:bg-black/20 dark:text-emerald-200">Change due: {money(lastChange)}</p>
            )}
          </>
        ) : sum.balance < 0 ? (
          <>
            <p className="text-sm font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">Customer is owed</p>
            <p className="text-4xl font-bold tabular">{money(-sum.balance)}</p>
            <p className="mt-1 text-sm text-muted">The order now costs less than what was paid.</p>
            <Button className="mt-3" variant="primary" onClick={refundOverpayment} loading={busy}>
              Refund {money(-sum.balance)}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">{sum.paid > 0 ? "Remaining balance" : "Amount due"}</p>
            <p className="text-5xl font-bold tracking-tight tabular">{money(sum.balance)}</p>
            {sum.paid > 0 && (
              <p className="mt-1 text-sm text-muted">
                {money(sum.net)} of {money(totals.total)} paid
              </p>
            )}
          </>
        )}
      </div>

      {paid ? (
        <div className="grid gap-2">
          <Button variant="primary" size="xl" icon={<Printer className="size-5" />} onClick={() => actions.printReceipt(order)}>
            {order.receiptPrints > 0 ? "Reprint receipt" : "Print receipt"}
          </Button>
          <Button variant="outline" size="lg" icon={<Check className="size-5" />} onClick={onDone}>
            Done · {order.type === "dine_in" ? "back to tables" : "new order"}
          </Button>
          <p className="px-2 text-center text-sm text-muted">Need to change something? Use “Edit order” — the slip and balance update automatically.</p>
        </div>
      ) : sum.balance > 0 ? (
        <>
          {/* Tip */}
          {canTip && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-2">Tip</p>
              <div className="flex flex-wrap gap-2">
                <Chip active={order.tip === 0} onClick={() => setTip(0)}>
                  No tip
                </Chip>
                {settings.tipPresets.map((p) => {
                  const v = Math.round((tipBase * p) / 100);
                  return (
                    <Chip key={p} active={order.tip === v && v > 0} onClick={() => setTip(v)}>
                      {p}% <span className="text-muted">· {money(v)}</span>
                    </Chip>
                  );
                })}
                <Chip active={customTip} onClick={() => { setCustomTip(true); setTipStr(order.tip ? centsToInput(order.tip) : ""); }}>
                  Custom
                </Chip>
              </div>
              {customTip && (
                <div className="mt-2 flex gap-2">
                  <Input inputMode="decimal" autoFocus value={tipStr} onChange={(e) => setTipStr(e.target.value)} placeholder="0.00" />
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const v = parseMoney(tipStr || "0");
                      if (!Number.isFinite(v) || v < 0) return toast.error("Enter a valid tip");
                      await setTip(v);
                      setCustomTip(false);
                    }}
                  >
                    Set
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Split */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Split className="size-4 text-muted" /> Split equally
            </span>
            <div className="flex items-center gap-2">
              <button className="flex size-9 items-center justify-center rounded-lg bg-surface-3 disabled:opacity-40" disabled={splitN <= 1} onClick={() => setSplitN((n) => n - 1)} aria-label="Fewer ways">
                <Minus className="size-4" />
              </button>
              <span className="w-20 text-center text-sm font-bold">{splitN === 1 ? "No split" : `${splitN} ways`}</span>
              <button className="flex size-9 items-center justify-center rounded-lg bg-surface-3" onClick={() => setSplitN((n) => Math.min(20, n + 1))} aria-label="More ways">
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          {splitN > 1 && (
            <p className="-mt-2 px-1 text-sm text-muted">
              Guest {Math.min(paymentCount + 1, splitN)} of {splitN} · each pays about {money(shares[0])}
            </p>
          )}

          {/* Method */}
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cx(
                  "flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 text-sm font-semibold transition active:scale-95",
                  method === m.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                )}
              >
                <m.icon className="size-6" />
                {m.label}
              </button>
            ))}
          </div>

          <Field label="Amount to charge" error={amountStr && !amountValid ? (amount > sum.balance ? `Max ${money(sum.balance)}` : "Invalid amount") : undefined}>
            <Input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="h-14 text-2xl font-bold tabular" />
          </Field>

          {method === "cash" && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-2">Cash received</p>
              <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
                {quickCashAmounts(Number.isFinite(amount) ? amount : 0).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTenderedStr(centsToInput(v))}
                    className={cx("h-12 rounded-xl border text-[15px] font-bold tabular transition", tendered === v ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong bg-surface hover:bg-surface-3")}
                  >
                    {v === amount ? "Exact" : money(v)}
                  </button>
                ))}
              </div>
              <Input inputMode="decimal" value={tenderedStr} onChange={(e) => setTenderedStr(e.target.value)} placeholder="Other amount" />
              {change > 0 && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-lg font-bold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Change: {money(change)}</p>}
              {!cashOk && <p className="mt-2 text-sm font-medium text-rose-600">Cash received is less than the amount.</p>}
            </div>
          )}

          <Button variant="primary" size="xl" block loading={busy} disabled={!amountValid || !cashOk} onClick={charge}>
            {method === "cash" ? `Take cash ${amountValid ? money(amount) : ""}` : `Charge ${amountValid ? money(amount) : ""} · ${METHOD_LABEL[method]}`}
          </Button>
        </>
      ) : (
        <p className="text-center text-muted">Add items to this order to take payment.</p>
      )}

      {/* Payments list */}
      {payments.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface">
          <p className="border-b border-line px-4 py-2.5 text-sm font-bold">Payments</p>
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id} className={cx("flex items-center gap-3 px-4 py-2.5", p.status !== "approved" && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {p.kind === "refund" ? "Refund · " : ""}
                    {METHOD_LABEL[p.method]}
                    {p.status === "declined" && <Badge tone="red" className="ml-2">Declined</Badge>}
                    {p.status === "voided" && <Badge tone="gray" className="ml-2">Voided</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {formatTime(p.createdAt)} · {p.by}
                    {p.deviceCode ? ` · device ${p.deviceCode}` : ""}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.tendered != null && p.tendered > p.amount ? ` · tendered ${money(p.tendered)}, change ${money(p.change ?? 0)}` : ""}
                  </p>
                </div>
                <span className={cx("font-bold tabular", p.kind === "refund" && "text-rose-600", p.status !== "approved" && "line-through")}>
                  {p.kind === "refund" ? "−" : ""}
                  {money(p.amount)}
                </span>
                {p.status === "approved" && p.kind === "payment" && (
                  <button onClick={() => actions.voidPayment(p)} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-3 hover:text-rose-600">
                    Void
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Card terminal confirmation */}
      <Modal
        open={!!terminal}
        onClose={() => setTerminal(null)}
        dismissable={!busy}
        title={`${terminal ? METHOD_LABEL[terminal.method] : ""} payment`}
        subtitle="Complete the payment on the terminal, then confirm the result here."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTerminal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => terminalResult("declined")} disabled={busy}>
              Declined
            </Button>
            <Button variant="success" onClick={() => terminalResult("approved")} loading={busy}>
              Approved
            </Button>
          </>
        }
      >
        <div className="py-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">Charge on terminal</p>
          <p className="text-5xl font-bold tabular">{terminal ? money(terminal.amount) : ""}</p>
          <div className="mx-auto mt-4 flex size-14 animate-pulse items-center justify-center rounded-2xl bg-brand-soft text-brand">
            {terminal?.method === "wallet" ? <Smartphone className="size-7" /> : <CreditCard className="size-7" />}
          </div>
        </div>
        <Field label="Approval code / last 4 digits (optional)" className="mt-3">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 4242" />
        </Field>
      </Modal>
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx("h-10 rounded-full border px-3.5 text-sm font-semibold transition", active ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong bg-surface hover:bg-surface-3")}
    >
      {children}
    </button>
  );
}
