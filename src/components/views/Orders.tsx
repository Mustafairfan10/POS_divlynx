"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Bike, ChefHat, ClipboardList, CreditCard, FileText, History, Pencil, Printer, RotateCcw, Search, ShoppingBag, UtensilsCrossed, XCircle } from "lucide-react";
import { useSession } from "@/client/session";
import { useNow, useOrderPayments, useOrdersSince, usePaymentsByOrders, useTables } from "@/client/hooks";
import { updateOrder, now } from "@/client/repo";
import { computeTotals, itemLineTotal, summarizePayments } from "@/lib/calc";
import { FULFILLMENT_LABEL, ORDER_TYPE_LABEL, formatDateTime, formatTime, startOfDay, timeAgo } from "@/lib/format";
import type { Fulfillment, Order, OrderType } from "@/lib/types";
import { Badge, Button, ColHead, EmptyState, Input, Modal, Segmented, Spinner, cx, type Tone } from "../ui";
import { Receipt } from "../Receipt";
import { RefundModal, useMoney, useOrderActions } from "../orderActions";
import { PayStatusBadge } from "./Checkout";

type Tab = "active" | "closed" | "cancelled" | "all";
type Range = "today" | "week" | "month";

const TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };

export const FULFILLMENT_TONE: Record<Fulfillment, Tone> = {
  new: "gray",
  in_kitchen: "blue",
  ready: "green",
  out_for_delivery: "brand",
  done: "gray",
};

/** Next fulfilment steps for an order type. */
export function nextSteps(o: Order): Array<{ to: Fulfillment; label: string }> {
  const f = o.fulfillment;
  if (f === "done") return [];
  const steps: Array<{ to: Fulfillment; label: string }> = [];
  if (f === "new" || f === "in_kitchen") steps.push({ to: "ready", label: "Mark ready" });
  if (o.type === "delivery" && (f === "ready" || f === "in_kitchen")) steps.push({ to: "out_for_delivery", label: "Out for delivery" });
  steps.push({ to: "done", label: o.type === "dine_in" ? "Mark served" : o.type === "takeaway" ? "Picked up" : "Delivered" });
  return steps;
}

export async function setFulfillment(order: Order, to: Fulfillment, by: string) {
  await updateOrder(order.id, by, (o) => {
    o.fulfillment = to;
    const t = now();
    for (const it of o.items) {
      if (it.voided) continue;
      if ((to === "ready" || to === "out_for_delivery") && (it.status === "sent" || it.status === "new")) {
        it.status = "ready";
        it.updatedAt = t;
      }
      if (to === "done" && it.status !== "served") {
        it.status = "served";
        it.updatedAt = t;
      }
    }
  }, `Status: ${FULFILLMENT_LABEL[to]}`);
}

