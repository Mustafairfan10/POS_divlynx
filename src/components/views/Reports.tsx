"use client";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { BarChart3, CalendarRange, Download, Printer } from "lucide-react";
import { useOrdersSince, usePaymentsByOrders, usePaymentsSince, useStaffList } from "@/client/hooks";
import { useSession } from "@/client/session";
import { printNode } from "@/components/print";
import { Button, Card, ColHead, EmptyState, Field, Input, Spinner, cx, useToast } from "@/components/ui";
import { activeItems, computeTotals, itemLineTotal, summarizePayments } from "@/lib/calc";
import { formatDate, formatDateTime, formatMoney, METHOD_LABEL, ORDER_TYPE_LABEL, startOfDay } from "@/lib/format";
import type { Order, OrderType, Payment, PaymentMethod, Settings } from "@/lib/types";

// ------------------------------------------------------------------ date range

type Preset = "today" | "yesterday" | "7d" | "month" | "custom";

const DAY = 86_400_000;

function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Last millisecond of the local day containing ts (DST-safe). */
function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function presetRange(p: Exclude<Preset, "custom">): { from: number; to: number } {
  const today = startOfDay();
  switch (p) {
    case "today":
      return { from: today, to: endOfDay(today) };
    case "yesterday": {
      const y = startOfDay(today - DAY / 2);
      return { from: y, to: endOfDay(y) };
    }
    case "7d":
      return { from: startOfDay(today - 6 * DAY + DAY / 2), to: endOfDay(today) };
    case "month": {
      const d = new Date(today);
      d.setDate(1);
      return { from: d.getTime(), to: endOfDay(today) };
    }
  }
}

const PRESETS: Array<{ value: Exclude<Preset, "custom">; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "month", label: "This month" },
];

// ------------------------------------------------------------------ aggregation

interface MethodRow {
  method: PaymentMethod;
  payments: number;
  paymentCount: number;
  refunds: number;
  refundCount: number;
  net: number;
}

