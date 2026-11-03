"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Bike, ChefHat, ClipboardList, CreditCard, FileText, History, Pencil, Printer, RotateCcw, Search, ShoppingBag, UtensilsCrossed, XCircle } from "lucide-react";
import { useSession } from "@/client/session";
import { useNow, useOrderPayments, useOrdersSince, usePaymentsByOrders, useTables } from "@/client/hooks";
import { updateOrder, now } from "@/client/repo";
import { computeTotals, summarizePayments } from "@/lib/calc";
import { FULFILLMENT_LABEL, ORDER_TYPE_LABEL, formatDateTime, formatTime, startOfDay, timeAgo } from "@/lib/format";
import type { Fulfillment, Order, OrderType } from "@/lib/types";
import { Badge, Button, EmptyState, Modal, Segmented, Spinner, cx, type Tone } from "../ui";
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
  out_for_delivery: "violet",
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
      <div className="space-y-3 border-b border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-bold">Orders</h1>
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
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search number, customer, phone, table, item"
              className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-9 pr-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)] md:h-12"
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {(["all", "dine_in", "takeaway", "delivery"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cx("h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold", type === t ? "border-transparent bg-ink text-surface" : "border-line-strong text-ink-2")}
            >
              {t === "all" ? "All types" : ORDER_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {!orders ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-7" />} title={tab === "active" ? "No open orders" : "No orders found"}>
            {q ? "Try a different search." : tab === "active" ? "New orders appear here until they're paid." : "Try a different date range or filter."}
          </EmptyState>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map(({ o, t, s }) => {
              const Icon = TYPE_ICON[o.type];
              const where = o.type === "dine_in" ? (tableName(o.tableId) ? `Table ${tableName(o.tableId)}` : "No table") : o.customer.name || ORDER_TYPE_LABEL[o.type];
              return (
                <button
                  key={o.id}
                  onClick={() => setSelected(o.id)}
                  className="flex gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card transition hover:border-line-strong active:scale-[0.99]"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-bold tabular">#{o.number}</span>
                      <span className="truncate text-sm text-ink-2">{where}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted">
                      {t.itemCount} item{t.itemCount === 1 ? "" : "s"} · {o.createdBy} · {o.status === "open" ? `${timeAgo(o.createdAt, nowTs)} ago` : formatTime(o.createdAt)}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <PayStatusBadge status={o.status === "cancelled" ? "cancelled" : s.status} />
                      {o.status !== "cancelled" && <Badge tone={FULFILLMENT_TONE[o.fulfillment]}>{FULFILLMENT_LABEL[o.fulfillment]}</Badge>}
                      {s.status === "overpaid" && (
                        <Badge tone="violet">
                          <AlertTriangle className="size-3" /> Refund {money(-s.balance)}
                        </Badge>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-bold tabular">{money(t.total)}</span>
                    {s.balance > 0 && s.paid > 0 && <span className="block text-xs font-semibold text-sky-700 dark:text-sky-300">{money(s.balance)} due</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <OrderDetailModal orderId={selected} onClose={() => setSelected(null)} />
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
  const [tab, setTab] = useState<"slip" | "history">("slip");

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
          Order #{order.number} <PayStatusBadge status={order.status === "cancelled" ? "cancelled" : s.status} />
          {order.status !== "cancelled" && <Badge tone={FULFILLMENT_TONE[order.fulfillment]}>{FULFILLMENT_LABEL[order.fulfillment]}</Badge>}
        </span>
      }
      subtitle={`${ORDER_TYPE_LABEL[order.type]}${tableName ? ` · Table ${tableName}` : ""} · ${formatDateTime(order.createdAt)} · ${order.createdBy}`}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <Segmented size="sm" className="mb-3 w-64" value={tab} onChange={setTab} options={[{ value: "slip", label: "Receipt" }, { value: "history", label: `History (${order.log.length})` }]} />
          {tab === "slip" ? (
            <div className="rounded-2xl bg-surface-3 p-3 sm:p-5">
              <div className="mx-auto max-w-[340px] overflow-hidden rounded-md shadow-pop">
                <Receipt order={order} payments={approved} settings={settings} kind={s.balance > 0 ? "bill" : "receipt"} tableName={tableName} />
              </div>
            </div>
          ) : (
            <ol className="relative ml-3 border-l-2 border-line pl-5">
              {[...order.log].reverse().map((e) => (
                <li key={e.id} className="mb-4">
                  <span className="absolute -left-[7px] mt-1.5 size-3 rounded-full border-2 border-surface bg-brand" />
                  <p className="text-sm font-semibold">{e.action}</p>
                  {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
                  <p className="text-xs text-muted">
                    {formatDateTime(e.at)} · {e.by}
                  </p>
                </li>
              ))}
              {(payments ?? [])
                .filter((p) => p.status === "declined")
                .map((p) => (
                  <li key={p.id} className="mb-4">
                    <span className="absolute -left-[7px] mt-1.5 size-3 rounded-full border-2 border-surface bg-rose-500" />
                    <p className="text-sm font-semibold text-rose-600">Declined {p.method} attempt · {money(p.amount)}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(p.createdAt)} · {p.by}
                    </p>
                  </li>
                ))}
            </ol>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line p-4">
            <div className="flex justify-between text-sm text-muted">
              <span>Total</span>
              <span className="text-lg font-bold text-ink tabular">{money(t.total)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted">
              <span>Paid</span>
              <span className="tabular">{money(s.paid)}</span>
            </div>
            {s.refunded > 0 && (
              <div className="flex justify-between text-sm text-rose-600">
                <span>Refunded</span>
                <span className="tabular">−{money(s.refunded)}</span>
              </div>
            )}
            {s.balance !== 0 && order.status !== "cancelled" && (
              <div className={cx("mt-1 flex justify-between border-t border-line pt-1 font-semibold", s.balance > 0 ? "text-sky-700 dark:text-sky-300" : "text-violet-700 dark:text-violet-300")}>
                <span>{s.balance > 0 ? "Balance due" : "Owed to customer"}</span>
                <span className="tabular">{money(Math.abs(s.balance))}</span>
              </div>
            )}
          </div>

          {order.status !== "cancelled" && nextSteps(order).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Progress</p>
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
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Actions</p>
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
                <Button variant="outline" className="text-rose-600" icon={<RotateCcw className="size-4" />} onClick={() => setRefundOpen(true)}>
                  Refund
                </Button>
              )}
              {order.status === "open" && (
                <Button
                  variant="outline"
                  className="text-rose-600"
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
