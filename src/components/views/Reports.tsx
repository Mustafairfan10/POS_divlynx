"use client";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Banknote,
  CalendarRange,
  Clock,
  Download,
  Printer,
  ShoppingBag,
  Trophy,
  Users,
} from "lucide-react";
import { useOrdersSince, usePaymentsByOrders, usePaymentsSince, useStaffList } from "@/client/hooks";
import { useSession } from "@/client/session";
import { printNode } from "@/components/print";
import { Button, Card, EmptyState, Field, Input, Spinner, cx, useToast } from "@/components/ui";
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-3 pb-10 sm:p-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="display text-2xl font-semibold text-ink">Reports</h1>
            <p className="text-[15px] text-muted">{rangeLabel(range.from, range.to)}</p>
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

        {/* Range picker */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:pb-0" role="group" aria-label="Date range presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={preset === p.value}
                  onClick={() => choosePreset(p.value)}
                  className={cx(
                    "h-11 shrink-0 whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition",
                    preset === p.value ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong text-ink-2 hover:bg-surface-3",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2 lg:max-w-md lg:ml-auto">
              <Field label="From">
                <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => applyCustom(e.target.value, customTo)} />
              </Field>
              <Field label="To">
                <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => applyCustom(customFrom, e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : !hasOrders && !hasPayments ? (
          <Card>
            <EmptyState icon={<BarChart3 className="size-7" />} title="No sales in this period">
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

function ReportBody({ report: r, money }: { report: Report; money: (c: number) => string }) {
  return (
    <>
      {/* KPIs */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Net sales" value={money(r.net)} hint="Gross − discounts − adjustments − refunds" highlight />
        <Kpi label="Orders" value={String(r.orderCount)} hint={`${r.itemsSold} items sold`} />
        <Kpi label="Average order" value={money(r.avgOrder)} hint="After discounts, before tax" />
        <Kpi label="Collected" value={money(r.collected)} hint="Approved payments − refunds" />
        <Kpi label="Gross sales" value={money(r.gross)} hint="Item subtotals, excl. cancelled" />
        <Kpi label="Discounts" value={money(r.discounts)} hint={r.adjustments ? `+ ${money(r.adjustments)} adjustments` : "No adjustments"} tone={r.discounts ? "neg" : undefined} />
        <Kpi label="Refunds" value={money(r.refunds)} hint={`${r.refundCount} refund${r.refundCount === 1 ? "" : "s"}`} tone={r.refunds ? "neg" : undefined} />
        <Kpi label="Tax collected" value={money(r.tax)} />
        <Kpi label="Tips" value={money(r.tips)} />
        <Kpi label="Service charges" value={money(r.serviceCharges)} hint={r.deliveryFees ? `Delivery fees ${money(r.deliveryFees)}` : undefined} />
        <Kpi
          label="Cancelled"
          value={String(r.cancelledCount)}
          hint={r.cancelledCount ? `${money(r.cancelledValue)} in items` : "None"}
          tone={r.cancelledCount ? "neg" : undefined}
        />
        <Kpi
          label="Open (unpaid)"
          value={String(r.openCount)}
          hint={r.openCount ? `${money(r.openDue)} still due` : "All settled"}
          tone={r.openCount ? "warn" : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Payment methods */}
        <Section title="Payment methods" icon={<Banknote className="size-5" />}>
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="py-2 font-semibold">Method</th>
                <th className="py-2 text-right font-semibold">Payments</th>
                <th className="py-2 text-right font-semibold">Refunds</th>
                <th className="py-2 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.methods.map((m) => (
                <tr key={m.method} className={cx(!m.paymentCount && !m.refundCount && "text-muted")}>
                  <td className="py-2.5 font-medium">{METHOD_LABEL[m.method]}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {money(m.payments)}
                    <span className="block text-xs text-muted">{m.paymentCount}×</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {m.refunds ? `−${money(m.refunds)}` : money(0)}
                    <span className="block text-xs text-muted">{m.refundCount}×</span>
                  </td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{money(m.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="py-2.5">Total</td>
                <td className="py-2.5 text-right tabular-nums">{money(r.methods.reduce((s, m) => s + m.payments, 0))}</td>
                <td className="py-2.5 text-right tabular-nums">{r.refunds ? `−${money(r.refunds)}` : money(0)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(r.collected)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>

        {/* Order types */}
        <Section title="Order types" icon={<ShoppingBag className="size-5" />}>
          <ul className="space-y-3">
            {r.types.map((t) => {
              const pct = r.orderCount ? Math.round((t.count / r.orderCount) * 100) : 0;
              return (
                <li key={t.type}>
                  <div className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="font-medium text-ink">
                      {ORDER_TYPE_LABEL[t.type]} <span className="text-sm text-muted">· {t.count} order{t.count === 1 ? "" : "s"}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(t.sales)}</span>
                  </div>
                  <div
                    className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-3"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label={`${ORDER_TYPE_LABEL[t.type]}: ${pct}% of orders`}
                  >
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* Sales by hour */}
        <Section title="Sales by hour" icon={<Clock className="size-5" />} className="lg:col-span-2">
          <HourChart hours={r.hours} money={money} />
        </Section>

        {/* Top items */}
        <Section title="Top items" icon={<Trophy className="size-5" />}>
          {r.topItems.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No items sold.</p>
          ) : (
            <ol className="divide-y divide-line">
              {r.topItems.map((it, i) => (
                <li key={it.name + i} className="flex items-center gap-3 py-2.5">
                  <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", i < 3 ? "bg-brand-soft text-brand-ink" : "bg-surface-3 text-ink-2")}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{it.name}</span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-[15px] font-semibold">{it.qty} sold</span>
                    <span className="block text-xs text-muted">{money(it.revenue)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* Staff */}
        <Section title="Sales by staff" icon={<Users className="size-5" />}>
          {r.staff.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No orders.</p>
          ) : (
            <ul className="divide-y divide-line">
              {r.staff.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-[15px] font-medium text-ink">{s.name}</span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-[15px] font-semibold">{money(s.sales)}</span>
                    <span className="block text-xs text-muted">
                      {s.count} order{s.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="flex items-start gap-2 text-sm text-muted">
        <CalendarRange className="mt-0.5 size-4 shrink-0" />
        Sales figures use orders created in the selected period. Payments, refunds and tenders use payments taken in the period. Net sales exclude tax, tips, service charges and delivery fees.
      </p>
    </>
  );
}

function Kpi({ label, value, hint, highlight, tone }: { label: string; value: string; hint?: string; highlight?: boolean; tone?: "neg" | "warn" }) {
  return (
    <Card className={cx("p-3.5 sm:p-4", highlight && "border-brand/40 bg-brand-soft")}>
      <p className={cx("text-sm font-semibold", highlight ? "text-brand-ink" : "text-muted")}>{label}</p>
      <p
        className={cx(
          "mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl",
          highlight ? "text-brand-ink" : tone === "neg" ? "text-rose-600 dark:text-rose-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p>}
    </Card>
  );
}

function Section({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-4 sm:p-5", className)}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-ink">
        <span className="text-brand">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function HourChart({ hours, money }: { hours: Report["hours"]; money: (c: number) => string }) {
  if (hours.length === 0) return <p className="py-4 text-center text-sm text-muted">No orders.</p>;
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

  return (
    <figure>
      <figcaption className="mb-3 text-sm text-muted">
        Busiest hour: <span className="font-semibold text-ink">{hourLabel(peak.hour)}</span> · {money(peak.sales)} from {peak.count} order{peak.count === 1 ? "" : "s"}
      </figcaption>
      <div className="overflow-x-auto">
        <ul className="flex h-48 min-w-full items-end gap-1 sm:gap-1.5" style={{ minWidth: `${cols.length * 28}px` }}>
          {cols.map((c) => {
            const pct = (c.sales / max) * 100;
            const label = `${hourLabel(c.hour)}: ${money(c.sales)}, ${c.count} order${c.count === 1 ? "" : "s"}`;
            return (
              <li key={c.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-label={label} title={label}>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cx("w-full rounded-t-md transition-all", c.sales > 0 ? "bg-brand" : "bg-surface-3")}
                    style={{ height: c.sales > 0 ? `${Math.max(pct, 3)}%` : "3px" }}
                  />
                </div>
                <span className="text-[11px] font-medium text-muted" aria-hidden>
                  {hourLabel(c.hour)}
                </span>
              </li>
            );
          })}
        </ul>
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

