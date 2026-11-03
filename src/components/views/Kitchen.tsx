"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Bike, Check, ChefHat, RotateCcw, ShoppingBag, UtensilsCrossed, XCircle } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, stripLocal } from "@/client/db";
import { useSession } from "@/client/session";
import { useNow, useTables } from "@/client/hooks";
import { now, updateOrder } from "@/client/repo";
import { ORDER_TYPE_LABEL, timeAgo } from "@/lib/format";
import type { Order, OrderItem, OrderType } from "@/lib/types";
import { Button, EmptyState, Segmented, cx } from "../ui";

const TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };

function useKitchenOrders() {
  return useLiveQuery(async () => {
    const since = Date.now() - 12 * 3600_000;
    return (await db.orders.where("updatedAt").above(since).toArray()).filter((o) => !o.deleted).map(stripLocal);
  }, []);
}

/** Pending = sent to kitchen but not ready yet. */
const pendingItems = (o: Order) => o.items.filter((i) => i.status === "sent" && !i.voided);

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}

export function KitchenView() {
  const orders = useKitchenOrders();
  const tables = useTables();
  const { staff } = useSession();
  const nowTs = useNow(10_000);
  const [filter, setFilter] = useState<OrderType | "all">("all");
  const [show, setShow] = useState<"active" | "done">("active");
  const [sound, setSound] = useState(true);
  const tableName = (id?: string) => tables?.find((t) => t.id === id)?.name;

  const active = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => pendingItems(o).length > 0 && (filter === "all" || o.type === filter))
        .sort((a, b) => firstSent(a) - firstSent(b)),
    [orders, filter],
  );
  const done = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => pendingItems(o).length === 0 && o.items.some((i) => i.sentAt && !i.voided) && (filter === "all" || o.type === filter))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 24),
    [orders, filter],
  );

  // Chime when a new ticket arrives.
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(active.map((o) => o.id + ":" + pendingItems(o).length));
    if (prev.current && sound) {
      for (const id of ids) if (!prev.current.has(id)) {
        beep();
        break;
      }
    }
    prev.current = ids;
  }, [active, sound]);

  async function setItem(order: Order, item: OrderItem, status: OrderItem["status"]) {
    await updateOrder(order.id, staff.name, (o) => {
      const it = o.items.find((i) => i.id === item.id);
      if (!it) return;
      it.status = status;
      it.updatedAt = now();
      if (status === "ready" && !o.items.some((i) => i.status === "sent" && !i.voided) && o.fulfillment === "in_kitchen") o.fulfillment = "ready";
      if (status === "sent" && o.fulfillment === "ready") o.fulfillment = "in_kitchen";
    });
  }

  async function bump(order: Order) {
    await updateOrder(order.id, staff.name, (o) => {
      const t = now();
      for (const it of o.items) {
        if (it.status === "sent" && !it.voided) {
          it.status = "ready";
          it.updatedAt = t;
        }
      }
      if (o.fulfillment === "in_kitchen" || o.fulfillment === "new") o.fulfillment = "ready";
    }, "Kitchen: order ready");
  }

  async function recall(order: Order) {
    await updateOrder(order.id, staff.name, (o) => {
      const t = now();
      for (const it of o.items) {
        if (it.status === "ready" && !it.voided) {
          it.status = "sent";
          it.updatedAt = t;
        }
      }
      if (o.fulfillment === "ready") o.fulfillment = "in_kitchen";
    }, "Kitchen: ticket recalled");
  }

  const list = show === "active" ? active : done;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface p-3 sm:p-4">
        <div className="mr-auto flex items-center gap-2">
          <ChefHat className="size-6 text-brand" />
          <h1 className="text-xl font-bold">Kitchen</h1>
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-sm font-bold text-white dark:text-[#04201d]">{active.length}</span>
        </div>
        <Segmented size="sm" className="w-48" value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "done", label: "Recently done" }]} />
        <Segmented
          size="sm"
          className="w-full sm:w-80"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "dine_in", label: "Dine-in" }, { value: "takeaway", label: "Takeaway" }, { value: "delivery", label: "Delivery" }]}
        />
        <button onClick={() => setSound((s) => !s)} className="flex size-10 items-center justify-center rounded-xl hover:bg-surface-3" aria-label={sound ? "Mute new-ticket chime" : "Unmute chime"}>
          {sound ? <Bell className="size-5" /> : <BellOff className="size-5 text-muted" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {list.length === 0 ? (
          <EmptyState icon={<ChefHat className="size-7" />} title={show === "active" ? "All caught up" : "Nothing completed yet"}>
            {show === "active" ? "New tickets appear here as soon as orders are sent — even from other devices." : "Bumped tickets show here so you can recall them."}
          </EmptyState>
        ) : (
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.map((o) => {
              const sent = firstSent(o);
              const mins = (nowTs - sent) / 60000;
              const urgency = show === "done" ? "done" : mins >= 20 ? "late" : mins >= 10 ? "warn" : "ok";
              const Icon = TYPE_ICON[o.type];
              const visible = o.items.filter((i) => i.sentAt);
              return (
                <article key={o.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  <header
                    className={cx(
                      "flex items-center gap-3 px-4 py-3 text-white",
                      urgency === "ok" && "bg-emerald-600",
                      urgency === "warn" && "bg-amber-500 text-amber-950",
                      urgency === "late" && "bg-rose-600",
                      urgency === "done" && "bg-slate-500",
                      o.status === "cancelled" && "bg-rose-800",
                    )}
                  >
                    <Icon className="size-5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-extrabold leading-none tabular">#{o.number}</p>
                      <p className="mt-0.5 truncate text-[13px] font-semibold opacity-90">
                        {ORDER_TYPE_LABEL[o.type]}
                        {o.type === "dine_in" && tableName(o.tableId) ? ` · Table ${tableName(o.tableId)}` : ""}
                        {o.customer.name ? ` · ${o.customer.name}` : ""}
                      </p>
                    </div>
                    <span className="rounded-lg bg-black/15 px-2 py-1 text-sm font-bold tabular">{timeAgo(sent, nowTs)}</span>
                  </header>
                  {o.status === "cancelled" && (
                    <p className="flex items-center gap-2 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                      <XCircle className="size-4" /> ORDER CANCELLED — stop preparing
                    </p>
                  )}
                  <ul className="divide-y divide-line">
                    {visible.map((it) => (
                      <li key={it.id}>
                        <button
                          disabled={!!it.voided || o.status === "cancelled"}
                          onClick={() => setItem(o, it, it.status === "sent" ? "ready" : "sent")}
                          className={cx("flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2", it.status !== "sent" && !it.voided && "opacity-50")}
                        >
                          <span
                            className={cx(
                              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2",
                              it.voided ? "border-rose-400" : it.status === "sent" ? "border-line-strong" : "border-emerald-600 bg-emerald-600 text-white",
                            )}
                          >
                            {it.voided ? <XCircle className="size-4 text-rose-500" /> : it.status !== "sent" && <Check className="size-4" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cx("block text-[17px] font-bold leading-snug", (it.voided || it.status !== "sent") && "line-through")}>
                              {it.qty}× {it.name}
                              {it.voided && <span className="ml-2 rounded bg-rose-600 px-1.5 py-px text-xs font-extrabold text-white no-underline">VOID</span>}
                            </span>
                            {it.modifiers.length > 0 && <span className="block text-sm text-ink-2">{it.modifiers.map((m) => m.name).join(" · ")}</span>}
                            {it.notes && <span className="mt-0.5 block rounded-md bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">⚠ {it.notes}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {o.note && <p className="border-t border-line bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Note: {o.note}</p>}
                  <div className="border-t border-line p-2.5">
                    {show === "active" ? (
                      <Button variant={o.status === "cancelled" ? "danger" : "success"} size="lg" block icon={<Check className="size-5" />} onClick={() => bump(o)}>
                        {o.status === "cancelled" ? "Dismiss" : "Bump · all ready"}
                      </Button>
                    ) : (
                      <Button variant="outline" block icon={<RotateCcw className="size-4" />} onClick={() => recall(o)} disabled={o.status === "cancelled"}>
                        Recall ticket
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function firstSent(o: Order): number {
  const t = o.items.filter((i) => i.sentAt && i.status === "sent").map((i) => i.sentAt!);
  if (t.length) return Math.min(...t);
  const any = o.items.filter((i) => i.sentAt).map((i) => i.sentAt!);
  return any.length ? Math.min(...any) : o.createdAt;
}
