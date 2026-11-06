"use client";
import { useState } from "react";
import { Ban, ChefHat, CheckCheck, ChevronDown, Minus, Plus, Trash2 } from "lucide-react";
import { itemLineTotal } from "@/lib/calc";
import type { Order, OrderItem } from "@/lib/types";
import { cx } from "./ui";
import { useMoney } from "./orderActions";

const STATUS_CHIP: Record<OrderItem["status"], { label: string; cls: string; icon?: typeof ChefHat } | null> = {
  new: null,
  sent: { label: "In kitchen", cls: "bg-info-soft text-info", icon: ChefHat },
  ready: { label: "Ready", cls: "bg-ok-soft text-ok", icon: CheckCheck },
  served: { label: "Served", cls: "bg-surface-3 text-ink-2", icon: CheckCheck },
};

/**
 * Editable list of order lines, laid out like a guest check (QTY · ITEM · AMOUNT).
 * Used by the register cart and by checkout's “Edit order” mode, so the slip always
 * reflects exactly what's being edited. A dashed qty box means "not sent to the kitchen yet".
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
          const unsent = it.status === "new";
          return (
            <li
              key={it.id}
              className={cx("anim-line grid grid-cols-[2.25rem_1fr_auto] items-start gap-x-3 py-3", highlightId === it.id && "anim-flash")}
            >
              <span
                title={unsent ? "Not sent to the kitchen yet" : undefined}
                className={cx(
                  "flex h-7 items-center justify-center rounded-md border text-[15px] font-bold tabular-nums",
                  unsent ? "border-dashed border-line-strong text-ink" : "border-line bg-surface-2 text-ink-2",
                )}
              >
                {it.qty}
              </span>
              <button className="min-w-0 text-left" onClick={() => onEdit(it)} disabled={readOnly}>
                <span className="block font-semibold leading-snug text-ink">{it.name}</span>
                {it.modifiers.length > 0 && <span className="pen mt-0.5 block text-[13px] leading-snug">{it.modifiers.map((m) => m.name).join(" · ")}</span>}
                {it.notes && <span className="pen mt-0.5 block text-[13px] leading-snug">“{it.notes}”</span>}
                {chip && (
                  <span className={cx("mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-semibold", chip.cls)}>
                    {chip.icon && <chip.icon className="size-3" />}
                    {chip.label}
                  </span>
                )}
              </button>
              <div className="flex flex-col items-end gap-1.5">
                <span className="font-semibold tabular-nums">{money(itemLineTotal(it))}</span>
                {!readOnly && (
                  <div className="flex items-center overflow-hidden rounded-md border border-line">
                    <button
                      onClick={() => (it.qty <= 1 ? onRemove(it) : onDecrement(it))}
                      className="flex size-8 items-center justify-center text-ink-2 transition-colors hover:bg-surface-3"
                      aria-label={it.qty <= 1 ? "Remove item" : "Decrease quantity"}
                    >
                      {it.qty <= 1 ? <Trash2 className="size-4 text-bad" /> : <Minus className="size-4" />}
                    </button>
                    <button
                      onClick={() => onIncrement(it)}
                      className="flex size-8 items-center justify-center border-l border-line text-ink-2 transition-colors hover:bg-surface-3"
                      aria-label="Increase quantity"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {voided.length > 0 && (
        <div className="border-t border-dashed border-line-strong pt-2">
          <button
            onClick={() => setShowVoided((v) => !v)}
            aria-expanded={showVoided}
            className="flex items-center gap-1.5 py-1 text-[13px] font-semibold text-ink-2 hover:text-ink"
          >
            <Ban className="size-3.5 text-bad" />
            {voided.length} voided / refunded item{voided.length > 1 ? "s" : ""}
            <ChevronDown className={cx("size-3.5 transition-transform", showVoided && "rotate-180")} />
          </button>
          {showVoided && (
            <ul className="mt-1 pb-2">
              {voided.map((it) => (
                <li key={it.id} className="grid grid-cols-[2.25rem_1fr_auto] gap-x-3 py-1.5 text-[13px] text-muted">
                  <span className="text-center tabular-nums line-through">{it.qty}</span>
                  <span className="min-w-0">
                    <span className="line-through">{it.name}</span>
                    <span className="block">
                      {it.voided?.refunded ? "Refunded" : "Void"}: <span className="pen">{it.voided?.reason}</span> ({it.voided?.by})
                    </span>
                  </span>
                  <span className="tabular-nums line-through">{money(itemLineTotal(it))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
