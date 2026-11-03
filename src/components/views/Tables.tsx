"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCheck, CreditCard, FileText, LayoutGrid, Merge, Minus, Pencil, Plus, Users } from "lucide-react";
import { useSession } from "@/client/session";
import { useNow, useOpenOrders, usePaymentsByOrders, useTables } from "@/client/hooks";
import { now, orderPayments, updateOrder } from "@/client/repo";
import { computeTotals, summarizePayments } from "@/lib/calc";
import { timeAgo } from "@/lib/format";
import type { DiningTable, Order } from "@/lib/types";
import { Badge, Button, EmptyState, Modal, Spinner, cx, useConfirm, useToast } from "../ui";
import { useMoney, useOrderActions } from "../orderActions";

export function TablesView() {
  const tables = useTables();
  const open = useOpenOrders();
  const ids = useMemo(() => open?.map((o) => o.id), [open]);
  const pays = usePaymentsByOrders(ids);
  const money = useMoney();
  const nowTs = useNow(30_000);
  const { startNewOrder, go } = useSession();
  const [selected, setSelected] = useState<DiningTable | null>(null);
  const [newFor, setNewFor] = useState<DiningTable | null>(null);
  const [area, setArea] = useState<string>("all");

  const byTable = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of open ?? []) if (o.type === "dine_in" && o.tableId) m.set(o.tableId, [...(m.get(o.tableId) ?? []), o]);
    return m;
  }, [open]);

  if (!tables || !open) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  const areas = [...new Set(tables.map((t) => t.area || "Main"))];
  const shown = tables.filter((t) => area === "all" || (t.area || "Main") === area);
  const occupiedCount = tables.filter((t) => byTable.has(t.id)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface p-3 sm:p-4">
        <div className="mr-auto">
          <h1 className="text-xl font-bold">Tables</h1>
          <p className="text-sm text-muted">
            {occupiedCount} of {tables.length} occupied
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {["all", ...areas].map((a) => (
            <button key={a} onClick={() => setArea(a)} className={cx("h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold", area === a ? "border-transparent bg-ink text-surface" : "border-line-strong text-ink-2")}>
              {a === "all" ? "All areas" : a}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap gap-3 text-xs font-semibold text-muted">
          <Legend cls="border-line bg-surface" label="Free" />
          <Legend cls="border-sky-300 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/40" label="Seated" />
          <Legend cls="border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40" label="Food ready" />
          <Legend cls="border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40" label="Check printed" />
        </div>
        {tables.length === 0 ? (
          <EmptyState icon={<LayoutGrid className="size-7" />} title="No tables yet">
            Add your tables in Settings → Tables.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {shown.map((t) => {
              const orders = byTable.get(t.id) ?? [];
              const o = orders[0];
              const total = orders.reduce((s, x) => s + computeTotals(x).total, 0);
              const due = orders.reduce((s, x) => s + summarizePayments(computeTotals(x).total, pays?.get(x.id) ?? []).balance, 0);
              const ready = orders.some((x) => x.items.some((i) => i.status === "ready" && !i.voided));
              const billed = orders.some((x) => x.billPrintedAt);
              const state = !o ? "free" : ready ? "ready" : billed ? "billed" : "seated";
              return (
                <button
                  key={t.id}
                  onClick={() => (o ? setSelected(t) : setNewFor(t))}
                  className={cx(
                    "relative flex min-h-36 flex-col rounded-2xl border-2 p-3.5 text-left transition active:scale-[0.98]",
                    state === "free" && "border-line bg-surface hover:border-line-strong",
                    state === "seated" && "border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10",
                    state === "ready" && "border-emerald-400 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
                    state === "billed" && "border-amber-400 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl font-bold">{t.name}</span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Users className="size-3.5" />
                      {o?.guests ?? t.seats}
                      {!o && " seats"}
                    </span>
                  </div>
                  {o ? (
                    <div className="mt-auto space-y-1">
                      <p className="text-sm font-semibold tabular">
                        #{o.number} · {timeAgo(o.createdAt, nowTs)}
                      </p>
                      <p className="text-lg font-bold tabular">{money(due > 0 ? due : total)}</p>
                      <div className="flex flex-wrap gap-1">
                        {ready && <Badge tone="green">Food ready</Badge>}
                        {billed && !ready && <Badge tone="amber">Check printed</Badge>}
                        {orders.length > 1 && (
                          <Badge tone="red">
                            <AlertTriangle className="size-3" /> {orders.length} checks
                          </Badge>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-auto text-sm font-semibold text-muted">Free · tap to seat</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <SeatModal
        table={newFor}
        onClose={() => setNewFor(null)}
        onSeat={(guests) => {
          if (!newFor) return;
          startNewOrder({ type: "dine_in", tableId: newFor.id, guests });
          setNewFor(null);
        }}
      />
      <TableOrdersModal
        table={selected}
        orders={selected ? byTable.get(selected.id) ?? [] : []}
        onClose={() => setSelected(null)}
        onOpen={(id, view) => {
          setSelected(null);
          go(view, { orderId: id });
        }}
        freeTables={tables.filter((t) => !byTable.has(t.id))}
      />
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("size-3.5 rounded border-2", cls)} />
      {label}
    </span>
  );
}

function SeatModal({ table, onClose, onSeat }: { table: DiningTable | null; onClose: () => void; onSeat: (guests: number) => void }) {
  const [g, setG] = useState(2);
  return (
    <Modal
      open={!!table}
      onClose={onClose}
      title={`Seat Table ${table?.name ?? ""}`}
      subtitle={`${table?.seats ?? 0} seats · ${table?.area ?? ""}`}
      size="sm"
      footer={
        <Button variant="primary" size="lg" block onClick={() => onSeat(g)}>
          Start order · {g} guest{g > 1 ? "s" : ""}
        </Button>
      }
    >
      <p className="mb-3 text-center text-sm font-semibold text-muted">How many guests?</p>
      <div className="flex items-center justify-center gap-5">
        <button className="flex size-14 items-center justify-center rounded-2xl bg-surface-3" onClick={() => setG((x) => Math.max(1, x - 1))} aria-label="Fewer">
          <Minus className="size-6" />
        </button>
        <span className="w-14 text-center text-5xl font-bold tabular">{g}</span>
        <button className="flex size-14 items-center justify-center rounded-2xl bg-surface-3" onClick={() => setG((x) => Math.min(50, x + 1))} aria-label="More">
          <Plus className="size-6" />
        </button>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
          <button key={n} onClick={() => setG(n)} className={cx("h-11 rounded-xl border font-semibold", g === n ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong")}>
            {n}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function TableOrdersModal({
  table,
  orders,
  onClose,
  onOpen,
  freeTables,
}: {
  table: DiningTable | null;
  orders: Order[];
  onClose: () => void;
  onOpen: (id: string, view: "register" | "checkout") => void;
  freeTables: DiningTable[];
}) {
  const { staff } = useSession();
  const money = useMoney();
  const actions = useOrderActions();
  const confirm = useConfirm();
  const toast = useToast();
  const [moving, setMoving] = useState<Order | null>(null);

  async function merge() {
    const [target, ...rest] = [...orders].sort((a, b) => a.createdAt - b.createdAt);
    for (const src of rest) {
      const paid = summarizePayments(computeTotals(src).total, await orderPayments(src.id)).net;
      if (paid > 0) {
        toast.error(`Check #${src.number} already has payments — settle it separately.`);
        return;
      }
    }
    const res = await confirm({
      title: `Merge ${orders.length} checks into #${target.number}?`,
      message: "All items move to the oldest check. The other checks are closed as merged. Kitchen progress is kept.",
      confirmLabel: "Merge checks",
    });
    if (!res.ok) return;
    const moved = rest.flatMap((o) => o.items.map((i) => ({ ...i, updatedAt: now() })));
    await updateOrder(target.id, staff.name, (o) => {
      o.items.push(...moved);
      o.guests = Math.max(o.guests ?? 1, ...rest.map((r) => r.guests ?? 1));
    }, "Checks merged", rest.map((r) => `#${r.number}`).join(", "));
    for (const src of rest) {
      await updateOrder(src.id, staff.name, (o) => {
        o.status = "cancelled";
        o.cancelled = { reason: `Merged into #${target.number}`, by: staff.name, at: now() };
      }, "Merged", `into #${target.number}`);
    }
    toast.success(`Merged into #${target.number}`);
    onClose();
  }

  return (
    <>
      <Modal open={!!table && !moving} onClose={onClose} title={`Table ${table?.name ?? ""}`} subtitle={orders.length > 1 ? "This table has more than one open check (e.g. created on two devices while offline)." : undefined} size="md">
        <div className="space-y-3">
          {orders.map((o) => {
            const t = computeTotals(o);
            const ready = o.items.filter((i) => i.status === "ready" && !i.voided).length;
            return (
              <div key={o.id} className="rounded-2xl border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">#{o.number}</p>
                    <p className="text-sm text-muted">
                      {o.guests ?? 1} guests · {t.itemCount} items · {o.createdBy}
                    </p>
                  </div>
                  <p className="text-xl font-bold tabular">{money(t.total)}</p>
                </div>
                {ready > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCheck className="size-4" /> {ready} item{ready > 1 ? "s" : ""} ready to serve
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => onOpen(o.id, "register")}>
                    Open
                  </Button>
                  <Button variant="primary" icon={<CreditCard className="size-4" />} onClick={() => onOpen(o.id, "checkout")}>
                    Pay
                  </Button>
                  <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => actions.printBill(o)}>
                    Print check
                  </Button>
                  <Button variant="outline" icon={<ArrowRightLeft className="size-4" />} onClick={() => setMoving(o)}>
                    Move table
                  </Button>
                </div>
              </div>
            );
          })}
          {orders.length > 1 && (
            <Button variant="warning" block icon={<Merge className="size-4" />} onClick={merge}>
              Merge all checks into one
            </Button>
          )}
        </div>
      </Modal>
      <Modal open={!!moving} onClose={() => setMoving(null)} title={`Move #${moving?.number ?? ""} to…`} size="md">
        {freeTables.length === 0 ? (
          <p className="py-6 text-center text-muted">No free tables right now.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {freeTables.map((t) => (
              <button
                key={t.id}
                onClick={async () => {
                  if (!moving) return;
                  await updateOrder(moving.id, staff.name, (o) => void (o.tableId = t.id), "Moved table", `${table?.name} → ${t.name}`);
                  toast.success(`Moved to table ${t.name}`);
                  setMoving(null);
                  onClose();
                }}
                className="flex h-20 flex-col items-center justify-center rounded-2xl border-2 border-line hover:border-brand"
              >
                <span className="text-lg font-bold">{t.name}</span>
                <span className="text-xs text-muted">
                  {t.seats} seats · {t.area}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
