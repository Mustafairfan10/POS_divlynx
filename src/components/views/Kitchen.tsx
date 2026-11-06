"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, AlertTriangle, Ban, Bell, BellOff, Bike, Check, CheckCheck, ChefHat, Clock, RotateCcw, ShoppingBag, StickyNote, UtensilsCrossed, XCircle } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, stripLocal } from "@/client/db";
import { useSession } from "@/client/session";
import { useNow, useTables } from "@/client/hooks";
import { now, updateOrder } from "@/client/repo";
import { ORDER_TYPE_LABEL, timeAgo } from "@/lib/format";
import type { Order, OrderItem, OrderType } from "@/lib/types";
import { Button, EmptyState, IconButton, Segmented, cx } from "../ui";

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
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-3 sm:px-5">
        <div className="mr-auto flex items-center gap-2">
          <ChefHat className="size-6 text-brand-ink" />
          <h1 className="text-[21px] font-bold tracking-[-0.01em]">Kitchen</h1>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-2 text-sm font-bold tabular text-on-brand">{active.length}</span>
          <IconButton onClick={() => setSound((s) => !s)} className="ml-1" label={sound ? "Mute new-ticket chime" : "Unmute chime"}>
            {sound ? <Bell className="size-5" /> : <BellOff className="size-5 text-muted" />}
          </IconButton>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-4 sm:px-5">
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
              const u = URGENCY[urgency];
              const Icon = TYPE_ICON[o.type];
              const visible = o.items.filter((i) => i.sentAt);
              const left = visible.filter((i) => i.status === "sent" && !i.voided).length;
              const cancelled = o.status === "cancelled";
              return (
                <article
                  key={o.id}
                  className={cx(
                    "anim-fade flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-[border-color] duration-200",
                    u.top,
                    cancelled && "border-dashed",
                  )}
                >
                  <header className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="serial text-[26px] leading-none">#{o.number}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                        <Icon className="size-4 shrink-0 text-brand-ink" />
                        {ORDER_TYPE_LABEL[o.type]}
                        {o.type === "dine_in" && tableName(o.tableId) && (
                          <span className="rounded-md border border-line-strong px-1.5 font-semibold tabular text-ink"><span className="sr-only">Table </span>{tableName(o.tableId)}</span>
                        )}
                      </p>
                      {o.customer.name && <p className="pen mt-1 truncate text-sm font-semibold">{o.customer.name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-bold tabular", u.chip)}>
                        {urgency === "late" ? <AlarmClock className="size-4" /> : urgency === "done" ? <CheckCheck className="size-4" /> : <Clock className="size-4" />}
                        {timeAgo(sent, nowTs)}
                      </span>
                      <span className={cx("text-[11px] font-bold uppercase tracking-wide", u.word)}>{u.label}</span>
                      {show === "active" && <span className="text-xs font-semibold tabular text-muted">{left} to go</span>}
                    </div>
                  </header>

                  {cancelled && (
                    <p className="flex items-center gap-2 border-b border-line bg-bad-soft px-4 py-2 text-sm font-bold uppercase tracking-wide text-bad">
                      <Ban className="size-4" /> Cancelled
                    </p>
                  )}

                  <ul className="divide-y divide-line">
                    {visible.map((it) => {
                      const isDone = it.status !== "sent" && !it.voided;
                      return (
                        <li key={it.id}>
                          <button
                            disabled={!!it.voided || cancelled}
                            onClick={() => setItem(o, it, it.status === "sent" ? "ready" : "sent")}
                            aria-pressed={isDone}
                            className="flex min-h-12 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                          >
                            <span
                              className={cx(
                                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150",
                                it.voided ? "border-bad bg-bad-soft text-bad" : isDone ? "border-ok bg-ok text-surface" : "border-line-strong bg-surface",
                              )}
                            >
                              {it.voided ? <XCircle className="size-4" /> : isDone && <Check className="size-4" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-semibold leading-snug">
                                <span className={cx("font-bold tabular", (isDone || it.voided) && "text-muted line-through decoration-2")}>{it.qty}×</span>
                                <span className={cx("min-w-0", (isDone || it.voided) && "text-muted line-through decoration-2")}>{it.name}</span>
                                {it.voided && (
                                  <span className="inline-flex items-center gap-1 self-center rounded-md bg-bad-soft px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-bad">
                                    <Ban className="size-3.5" /> Void
                                  </span>
                                )}
                              </span>
                              {it.modifiers.length > 0 && (
                                <span className={cx("pen mt-0.5 block text-[15px]", (isDone || it.voided) && "opacity-60")}>{it.modifiers.map((m) => m.name).join(" · ")}</span>
                              )}
                              {it.notes && (
                                <span className="pen mt-1 inline-flex items-start gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[15px] font-semibold">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
                                  {it.notes}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {o.note && (
                    <p className="mx-3 mb-1 mt-2 flex items-start gap-1.5 rounded-md bg-warn-soft px-2 py-1.5 text-sm">
                      <StickyNote className="mt-0.5 size-4 shrink-0 text-warn" />
                      <span>
                        <span className="font-semibold text-ink">Note: </span>
                        <span className="pen font-semibold">{o.note}</span>
                      </span>
                    </p>
                  )}
                  <div className="mt-auto p-3">
                    {show === "active" ? (
                      <Button size="lg" block variant={cancelled ? "outline" : "primary"} icon={<Check className="size-5" strokeWidth={3} />} onClick={() => bump(o)}>
                        {cancelled ? "Dismiss" : "Bump · all ready"}
                      </Button>
                    ) : (
                      <Button size="lg" block variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => recall(o)} disabled={cancelled}>
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

/** Ticket age: colour plus an icon, a word and the card's top rule, never colour alone. */
const URGENCY = {
  ok: { label: "On time", chip: "bg-ok-soft text-ok", word: "text-ok", top: "border-t-4 border-t-ok" },
  warn: { label: "Getting late", chip: "bg-warn-soft text-warn", word: "text-warn", top: "border-t-4 border-t-warn" },
  late: { label: "Late", chip: "bg-bad text-surface", word: "text-bad", top: "border-t-[6px] border-t-bad" },
  done: { label: "Done", chip: "bg-surface-3 text-muted", word: "text-muted", top: "border-t-4 border-t-line-strong" },
} as const;

function firstSent(o: Order): number {
  const t = o.items.filter((i) => i.sentAt && i.status === "sent").map((i) => i.sentAt!);
  if (t.length) return Math.min(...t);
  const any = o.items.filter((i) => i.sentAt).map((i) => i.sentAt!);
  return any.length ? Math.min(...any) : o.createdAt;
}
