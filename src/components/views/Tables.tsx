"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCheck, CreditCard, FileText, LayoutGrid, Merge, Minus, Pencil, Plus } from "lucide-react";
import { useSession } from "@/client/session";
import { useNow, useOpenOrders, usePaymentsByOrders, useTables } from "@/client/hooks";
import { now, orderPayments, updateOrder } from "@/client/repo";
import { computeTotals, summarizePayments } from "@/lib/calc";
import { timeAgo } from "@/lib/format";
import type { DiningTable, Order } from "@/lib/types";
import { Badge, Button, ColHead, EmptyState, Modal, Segmented, Spinner, cx, useConfirm, useToast } from "../ui";
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
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-3 py-3 sm:px-5">
        <div className="mr-auto">
          <h1 className="text-[21px] font-bold leading-tight tracking-[-0.01em]">Tables</h1>
          <p className="text-sm text-muted tabular">
            {occupiedCount} of {tables.length} occupied
          </p>
        </div>
        <div className="max-w-full overflow-x-auto">
          <Segmented
            size="sm"
            className="w-max min-w-full"
            value={area}
            onChange={setArea}
            options={["all", ...areas].map((a) => ({ value: a, label: a === "all" ? "All areas" : a }))}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] font-semibold text-ink-2">
          <Legend cls={TOP.free} label="Free" />
          <Legend cls={TOP.seated} label="Seated" />
          <Legend cls={TOP.ready} label="Food ready to run" />
          <Legend cls={TOP.billed} label="Check printed" />
          <span className="flex items-center gap-1.5">
            <span className="chair !static" style={{ background: "var(--brand)" }} /> Occupied seat
          </span>
        </div>
        {tables.length === 0 ? (
          <EmptyState icon={<LayoutGrid className="size-7" />} title="No tables yet">
            Add your tables in Settings → Tables.
          </EmptyState>
        ) : (
          <div className="space-y-5">
            {areas
              .filter((a) => area === "all" || a === area)
              .map((a) => {
                const inArea = shown.filter((t) => (t.area || "Main") === a);
                const free = inArea.filter((t) => !byTable.has(t.id)).length;
                const patio = /patio|terrace|garden|outdoor|deck/i.test(a);
                return (
                  <section key={a} className={cx("floor overflow-hidden rounded-xl border border-line", patio && "floor-patio")}>
                    <header className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
                      <h2 className="text-base font-bold tracking-[-0.01em]">{a}</h2>
                      <p className="text-sm text-muted tabular">
                        {free} of {inArea.length} free
                      </p>
                    </header>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-2 gap-y-4 p-4 pt-2">
                      {inArea.map((t) => {
                        const orders = byTable.get(t.id) ?? [];
                        const o = orders[0];
                        const total = orders.reduce((s, x) => s + computeTotals(x).total, 0);
                        const due = orders.reduce((s, x) => s + summarizePayments(computeTotals(x).total, pays?.get(x.id) ?? []).balance, 0);
                        const ready = orders.some((x) => x.items.some((i) => i.status === "ready" && !i.voided));
                        const billed = orders.some((x) => x.billPrintedAt);
                        const state = !o ? "free" : ready ? "ready" : billed ? "billed" : "seated";
                        const guests = o?.guests ?? 0;
                        return (
                          <button
                            key={t.id}
                            onClick={() => (o ? setSelected(t) : setNewFor(t))}
                            className="group flex flex-col items-center gap-1.5 rounded-xl py-1 outline-none transition-transform duration-150 focus-visible:ring-3 focus-visible:ring-[var(--ring)] active:scale-[0.97]"
                          >
                            <TableShape seats={t.seats} occupied={guests} state={state}>
                              <span className="block text-xl font-bold leading-none tabular">{t.name}</span>
                              <span className="mt-1 block text-[11px] font-semibold tabular text-ink-2">
                                {o ? `${guests}/${t.seats}` : `${t.seats} seats`}
                              </span>
                            </TableShape>
                            {o ? (
                              <span className="flex flex-col items-center leading-tight">
                                <span className="text-[13px] font-semibold text-ink-2">
                                  <span className="serial">#{o.number}</span> · <span className="tabular">{timeAgo(o.createdAt, nowTs)}</span>
                                </span>
                                <span className="display text-[15px]">{money(due > 0 ? due : total)}</span>
                                {ready && (
                                  <Badge tone="green" className="mt-1">
                                    <CheckCheck className="size-3" /> Food ready
                                  </Badge>
                                )}
                                {billed && !ready && (
                                  <Badge tone="amber" className="mt-1">
                                    <FileText className="size-3" /> Check printed
                                  </Badge>
                                )}
                                {orders.length > 1 && (
                                  <Badge tone="red" className="mt-1">
                                    <AlertTriangle className="size-3" /> {orders.length} checks
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <span className="text-[13px] font-semibold text-muted">Free · tap to seat</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
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

/** Table-top fill by state: free = white, seated = soft green, food ready = ok, check printed = warn (go collect). */
const TOP: Record<string, string> = {
  free: "border-brand-ink/35 bg-surface text-ink",
  seated: "border-brand-ink/60 bg-brand-soft text-brand-ink",
  ready: "border-ok bg-ok-soft text-ok",
  billed: "border-warn-line bg-warn-soft text-warn",
};

/**
 * A table drawn from above: a round top (square for two-tops) with one chair per seat.
 * Occupied seats are filled in, so you can read how full the room is at a glance.
 */
function TableShape({ seats, occupied, state, children }: { seats: number; occupied: number; state: string; children: React.ReactNode }) {
  const n = Math.max(1, Math.min(seats, 12));
  const size = 128;
  const c = size / 2;
  const twoTop = n <= 2;
  const r = twoTop ? 50 : 56;
  return (
    <span className="relative block" style={{ width: size, height: size }}>
      {Array.from({ length: n }, (_, i) => {
        const deg = twoTop ? (i === 0 ? -90 : 90) : (360 / n) * i - 90;
        const rad = (deg * Math.PI) / 180;
        return (
          <span
            key={i}
            className="chair"
            style={{
              left: c + r * Math.cos(rad) - 11,
              top: c + r * Math.sin(rad) - 5,
              rotate: `${deg + 90}deg`,
              background: i < occupied ? "var(--brand)" : undefined,
            }}
          />
        );
      })}
      <span
        className={cx(
          "absolute flex flex-col items-center justify-center border text-center transition-[border-color,box-shadow] duration-150 group-hover:border-brand-ink group-hover:shadow-card",
          state === "ready" && "border-2",
          twoTop ? "inset-[30px] rounded-xl" : "inset-[22px] rounded-full",
          TOP[state],
        )}
      >
        {children}
      </span>
    </span>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("size-3.5 rounded-full border", cls)} />
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
      <p className="mb-3 text-center text-[13px] font-semibold text-ink-2">How many guests?</p>
      <div className="flex items-center justify-center gap-5">
        <button className="flex size-14 items-center justify-center rounded-xl border border-line-strong bg-surface transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3" onClick={() => setG((x) => Math.max(1, x - 1))} aria-label="Fewer">
          <Minus className="size-6" />
        </button>
        <span className="display w-14 text-center text-5xl">{g}</span>
        <button className="flex size-14 items-center justify-center rounded-xl border border-line-strong bg-surface transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3" onClick={() => setG((x) => Math.min(50, x + 1))} aria-label="More">
          <Plus className="size-6" />
        </button>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
          <button key={n} onClick={() => setG(n)} className={cx("h-11 rounded-lg border font-semibold tabular transition-colors duration-150", g === n ? "border-brand bg-brand text-on-brand" : "border-line-strong bg-surface hover:bg-surface-2")}>
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
              <div key={o.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
                  <p className="serial text-xl leading-none">#{o.number}</p>
                  <p className="display text-xl leading-none">{money(t.total)}</p>
                </div>
                <dl className="mx-4 mt-3 grid grid-cols-3 divide-x divide-line rounded-lg border border-line-strong">
                  <div className="px-2.5 py-1.5">
                    <dt><ColHead>Guests</ColHead></dt>
                    <dd className="text-sm font-semibold tabular">{o.guests ?? 1}</dd>
                  </div>
                  <div className="px-2.5 py-1.5">
                    <dt><ColHead>Items</ColHead></dt>
                    <dd className="text-sm font-semibold tabular">{t.itemCount}</dd>
                  </div>
                  <div className="min-w-0 px-2.5 py-1.5">
                    <dt><ColHead>Server</ColHead></dt>
                    <dd className="truncate text-sm font-semibold">{o.createdBy}</dd>
                  </div>
                </dl>
                {ready > 0 && (
                  <p className="mx-4 mt-2.5 flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-sm font-semibold text-ok">
                    <CheckCheck className="size-4" /> {ready} item{ready > 1 ? "s" : ""} ready to serve
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line bg-surface-2 p-3">
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
                className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-brand-ink/35 bg-surface transition-colors duration-150 hover:border-brand hover:bg-brand-soft"
              >
                <span className="rounded-md border border-line-strong px-1.5 text-lg font-semibold tabular">{t.name}</span>
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