export function OrdersView() {
  const [tab, setTab] = useState<Tab>("active");
  const [range, setRange] = useState<Range>("today");
  const [type, setType] = useState<OrderType | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const money = useMoney();
  const tables = useTables();
  const nowTs = useNow(30_000);

  const since = useMemo(() => {
    const d = startOfDay();
    return range === "today" ? d : range === "week" ? d - 6 * 86400_000 : d - 29 * 86400_000;
  }, [range]);
  const orders = useOrdersSince(tab === "active" ? 0 : since); // open orders from any day stay visible
  const ids = useMemo(() => orders?.map((o) => o.id), [orders]);
  const payMap = usePaymentsByOrders(ids);
  const tableName = (id?: string) => tables?.find((t) => t.id === id)?.name;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (orders ?? [])
      .filter((o) => (tab === "active" ? o.status === "open" : tab === "closed" ? o.status === "closed" : tab === "cancelled" ? o.status === "cancelled" : true))
      .filter((o) => type === "all" || o.type === type)
      .filter((o) => {
        if (!term) return true;
        return (
          o.number.toLowerCase().includes(term) ||
          o.customer.name.toLowerCase().includes(term) ||
          o.customer.phone.includes(term) ||
          (tableName(o.tableId) ?? "").toLowerCase().includes(term) ||
          o.items.some((i) => i.name.toLowerCase().includes(term))
        );
      })
      .map((o) => {
        const t = computeTotals(o);
        const s = summarizePayments(t.total, payMap?.get(o.id) ?? []);
        return { o, t, s };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, payMap, tab, type, q, tables]);

  const counts = useMemo(() => {
    const c = { active: 0, closed: 0, cancelled: 0 };
    for (const o of orders ?? []) if (o.status === "open") c.active++;
    return c;
  }, [orders]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line bg-surface px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-[21px] font-bold tracking-[-0.01em]">Orders</h1>
          {tab !== "active" && (
            <Segmented size="sm" className="w-64" value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "week", label: "7 days" }, { value: "month", label: "30 days" }]} />
          )}
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <Segmented
            className="md:w-[420px]"
            value={tab}
            onChange={setTab}
            options={[
              { value: "active", label: `Open${counts.active ? ` (${counts.active})` : ""}` },
              { value: "closed", label: "Paid" },
              { value: "cancelled", label: "Cancelled" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer, phone, table, item" className="pl-9" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Segmented
            size="sm"
            className="w-max min-w-full sm:min-w-0"
            value={type}
            onChange={setType}
            options={(["all", "dine_in", "takeaway", "delivery"] as const).map((t) => ({
              value: t,
              label: t === "all" ? "All types" : ORDER_TYPE_LABEL[t],
              icon: t === "all" ? undefined : (() => {
                const I = TYPE_ICON[t];
                return <I className="size-3.5" />;
              })(),
            }))}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {!orders ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-7" />} title={tab === "active" ? "No open orders" : "No orders found"}>
            {q ? "Try a different search." : tab === "active" ? "New orders appear here until they're paid." : "Try a different date range or filter."}
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className={cx(ROW_GRID, "sticky top-0 z-10 hidden border-b border-line-strong bg-surface-2 py-2 md:grid")}>
              <ColHead>Order</ColHead>
              <ColHead>Table / guest</ColHead>
              <ColHead>Items · server · time</ColHead>
              <ColHead>Status</ColHead>
              <ColHead className="text-right">Amount</ColHead>
            </div>
            <ul className="divide-y divide-line">
              {rows.map(({ o, t, s }) => {
                const Icon = TYPE_ICON[o.type];
                const tn = tableName(o.tableId);
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelected(o.id)}
                      className={cx(ROW_GRID, "w-full py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3", o.status === "cancelled" && "text-muted")}
                    >
                      <span className={cx("serial text-[17px] leading-tight", o.status === "cancelled" && "line-through decoration-1")}>#{o.number}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[15px]">
                        <Icon className="size-4 shrink-0 text-brand-ink" aria-label={ORDER_TYPE_LABEL[o.type]} />
                        {o.type === "dine_in" ? (
                          tn ? (
                            <span className="rounded-md border border-line-strong px-1.5 font-semibold tabular">{tn}</span>
                          ) : (
                            <span className="text-muted">No table</span>
                          )
                        ) : o.customer.name ? (
                          <span className="pen truncate font-medium">{o.customer.name}</span>
                        ) : (
                          <span className="truncate text-ink-2">{ORDER_TYPE_LABEL[o.type]}</span>
                        )}
                      </span>
                      <span className="col-span-2 min-w-0 truncate text-[13px] text-muted md:col-span-1">
                        <span className="tabular">{t.itemCount}</span> item{t.itemCount === 1 ? "" : "s"} · {o.createdBy} ·{" "}
                        <span className="tabular">{o.status === "open" ? `${timeAgo(o.createdAt, nowTs)} ago` : formatTime(o.createdAt)}</span>
                      </span>
                      <span className="col-span-2 flex flex-wrap gap-1.5 md:col-span-1">
                        <PayStatusBadge status={o.status === "cancelled" ? "cancelled" : s.status} />
                        {o.status !== "cancelled" && <Badge tone={FULFILLMENT_TONE[o.fulfillment]}>{FULFILLMENT_LABEL[o.fulfillment]}</Badge>}
                        {s.status === "overpaid" && (
                          <Badge tone="amber">
                            <AlertTriangle className="size-3" /> Refund {money(-s.balance)}
                          </Badge>
                        )}
                      </span>
                      <span className="col-start-2 row-start-1 text-right md:col-start-auto md:row-start-auto">
                        <span className="display block text-[17px]">{money(t.total)}</span>
                        {s.balance > 0 && s.paid > 0 && <span className="block text-xs font-semibold tabular text-warn">{money(s.balance)} due</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <OrderDetailModal orderId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** One row of the orders list: a 2-column card on phones, a printed table from md up. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 md:grid-cols-[96px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_120px]";

/** The order shown as a guest check: serial, boxed facts, QTY · ITEM · AMOUNT, double rule above TOTAL. */
function GuestCheck({ order, tableName }: { order: Order; tableName?: string }) {
  const money = useMoney();
  const t = computeTotals(order);
  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Type", value: ORDER_TYPE_LABEL[order.type] },
    order.type === "dine_in"
      ? { label: "Table", value: tableName ? <span className="rounded-md border border-line-strong px-1.5 font-semibold tabular">{tableName}</span> : "—" }
      : { label: "Customer", value: order.customer.name ? <span className="pen">{order.customer.name}</span> : "—" },
    { label: "Guests", value: <span className="tabular">{order.guests ?? 1}</span> },
    { label: "Server", value: order.createdBy },
  ];
  const extra: Array<[string, number]> = [
    ["Subtotal", t.subtotal],
    ...(t.discount ? [[`Discount${order.discount?.type === "percent" ? ` ${order.discount.value}%` : ""}`, -t.discount] as [string, number]] : []),
    ...(t.serviceCharge ? [[`Service ${order.serviceChargeRate}%`, t.serviceCharge] as [string, number]] : []),
    ...(t.deliveryFee ? [["Delivery fee", t.deliveryFee] as [string, number]] : []),
    ...(t.tax ? [[`Tax ${order.taxRate}%${order.taxInclusive ? " (incl.)" : ""}`, t.tax] as [string, number]] : []),
    ...(t.tip ? [["Tip", t.tip] as [string, number]] : []),
    ...(t.adjustments ? [["Adjustments", -t.adjustments] as [string, number]] : []),
  ];
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <p className={cx("serial text-[26px] leading-none", order.status === "cancelled" && "line-through decoration-2")}>#{order.number}</p>
        <p className="text-xs text-muted tabular">{formatDateTime(order.createdAt)}</p>
      </div>
      <dl className="mx-4 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-strong bg-line sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 bg-surface px-2.5 py-1.5">
            <dt>
              <ColHead>{f.label}</ColHead>
            </dt>
            <dd className="truncate text-sm font-semibold">{f.value}</dd>
          </div>
        ))}
      </dl>
      {order.type === "delivery" && (order.customer.phone || order.customer.address) && (
        <p className="pen mx-4 mt-2 text-sm">
          {[order.customer.phone, order.customer.address].filter(Boolean).join(" · ")}
        </p>
      )}
      {order.status === "cancelled" && order.cancelled && (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-bad" />
          <span>
            <span className="font-bold uppercase tracking-wide text-bad">Cancelled</span> <span className="pen">{order.cancelled.reason}</span>{" "}
            <span className="text-muted">· {order.cancelled.by}</span>
          </span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3 border-b border-line-strong px-4 pb-1.5">
        <ColHead>Qty</ColHead>
        <ColHead>Item</ColHead>
        <ColHead className="text-right">Amount</ColHead>
      </div>
      <ul className="divide-y divide-line px-4">
        {order.items.map((it) => (
          <li key={it.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3 py-2">
            <span className={cx("font-bold tabular", it.voided && "text-muted line-through")}>{it.qty}</span>
            <span className="min-w-0">
              <span className={cx("block font-semibold", it.voided && "text-muted line-through")}>{it.name}</span>
              {it.modifiers.length > 0 && <span className="pen block text-sm">{it.modifiers.map((m) => m.name).join(" · ")}</span>}
              {it.notes && <span className="pen block text-sm">“{it.notes}”</span>}
              {it.voided && (
                <span className="mt-0.5 flex items-center gap-1 text-xs">
                  <Badge tone="red">
                    <Ban className="size-3" /> Void
                  </Badge>
                  <span className="pen">{it.voided.reason}</span>
                </span>
              )}
            </span>
            <span className={cx("text-right tabular", it.voided && "text-muted line-through")}>{money(itemLineTotal(it))}</span>
          </li>
        ))}
      </ul>
      {order.note && (
        <p className="mx-4 mt-1 border-t border-line pt-2 text-sm">
          <ColHead className="mr-1.5">Note</ColHead>
          <span className="pen">{order.note}</span>
        </p>
      )}

      <div className="mt-2 space-y-0.5 border-t border-line px-4 py-2 text-sm text-ink-2">
        {extra.map(([label, v]) => (
          <div key={label} className="flex justify-between gap-3">
            <span>{label}</span>
            <span className="tabular">{v < 0 ? `−${money(-v)}` : money(v)}</span>
          </div>
        ))}
      </div>
      <div className="rule-double mx-4 flex items-baseline justify-between gap-3 pb-4 pt-2">
        <ColHead className="text-[13px]">Total</ColHead>
        <span className="display text-2xl">{money(t.total)}</span>
      </div>
    </div>
  );
}

export function OrderDetailModal({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { settings, staff, go, can } = useSession();
  const orders = useOrdersSince(0);
  const order = orders?.find((o) => o.id === orderId) ?? null;
  const payments = useOrderPayments(orderId);
  const tables = useTables();
  const actions = useOrderActions();
  const money = useMoney();
  const [refundOpen, setRefundOpen] = useState(false);
  const [tab, setTab] = useState<"check" | "slip" | "history">("check");

  if (!orderId || !order) return null;
  const t = computeTotals(order);
  const approved = (payments ?? []).filter((p) => p.status === "approved");
  const s = summarizePayments(t.total, approved);
  const tableName = tables?.find((x) => x.id === order.tableId)?.name;

  const openIn = (view: "register" | "checkout") => {
    onClose();
    go(view, { orderId: order.id });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          Order <span className="serial">#{order.number}</span> <PayStatusBadge status={order.status === "cancelled" ? "cancelled" : s.status} />
          {order.status !== "cancelled" && <Badge tone={FULFILLMENT_TONE[order.fulfillment]}>{FULFILLMENT_LABEL[order.fulfillment]}</Badge>}
        </span>
      }
      subtitle={`${ORDER_TYPE_LABEL[order.type]}${tableName ? ` · Table ${tableName}` : ""} · ${formatDateTime(order.createdAt)} · ${order.createdBy}`}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <Segmented
            size="sm"
            className="mb-3 w-full sm:w-80"
            value={tab}
            onChange={setTab}
            options={[
              { value: "check", label: "Check" },
              { value: "slip", label: "Receipt" },
              { value: "history", label: `History (${order.log.length})` },
            ]}
          />
          {tab === "check" ? (
            <GuestCheck order={order} tableName={tableName} />
          ) : tab === "slip" ? (
            <div className="rounded-xl border border-line bg-surface-2 p-3 sm:p-5">
              <div className="mx-auto max-w-[340px] rounded-lg border border-line bg-surface shadow-card">
                <Receipt order={order} payments={approved} settings={settings} kind={s.balance > 0 ? "bill" : "receipt"} tableName={tableName} />
              </div>
            </div>
          ) : (
            <ol className="relative ml-3 border-l border-line-strong pl-5">
              {[...order.log].reverse().map((e) => (
                <li key={e.id} className="mb-4">
                  <span className="absolute -left-[6px] mt-1.5 size-[11px] rounded-full border-2 border-surface bg-brand" />
                  <p className="text-sm font-semibold">{e.action}</p>
                  {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
                  <p className="text-xs text-muted tabular">
                    {formatDateTime(e.at)} · {e.by}
                  </p>
                </li>
              ))}
              {(payments ?? [])
                .filter((p) => p.status === "declined")
                .map((p) => (
                  <li key={p.id} className="mb-4">
                    <span className="absolute -left-[6px] mt-1.5 size-[11px] rounded-full border-2 border-surface bg-bad" />
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-bad">
                      <XCircle className="size-3.5" /> Declined {p.method} attempt · <span className="tabular">{money(p.amount)}</span>
                    </p>
                    <p className="text-xs text-muted tabular">
                      {formatDateTime(p.createdAt)} · {p.by}
                    </p>
                  </li>
                ))}
            </ol>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <div className="flex items-baseline justify-between text-sm text-ink-2">
              <ColHead>Total</ColHead>
              <span className="display text-lg text-ink">{money(t.total)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm text-ink-2">
              <span>Paid</span>
              <span className="tabular">{money(s.paid)}</span>
            </div>
            {s.refunded > 0 && (
              <div className="flex justify-between text-sm text-bad">
                <span>Refunded</span>
                <span className="tabular">−{money(s.refunded)}</span>
              </div>
            )}
            {s.balance !== 0 && order.status !== "cancelled" && (
              <div className={cx("mt-1.5 flex items-center justify-between border-t border-line pt-1.5 font-semibold", s.balance > 0 ? "text-warn" : "text-bad")}>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="size-4" />
                  {s.balance > 0 ? "Balance due" : "Owed to customer"}
                </span>
                <span className="tabular">{money(Math.abs(s.balance))}</span>
              </div>
            )}
          </div>

          {order.status !== "cancelled" && nextSteps(order).length > 0 && (
            <div>
              <ColHead className="mb-2 block">Progress</ColHead>
              <div className="grid gap-2">
                {nextSteps(order).map((st) => (
                  <Button key={st.to} variant="outline" onClick={() => setFulfillment(order, st.to, staff.name)}>
                    {st.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <ColHead className="mb-2 block">Actions</ColHead>
            <div className="grid gap-2">
              {order.status === "open" && (
                <>
                  <Button variant="primary" icon={<CreditCard className="size-4" />} onClick={() => openIn("checkout")}>
                    Take payment
                  </Button>
                  <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => openIn("register")}>
                    Edit order
                  </Button>
                </>
              )}
              {order.status === "closed" && (
                <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => openIn("checkout")}>
                  Open in checkout
                </Button>
              )}
              {order.status !== "cancelled" && (
                <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => actions.printBill(order)}>
                  Print guest check
                </Button>
              )}
              <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => actions.printReceipt(order)} disabled={s.paid === 0}>
                {order.receiptPrints > 0 ? "Reprint receipt" : "Print receipt"}
              </Button>
              <Button variant="outline" icon={<ChefHat className="size-4" />} onClick={() => actions.printKitchen(order, order.items.filter((i) => !i.voided))}>
                Kitchen ticket
              </Button>
              {s.net > 0 && (
                <Button variant="outline" className="text-bad hover:border-bad/50" icon={<RotateCcw className="size-4" />} onClick={() => setRefundOpen(true)}>
                  Refund
                </Button>
              )}
              {order.status === "open" && (
                <Button
                  variant="outline"
                  className="text-bad hover:border-bad/50"
                  icon={<XCircle className="size-4" />}
                  onClick={async () => {
                    if (await actions.cancelOrder(order)) onClose();
                  }}
                >
                  Cancel order
                </Button>
              )}
              {!can("approve") && (s.net > 0 || order.status === "open") && (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <History className="size-3.5" /> Refunds and voids ask for a manager PIN.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      <RefundModal order={order} open={refundOpen} onClose={() => setRefundOpen(false)} />
    </Modal>
  );
}
