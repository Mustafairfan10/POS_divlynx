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
import { EmptyState, Segmented, cx } from "../ui";

const TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };
/** Dockets hang a little crooked on the rail, like real ones. */
const TILT = [-0.7, 0.5, -0.3, 0.8, -0.5, 0.3];

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
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 glass sm:p-4">
        <div className="mr-auto flex items-center gap-2">
          <ChefHat className="size-6 text-brand" />
          <h1 className="display text-xl font-semibold">Kitchen</h1>
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-sm font-bold text-on-brand">{active.length}</span>
        <button onClick={() => setSound((s) => !s)} className="ml-1 flex size-10 items-center justify-center rounded-xl hover:bg-surface-3" aria-label={sound ? "Mute new-ticket chime" : "Unmute chime"}>
          {sound ? <Bell className="size-5" /> : <BellOff className="size-5 text-muted" />}
        </button>
        </div>
        <Segmented size="sm" className="w-48" value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "done", label: "Recently done" }]} />
        <Segmented
          size="sm"
          className="w-full sm:w-80"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "dine_in", label: "Dine-in" }, { value: "takeaway", label: "Takeaway" }, { value: "delivery", label: "Delivery" }]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-4 sm:px-6">
        {list.length === 0 ? (
          <EmptyState icon={<ChefHat className="size-7" />} title={show === "active" ? "All caught up" : "Nothing completed yet"}>
            {show === "active" ? "New tickets appear here as soon as orders are sent — even from other devices." : "Bumped tickets show here so you can recall them."}
          </EmptyState>
        ) : (
          <>
            {/* The pass: a steel ticket rail the dockets hang from. */}
            <div className="ticket-rail mb-1 hidden sm:block" aria-hidden />
            <div className="grid items-start gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {list.map((o, idx) => {
                const sent = firstSent(o);
                const mins = (nowTs - sent) / 60000;
                const urgency = show === "done" ? "done" : mins >= 20 ? "late" : mins >= 10 ? "warn" : "ok";
                const Icon = TYPE_ICON[o.type];
                const visible = o.items.filter((i) => i.sentAt);
                const left = visible.filter((i) => i.status === "sent" && !i.voided).length;
                return (
                  <article
                    key={o.id}
                    className="docket anim-rise relative"
                    style={{ rotate: `${TILT[idx % TILT.length]}deg`, animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                  >
                    <span className="docket-clip" aria-hidden />
                    <div className={cx("docket-heat", `heat-${urgency}`)} aria-hidden />
                    <header className="flex items-start gap-3 px-4 pb-2 pt-4">
                      <div className="min-w-0 flex-1">
                        <p className="docket-label">
                          <Icon className="mr-1 inline size-3.5 -translate-y-px" />
                          {ORDER_TYPE_LABEL[o.type]}
                          {o.type === "dine_in" && tableName(o.tableId) ? ` · Table ${tableName(o.tableId)}` : ""}
                        </p>
                        <p className="display mt-1 text-[1.65rem] font-semibold leading-none">{o.number}</p>
                        {o.customer.name && <p className="mt-1 truncate text-sm font-semibold">{o.customer.name}</p>}
                      </div>
                      <div className="text-right">
                        <span className={cx("docket-timer", `heat-${urgency}`)}>{timeAgo(sent, nowTs)}</span>
                        {show === "active" && (
                          <p className="mt-1 text-xs font-semibold opacity-70">
                            {left} to go
                          </p>
                        )}
                      </div>
                    </header>
                    <div className="perf" aria-hidden />
                    <ul className="px-2 py-1">
                      {visible.map((it) => (
                        <li key={it.id}>
                          <button
                            disabled={!!it.voided || o.status === "cancelled"}
                            onClick={() => setItem(o, it, it.status === "sent" ? "ready" : "sent")}
                            className={cx("docket-line flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left", it.status !== "sent" && !it.voided && "is-done")}
                          >
                            <span className={cx("docket-check", it.voided ? "is-void" : it.status !== "sent" && "is-on")}>
                              {it.voided ? <XCircle className="size-4" /> : it.status !== "sent" && <Check className="size-4" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="docket-item block text-[17px] font-bold leading-snug">
                                <span className="display mr-1.5 text-[15px]">{it.qty}</span>
                                {it.name}
                                {it.voided && <span className="docket-void">VOID</span>}
                              </span>
                              {it.modifiers.length > 0 && <span className="block text-sm opacity-75">{it.modifiers.map((m) => m.name).join(" · ")}</span>}
                              {it.notes && <span className="docket-note">{it.notes}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {o.note && <p className="mx-4 mb-2 border-l-4 border-current pl-2 text-sm font-semibold">Note: {o.note}</p>}
                    <div className="px-3 pb-3 pt-1">
                      {show === "active" ? (
                        <button className={cx("docket-bump", o.status === "cancelled" && "is-cancel")} onClick={() => bump(o)}>
                          <Check className="size-5" strokeWidth={3} />
                          {o.status === "cancelled" ? "Dismiss" : "Bump · all ready"}
                        </button>
                      ) : (
                        <button className="docket-bump is-ghost" onClick={() => recall(o)} disabled={o.status === "cancelled"}>
                          <RotateCcw className="size-4" /> Recall ticket
                        </button>
                      )}
                    </div>
                    {o.status === "cancelled" && <span className="docket-stamp">Cancelled</span>}
                  </article>
                );
              })}
            </div>
          </>
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