interface Report {
  /** Non-cancelled orders */
  orderCount: number;
  gross: number;
  discounts: number;
  adjustments: number;
  refunds: number;
  refundCount: number;
  net: number;
  tax: number;
  tips: number;
  serviceCharges: number;
  deliveryFees: number;
  totalBilled: number;
  avgOrder: number;
  itemsSold: number;
  cancelledCount: number;
  cancelledValue: number;
  openCount: number;
  openDue: number;
  collected: number;
  methods: MethodRow[];
  types: Array<{ type: OrderType; count: number; sales: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  hours: Array<{ hour: number; sales: number; count: number }>;
  staff: Array<{ name: string; count: number; sales: number }>;
}

const METHODS: PaymentMethod[] = ["cash", "card", "wallet", "other"];
const TYPES: OrderType[] = ["dine_in", "takeaway", "delivery"];

/** Sales value of an order net of discounts and adjustments, before tax/tips/fees. */
function orderSales(t: ReturnType<typeof computeTotals>): number {
  return t.subtotal - t.discount - t.adjustments;
}

function buildReport(
  orders: Order[],
  payments: Payment[],
  paysByOrder: Map<string, Payment[]>,
  staffName: (by: string) => string,
): Report {
  const r: Report = {
    orderCount: 0,
    gross: 0,
    discounts: 0,
    adjustments: 0,
    refunds: 0,
    refundCount: 0,
    net: 0,
    tax: 0,
    tips: 0,
    serviceCharges: 0,
    deliveryFees: 0,
    totalBilled: 0,
    avgOrder: 0,
    itemsSold: 0,
    cancelledCount: 0,
    cancelledValue: 0,
    openCount: 0,
    openDue: 0,
    collected: 0,
    methods: [],
    types: [],
    topItems: [],
    hours: [],
    staff: [],
  };

  const types = new Map<OrderType, { count: number; sales: number }>(TYPES.map((t) => [t, { count: 0, sales: 0 }]));
  const items = new Map<string, { name: string; qty: number; revenue: number }>();
  const hours = new Map<number, { sales: number; count: number }>();
  const staff = new Map<string, { name: string; count: number; sales: number }>();

  for (const o of orders) {
    if (o.deleted) continue;
    const t = computeTotals(o);
    if (o.status === "cancelled") {
      r.cancelledCount++;
      r.cancelledValue += t.subtotal;
      continue;
    }
    const sales = orderSales(t);
    r.orderCount++;
    r.gross += t.subtotal;
    r.discounts += t.discount;
    r.adjustments += t.adjustments;
    r.tax += t.tax;
    r.tips += t.tip;
    r.serviceCharges += t.serviceCharge;
    r.deliveryFees += t.deliveryFee;
    r.totalBilled += t.total;
    r.itemsSold += t.itemCount;

    if (o.status === "open") {
      const sum = summarizePayments(t.total, paysByOrder.get(o.id) ?? []);
      r.openCount++;
      r.openDue += Math.max(0, sum.balance);
    }

    const ty = types.get(o.type);
    if (ty) {
      ty.count++;
      ty.sales += sales;
    }

    const h = new Date(o.createdAt).getHours();
    const hb = hours.get(h) ?? { sales: 0, count: 0 };
    hb.sales += sales;
    hb.count++;
    hours.set(h, hb);

    const sn = staffName(o.createdBy);
    const sb = staff.get(sn) ?? { name: sn, count: 0, sales: 0 };
    sb.count++;
    sb.sales += sales;
    staff.set(sn, sb);

    for (const it of activeItems(o)) {
      const key = it.menuItemId || it.name;
      const ib = items.get(key) ?? { name: it.name, qty: 0, revenue: 0 };
      ib.qty += it.qty;
      ib.revenue += itemLineTotal(it);
      items.set(key, ib);
    }
  }

  const methods = new Map<PaymentMethod, MethodRow>(
    METHODS.map((m) => [m, { method: m, payments: 0, paymentCount: 0, refunds: 0, refundCount: 0, net: 0 }]),
  );
  for (const p of payments) {
    if (p.deleted || p.status !== "approved") continue;
    const row = methods.get(p.method) ?? { method: p.method, payments: 0, paymentCount: 0, refunds: 0, refundCount: 0, net: 0 };
    if (p.kind === "payment") {
      row.payments += p.amount;
      row.paymentCount++;
    } else {
      row.refunds += p.amount;
      row.refundCount++;
      r.refunds += p.amount;
      r.refundCount++;
    }
    row.net = row.payments - row.refunds;
    methods.set(p.method, row);
  }

  r.net = r.gross - r.discounts - r.adjustments - r.refunds;
  r.avgOrder = r.orderCount ? Math.round((r.gross - r.discounts - r.adjustments) / r.orderCount) : 0;
  r.methods = [...methods.values()];
  r.collected = r.methods.reduce((s, m) => s + m.net, 0);
  r.types = TYPES.map((t) => ({ type: t, ...types.get(t)! }));
  r.topItems = [...items.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10);
  r.hours = [...hours.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour);
  r.staff = [...staff.values()].sort((a, b) => b.sales - a.sales);
  return r;
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

function rangeLabel(from: number, to: number): string {
  const a = formatDate(from);
  const b = formatDate(to);
  return a === b ? a : `${a} – ${b}`;
}

// ------------------------------------------------------------------ CSV

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dec(cents: number): string {
  return (cents / 100).toFixed(2);
}

function exportCsv(orders: Order[], paysByOrder: Map<string, Payment[]>, staffName: (by: string) => string, from: number, to: number) {
  const header = ["Number", "Date", "Type", "Status", "Items", "Subtotal", "Discount", "Tax", "Tip", "Total", "Paid", "Refunded", "Staff"];
  const rows = [...orders]
    .filter((o) => !o.deleted)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((o) => {
      const t = computeTotals(o);
      const s = summarizePayments(t.total, paysByOrder.get(o.id) ?? []);
      const d = new Date(o.createdAt);
      const date = `${toDateInput(o.createdAt)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return [
        o.number,
        date,
        ORDER_TYPE_LABEL[o.type],
        o.status,
        t.itemCount,
        dec(t.subtotal),
        dec(t.discount),
        dec(t.tax),
        dec(t.tip),
        dec(t.total),
        dec(s.paid),
        dec(s.refunded),
        staffName(o.createdBy),
      ];
    });
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const f = toDateInput(from);
  const t = toDateInput(to);
  a.download = f === t ? `orders-${f}.csv` : `orders-${f}_to_${t}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ view

export function ReportsView() {
  const { settings, staff: me } = useSession();
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState(() => presetRange("today"));
  const [customFrom, setCustomFrom] = useState(() => toDateInput(Date.now()));
  const [customTo, setCustomTo] = useState(() => toDateInput(Date.now()));

  const orders = useOrdersSince(range.from, range.to);
  const payments = usePaymentsSince(range.from, range.to);
  const orderIds = useMemo(() => orders?.map((o) => o.id), [orders]);
  const paysByOrder = usePaymentsByOrders(orderIds);
  const staffList = useStaffList();

  const staffName = useMemo(() => {
    const byId = new Map((staffList ?? []).map((s) => [s.id, s.name]));
    return (by: string) => byId.get(by) ?? (by || "Unknown");
  }, [staffList]);

  const money = (c: number) => formatMoney(c, settings.currency, settings.locale);

  const report = useMemo(
    () => (orders && payments ? buildReport(orders, payments, paysByOrder ?? new Map(), staffName) : null),
    [orders, payments, paysByOrder, staffName],
  );

  function choosePreset(p: Exclude<Preset, "custom">) {
    setPreset(p);
    const r = presetRange(p);
    setRange(r);
    setCustomFrom(toDateInput(r.from));
    setCustomTo(toDateInput(r.to));
  }

  function applyCustom(fromStr: string, toStr: string) {
    setCustomFrom(fromStr);
    setCustomTo(toStr);
    const f = fromDateInput(fromStr);
    const t = fromDateInput(toStr);
    if (f == null || t == null) return;
    setPreset("custom");
    setRange(f <= t ? { from: f, to: endOfDay(t) } : { from: t, to: endOfDay(f) });
  }

  const loading = !report;
  const hasOrders = !!orders && orders.length > 0;
  const hasPayments = !!payments && payments.some((p) => p.status === "approved");

  function onPrint() {
    if (!report) return;
    void printNode(
      <SummaryPrint report={report} settings={settings} from={range.from} to={range.to} by={me.name} printedAt={Date.now()} />,
      settings.paperWidth,
    );
  }

  function onExport() {
    if (!orders) return;
    exportCsv(orders, paysByOrder ?? new Map(), staffName, range.from, range.to);
    toast.success(`Exported ${orders.length} order${orders.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-6xl space-y-4 p-3 pb-10 sm:p-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.01em] text-ink">Reports</h1>
            <p className="tabular text-sm text-ink-2">{rangeLabel(range.from, range.to)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<Download className="size-4" />} onClick={onExport} disabled={!hasOrders}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Printer className="size-4" />} onClick={onPrint} disabled={!report || (!hasOrders && !hasPayments)}>
              Print summary
            </Button>
          </div>
        </div>

        {/* Period bar */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <ColHead className="mb-1.5 block">Period</ColHead>
            <div
              className="flex divide-x divide-line-strong overflow-x-auto rounded-lg border border-line-strong bg-surface"
              role="group"
              aria-label="Date range presets"
            >
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={preset === p.value}
                  onClick={() => choosePreset(p.value)}
                  className={cx(
                    "h-11 shrink-0 whitespace-nowrap px-4 text-sm font-semibold transition-colors duration-150",
                    preset === p.value ? "bg-brand text-on-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 lg:ml-auto lg:max-w-sm">
            <Field label="From">
              <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => applyCustom(e.target.value, customTo)} />
            </Field>
            <Field label="To">
              <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => applyCustom(customFrom, e.target.value)} />
            </Field>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : !hasOrders && !hasPayments ? (
          <Card>
            <EmptyState
              icon={<BarChart3 className="size-6" />}
              title="No sales in this period"
              action={
                preset !== "7d" ? (
                  <Button variant="outline" onClick={() => choosePreset("7d")}>
                    Show last 7 days
                  </Button>
                ) : undefined
              }
            >
              Orders created between {rangeLabel(range.from, range.to)} will appear here. Try another date range.
            </EmptyState>
          </Card>
        ) : (
          <ReportBody report={report} money={money} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ report body

function ReportBody({ report: r, money }: { report: Report; money: (c: number) => string }) {
  const paymentsTotal = r.methods.reduce((s, m) => s + m.payments, 0);
  const salesTotal = r.gross - r.discounts - r.adjustments;
  const minus = (c: number) => (c ? `−${money(c)}` : money(0));
  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Summary statement, set like a guest check */}
        <Section title="Sales summary" label="Key figures">
          <dl>
            <Line label="Gross sales" hint="Item subtotals, excl. cancelled" value={money(r.gross)} />
            <Line label="Discounts" value={minus(r.discounts)} tone={r.discounts ? "neg" : undefined} />
            {r.adjustments > 0 && <Line label="Adjustments" value={minus(r.adjustments)} tone="neg" />}
            <Line
              label="Refunds"
              hint={`${r.refundCount} refund${r.refundCount === 1 ? "" : "s"}`}
              value={minus(r.refunds)}
              tone={r.refunds ? "neg" : undefined}
            />
          </dl>
          <div className="rule-double mt-1 flex items-end justify-between gap-3 pt-3">
            <div className="min-w-0">
              <ColHead className="block">Net sales</ColHead>
              <p className="mt-0.5 text-xs leading-snug text-muted">Gross − discounts − adjustments − refunds</p>
            </div>
            <p className="display shrink-0 text-right text-[32px] leading-none text-ink">{money(r.net)}</p>
          </div>

          <SubHead>On top of sales</SubHead>
          <dl>
            <Line label="Tax collected" value={money(r.tax)} />
            <Line label="Service charges" value={money(r.serviceCharges)} />
            {r.deliveryFees > 0 && <Line label="Delivery fees" value={money(r.deliveryFees)} />}
            <Line label="Tips" value={money(r.tips)} />
            <Line label="Total billed" value={money(r.totalBilled)} strong />
          </dl>

          <SubHead>Activity</SubHead>
          <dl>
            <Line label="Orders" hint={`${r.itemsSold} items sold`} value={String(r.orderCount)} />
            <Line label="Average order" hint="After discounts, before tax" value={money(r.avgOrder)} />
            <Line label="Collected" hint="Approved payments − refunds" value={money(r.collected)} strong />
            <Line
              label="Cancelled"
              hint={r.cancelledCount ? `${money(r.cancelledValue)} in items` : "None"}
              value={String(r.cancelledCount)}
              tone={r.cancelledCount ? "neg" : undefined}
            />
            <Line
              label="Open (unpaid)"
              hint={r.openCount ? `${money(r.openDue)} still due` : "All settled"}
              value={String(r.openCount)}
              tone={r.openCount ? "warn" : undefined}
            />
          </dl>
        </Section>

        <div className="grid gap-4">
          {/* Payment methods */}
          <Section title="Payment methods">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <Th>Method</Th>
                  <Th right>Payments</Th>
                  <Th right>Refunds</Th>
                  <Th right>Net</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.methods.map((m) => {
                  const idle = !m.paymentCount && !m.refundCount;
                  const share = r.collected > 0 ? Math.max(0, Math.round((m.net / r.collected) * 100)) : 0;
                  return (
                    <tr key={m.method} className={cx(idle ? "text-muted" : "text-ink")}>
                      <td className="py-2 pr-3">
                        <span className="font-semibold">{METHOD_LABEL[m.method]}</span>
                        <ShareBar pct={share} label={`${METHOD_LABEL[m.method]}: ${share}% of net collected`} />
                      </td>
                      <td className="tabular py-2 text-right">
                        {money(m.payments)}
                        <span className="block text-xs text-muted">{m.paymentCount}×</span>
                      </td>
                      <td className={cx("tabular py-2 pl-2 text-right", m.refunds > 0 && "text-bad")}>
                        {minus(m.refunds)}
                        <span className="block text-xs text-muted">{m.refundCount}×</span>
                      </td>
                      <td className="tabular py-2 pl-2 text-right font-semibold">{money(m.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="rule-double font-bold text-ink">
                  <td className="pt-2.5">Total</td>
                  <td className="tabular pt-2.5 text-right">{money(paymentsTotal)}</td>
                  <td className={cx("tabular pt-2.5 pl-2 text-right", r.refunds > 0 && "text-bad")}>{minus(r.refunds)}</td>
                  <td className="display pt-2.5 pl-2 text-right text-base">{money(r.collected)}</td>
                </tr>
              </tfoot>
            </table>
          </Section>

          {/* Order types */}
          <Section title="Order types">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <Th>Type</Th>
                  <Th right>Orders</Th>
                  <Th right>Sales</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.types.map((t) => {
                  const pct = r.orderCount ? Math.round((t.count / r.orderCount) * 100) : 0;
                  return (
                    <tr key={t.type} className={cx(t.count ? "text-ink" : "text-muted")}>
                      <td className="py-2 pr-3">
                        <span className="font-semibold">{ORDER_TYPE_LABEL[t.type]}</span>
                        <ShareBar pct={pct} label={`${ORDER_TYPE_LABEL[t.type]}: ${pct}% of orders`} />
                      </td>
                      <td className="tabular py-2 text-right">
                        {t.count}
                        <span className="block text-xs text-muted">{pct}%</span>
                      </td>
                      <td className="tabular py-2 pl-3 text-right font-semibold">{money(t.sales)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      {/* Sales by hour */}
      <Section title="Sales by hour">
        <HourChart hours={r.hours} money={money} />
      </Section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Top items */}
        <Section title="Top items">
          {r.topItems.length === 0 ? (
            <Empty>No items sold. Items show up here once orders in this period are rung up.</Empty>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <Th className="w-8">#</Th>
                  <Th>Item</Th>
                  <Th right className="w-16">Qty</Th>
                  <Th right className="w-28">Sales</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.topItems.map((it, i) => (
                  <tr key={it.name + i}>
                    <td className={cx("tabular py-2 text-xs font-bold", i < 3 ? "text-brand-ink" : "text-muted")}>{i + 1}</td>
                    <td className="truncate py-2 pr-3 font-semibold text-ink">{it.name}</td>
                    <td className="tabular py-2 text-right font-semibold text-ink">
                      {it.qty}
                      <span className="sr-only"> sold</span>
                    </td>
                    <td className="tabular py-2 pl-3 text-right text-ink-2">{money(it.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Staff */}
        <Section title="Sales by staff">
          {r.staff.length === 0 ? (
            <Empty>No orders. Staff show up here once they ring up orders in this period.</Empty>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <Th>Staff</Th>
                  <Th right className="w-20">Orders</Th>
                  <Th right className="w-28">Sales</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.staff.map((s) => {
                  const pct = salesTotal > 0 ? Math.max(0, Math.round((s.sales / salesTotal) * 100)) : 0;
                  return (
                    <tr key={s.name}>
                      <td className="py-2 pr-3">
                        <span className="block truncate font-semibold text-ink">{s.name}</span>
                        <ShareBar pct={pct} label={`${s.name}: ${pct}% of sales`} />
                      </td>
                      <td className="tabular py-2 text-right text-ink-2">
                        {s.count}
                        <span className="sr-only"> order{s.count === 1 ? "" : "s"}</span>
                      </td>
                      <td className="tabular py-2 pl-3 text-right font-semibold text-ink">{money(s.sales)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <p className="flex items-start gap-2 text-[13px] text-muted">
        <CalendarRange className="mt-0.5 size-4 shrink-0" />
        Sales figures use orders created in the selected period. Payments, refunds and tenders use payments taken in the period. Net sales exclude tax, tips, service charges and delivery fees.
      </p>
    </>
  );
}

function Section({ title, label, children, className }: { title: string; label?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label ?? title} className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}>
      <h2 className="mb-3 text-base font-bold tracking-[-0.01em] text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Th({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return (
    <th scope="col" className={cx("pb-1.5 font-normal", right && "text-right", className)}>
      <ColHead>{children}</ColHead>
    </th>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <ColHead className="mt-6 block border-b border-line-strong pb-1.5">{children}</ColHead>;
}

/** One statement row: label (with optional note) left, amount right-aligned. */
function Line({ label, hint, value, tone, strong }: { label: string; hint?: string; value: string; tone?: "neg" | "warn"; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="min-w-0">
        <span className={cx("text-sm text-ink", strong ? "font-bold" : "font-medium")}>{label}</span>
        {hint && <span className="block text-xs leading-snug text-muted">{hint}</span>}
      </dt>
      <dd
        className={cx(
          "tabular shrink-0 text-right text-sm",
          strong ? "font-bold" : "font-semibold",
          tone === "neg" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ShareBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="mt-1 h-1.5 w-full max-w-40 overflow-hidden rounded-sm bg-surface-3"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className="h-full bg-brand" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

function HourChart({ hours, money }: { hours: Report["hours"]; money: (c: number) => string }) {
  if (hours.length === 0) return <Empty>No orders. Hourly sales show up here once orders in this period are rung up.</Empty>;
  // Show a continuous span of hours from the first to last active hour (at least 6 columns).
  let lo = hours[0].hour;
  let hi = hours[hours.length - 1].hour;
  while (hi - lo < 5) {
    if (lo > 0) lo--;
    if (hi - lo < 5 && hi < 23) hi++;
    if (lo === 0 && hi === 23) break;
  }
  const map = new Map(hours.map((h) => [h.hour, h]));
  const cols = Array.from({ length: hi - lo + 1 }, (_, i) => map.get(lo + i) ?? { hour: lo + i, sales: 0, count: 0 });
  const max = Math.max(1, ...cols.map((c) => c.sales));
  const peak = hours.reduce((a, b) => (b.sales > a.sales ? b : a));
  const summary = `Sales by hour from ${hourLabel(lo)} to ${hourLabel(hi)}. Busiest hour ${hourLabel(peak.hour)}: ${money(peak.sales)} from ${peak.count} order${peak.count === 1 ? "" : "s"}.`;

  return (
    <figure aria-label={summary}>
      <figcaption className="mb-2 text-sm text-ink-2">
        Busiest hour: <span className="font-semibold text-ink">{hourLabel(peak.hour)}</span> · <span className="tabular">{money(peak.sales)}</span> from{" "}
        {peak.count} order{peak.count === 1 ? "" : "s"}
      </figcaption>
      <div className="overflow-x-auto pt-8">
        <div style={{ minWidth: `${cols.length * 32}px` }}>
          <ul className="flex h-44 items-end gap-1 border-b border-line-strong sm:gap-1.5" aria-label="Sales per hour">
            {cols.map((c) => {
              const h = c.sales > 0 ? Math.max((c.sales / max) * 100, 2) : 0;
              const label = `${hourLabel(c.hour)}: ${money(c.sales)}, ${c.count} order${c.count === 1 ? "" : "s"}`;
              return (
                <li
                  key={c.hour}
                  tabIndex={0}
                  className="group relative flex h-full min-w-0 flex-1 items-end rounded-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                  aria-label={label}
                  title={label}
                >
                  {h > 0 && (
                    <div
                      className="w-full rounded-t-sm bg-brand transition-colors duration-150 group-hover:bg-brand-hover group-focus-visible:bg-brand-hover"
                      style={{ height: `${h}%` }}
                    />
                  )}
                  <span
                    className="tabular pointer-events-none absolute left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-semibold text-surface shadow-pop group-hover:block group-focus-visible:block"
                    style={{ bottom: `${h}%` }}
                    aria-hidden
                  >
                    {money(c.sales)} · {c.count}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 flex gap-1 sm:gap-1.5" aria-hidden>
            {cols.map((c) => (
              <span key={c.hour} className="tabular min-w-0 flex-1 text-center text-[11px] font-medium text-muted">
                {hourLabel(c.hour)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

// ------------------------------------------------------------------ printable summary

function Row({ l, v, bold }: { l: ReactNode; v: ReactNode; bold?: boolean }) {
  return (
    <div className="row" style={bold ? { fontWeight: 700 } : undefined}>
      <span>{l}</span>
      <span>{v}</span>
    </div>
  );
}

function SummaryPrint({
  report: r,
  settings,
  from,
  to,
  by,
  printedAt,
}: {
  report: Report;
  settings: Settings;
  from: number;
  to: number;
  by: string;
  printedAt: number;
}) {
  const money = (c: number) => formatMoney(c, settings.currency, settings.locale);
  // Range still running → interim X report; fully past → end-of-period Z report.
  const interim = to >= printedAt;
  return (
    <div className={`rcpt w${settings.paperWidth}`}>
      <div className="c">
        <div className="brand">{settings.businessName}</div>
        {settings.address && <div className="sub">{settings.address}</div>}
        {settings.phone && <div className="sub">{settings.phone}</div>}
        <div className="doc">{interim ? "X REPORT · INTERIM" : "Z REPORT · END OF DAY"}</div>
        <div className="sub">{rangeLabel(from, to)}</div>
      </div>
      <hr className="solid" />
      <div className="doc">SALES</div>
      <Row l="Gross sales" v={money(r.gross)} />
      <Row l="Discounts" v={`-${money(r.discounts)}`} />
      {r.adjustments > 0 && <Row l="Adjustments" v={`-${money(r.adjustments)}`} />}
      <Row l={`Refunds (${r.refundCount})`} v={`-${money(r.refunds)}`} />
      <hr />
      <div className="row grand">
        <span>NET SALES</span>
        <span>{money(r.net)}</span>
      </div>
      <hr />
      <Row l="Tax collected" v={money(r.tax)} />
      <Row l="Service charges" v={money(r.serviceCharges)} />
      {r.deliveryFees > 0 && <Row l="Delivery fees" v={money(r.deliveryFees)} />}
      <Row l="Tips" v={money(r.tips)} />
      <Row l="Total billed" v={money(r.totalBilled)} bold />
      <hr />
      <Row l="Orders" v={r.orderCount} />
      <Row l="Items sold" v={r.itemsSold} />
      <Row l="Average order" v={money(r.avgOrder)} />
      <Row l={`Cancelled (${r.cancelledCount})`} v={money(r.cancelledValue)} />
      <Row l={`Open / unpaid (${r.openCount})`} v={money(r.openDue)} />
      <hr className="solid" />
      <div className="doc">PAYMENTS</div>
      {r.methods.map((m) => (
        <Fragment key={m.method}>
          <Row l={`${METHOD_LABEL[m.method]} (${m.paymentCount})`} v={money(m.payments)} />
          {m.refundCount > 0 && <Row l={`  ${METHOD_LABEL[m.method]} refunds (${m.refundCount})`} v={`-${money(m.refunds)}`} />}
        </Fragment>
      ))}
      <hr />
      <Row l="NET COLLECTED" v={money(r.collected)} bold />
      {(() => {
        const cash = r.methods.find((m) => m.method === "cash");
        return cash ? <Row l="Expected cash in drawer" v={money(cash.net)} /> : null;
      })()}
      <hr className="solid" />
      <div className="doc">ORDER TYPES</div>
      {r.types.map((t) => (
        <Row key={t.type} l={`${ORDER_TYPE_LABEL[t.type]} (${t.count})`} v={money(t.sales)} />
      ))}
      {r.staff.length > 0 && (
        <>
          <hr className="solid" />
          <div className="doc">STAFF</div>
          {r.staff.map((s) => (
            <Row key={s.name} l={`${s.name} (${s.count})`} v={money(s.sales)} />
          ))}
        </>
      )}
      {r.topItems.length > 0 && (
        <>
          <hr className="solid" />
          <div className="doc">TOP ITEMS</div>
          {r.topItems.map((it, i) => (
            <Row key={it.name + i} l={`${it.qty} × ${it.name}`} v={money(it.revenue)} />
          ))}
        </>
      )}
      <hr className="solid" />
      <div className="c sub">
        Printed {formatDateTime(printedAt)}
        <br />
        by {by}
      </div>
    </div>
  );
}

