"use client";
import { useState } from "react";
import { Ban, ChefHat, CheckCheck, Minus, Plus, Trash2 } from "lucide-react";
import { itemLineTotal } from "@/lib/calc";
import type { Order, OrderItem } from "@/lib/types";
import { cx } from "./ui";
import { useMoney } from "./orderActions";

const STATUS_CHIP: Record<OrderItem["status"], { label: string; cls: string; icon?: typeof ChefHat } | null> = {
  new: null,
  sent: { label: "In kitchen", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", icon: ChefHat },
  ready: { label: "Ready", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", icon: CheckCheck },
  served: { label: "Served", cls: "bg-surface-3 text-ink-2", icon: CheckCheck },
};

/**
 * Editable list of order lines. Used by the register cart and by checkout's “Edit order” mode,
 * so the receipt slip always reflects exactly what's being edited.
 */
export function OrderLines({
  order,
  readOnly,
  onIncrement,
  onDecrement,
  onRemove,
  onEdit,
  highlightId,
}: {
  order: Order;
  readOnly?: boolean;
  onIncrement: (item: OrderItem) => void;
  onDecrement: (item: OrderItem) => void;
  onRemove: (item: OrderItem) => void;
  onEdit: (item: OrderItem) => void;
  highlightId?: string | null;
}) {
  const money = useMoney();
  const [showVoided, setShowVoided] = useState(false);
  const live = order.items.filter((i) => !i.voided);
  const voided = order.items.filter((i) => i.voided);

  return (
    <div>
      <ul className="divide-y divide-line">
        {live.map((it) => {
          const chip = STATUS_CHIP[it.status];
          return (
            <li key={it.id} className={cx("flex gap-3 px-1 py-3", highlightId === it.id && "anim-flash rounded-xl")}>
              <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(it)} disabled={readOnly}>
                <div className="flex items-start gap-2">
                  <span className="font-semibold leading-snug text-ink">{it.name}</span>
                  {chip && (
                    <span className={cx("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", chip.cls)}>
                      {chip.icon && <chip.icon className="size-3" />}
                      {chip.label}
                    </span>
                  )}
                </div>
                {it.modifiers.length > 0 && <p className="mt-0.5 text-[13px] leading-snug text-muted">{it.modifiers.map((m) => m.name).join(" · ")}</p>}
                {it.notes && <p className="mt-0.5 text-[13px] italic leading-snug text-amber-700 dark:text-amber-300">“{it.notes}”</p>}
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="font-semibold tabular">{money(itemLineTotal(it))}</span>
                {!readOnly && (
                  <div className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
                    <button
                      onClick={() => (it.qty <= 1 ? onRemove(it) : onDecrement(it))}
                      className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-line"
                      aria-label={it.qty <= 1 ? "Remove item" : "Decrease quantity"}
                    >
                      {it.qty <= 1 ? <Trash2 className="size-4 text-rose-600" /> : <Minus className="size-4" />}
                    </button>
                    <span className="w-7 text-center text-[15px] font-bold tabular">{it.qty}</span>
                    <button onClick={() => onIncrement(it)} className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-line" aria-label="Increase quantity">
                      <Plus className="size-4" />
                    </button>
                  </div>
                )}
                {readOnly && <span className="text-sm text-muted tabular">× {it.qty}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {voided.length > 0 && (
        <div className="mt-1 border-t border-dashed border-line pt-2">
          <button onClick={() => setShowVoided((v) => !v)} className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-muted hover:text-ink">
            <Ban className="size-3.5" />
            {voided.length} voided / refunded item{voided.length > 1 ? "s" : ""} {showVoided ? "▴" : "▾"}
          </button>
          {showVoided && (
            <ul className="mt-1">
              {voided.map((it) => (
                <li key={it.id} className="flex justify-between gap-3 px-1 py-1.5 text-[13px] text-muted">
                  <span className="min-w-0">
                    <span className="line-through">
                      {it.qty}× {it.name}
                    </span>{" "}
                    · {it.voided?.refunded ? "refunded" : "void"}: {it.voided?.reason} ({it.voided?.by})
                  </span>
                  <span className="line-through tabular">{money(itemLineTotal(it))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
