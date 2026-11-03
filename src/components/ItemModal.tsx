"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import type { MenuItem, ModifierGroup, OrderItem, SelectedModifier } from "@/lib/types";
import { Button, Modal, Textarea, cx } from "./ui";
import { useMoney } from "./orderActions";

const QUICK_NOTES = ["No ice", "Extra hot", "Less ice", "No onions", "Sauce on side", "Allergy: nuts", "Gluten free", "Takeaway cup"];

export interface ItemChoice {
  modifiers: SelectedModifier[];
  qty: number;
  notes: string;
}

export function ItemModal({
  open,
  onClose,
  menuItem,
  groups,
  initial,
  locked,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  menuItem: MenuItem | null;
  groups: ModifierGroup[];
  initial?: OrderItem;
  /** Item already in the kitchen: only notes can't change; show info. */
  locked?: boolean;
  onSave: (c: ItemChoice) => void;
}) {
  const money = useMoney();
  const itemGroups = useMemo(
    () => (menuItem?.modifierGroupIds ?? []).map((id) => groups.find((g) => g.id === id)).filter(Boolean) as ModifierGroup[],
    [menuItem, groups],
  );
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open || !menuItem) return;
    const sel: Record<string, string[]> = {};
    if (initial) {
      for (const m of initial.modifiers) sel[m.groupId] = [...(sel[m.groupId] ?? []), m.optionId];
    } else {
      // Pre-select the first option of required single-choice groups (e.g. Size → Small).
      for (const g of itemGroups) if (g.min >= 1 && g.max === 1 && g.options[0]) sel[g.id] = [g.options[0].id];
    }
    setSelected(sel);
    setQty(initial?.qty ?? 1);
    setNotes(initial?.notes ?? "");
    setShowErrors(false);
  }, [open, menuItem, initial, itemGroups]);

  if (!menuItem) return null;

  const toggle = (g: ModifierGroup, optId: string) => {
    if (locked) return;
    setSelected((s) => {
      const cur = s[g.id] ?? [];
      if (g.max === 1) return { ...s, [g.id]: cur[0] === optId && g.min === 0 ? [] : [optId] };
      if (cur.includes(optId)) return { ...s, [g.id]: cur.filter((x) => x !== optId) };
      if (cur.length >= g.max) return s;
      return { ...s, [g.id]: [...cur, optId] };
    });
  };

  const modifiers: SelectedModifier[] = itemGroups.flatMap((g) =>
    (selected[g.id] ?? [])
      .map((oid) => g.options.find((o) => o.id === oid))
      .filter(Boolean)
      .map((o) => ({ groupId: g.id, groupName: g.name, optionId: o!.id, name: o!.name, price: o!.price })),
  );
  const missing = itemGroups.filter((g) => (selected[g.id]?.length ?? 0) < g.min);
  const unit = menuItem.price + modifiers.reduce((s, m) => s + m.price, 0);

  function submit() {
    if (missing.length) {
      setShowErrors(true);
      return;
    }
    onSave({ modifiers, qty, notes: notes.trim() });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={menuItem.name}
      subtitle={menuItem.description || money(menuItem.price)}
      size="md"
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-surface-3 p-1">
            <button className="flex size-10 items-center justify-center rounded-lg hover:bg-line disabled:opacity-40" disabled={qty <= 1 || locked} onClick={() => setQty((q) => q - 1)} aria-label="Decrease quantity">
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-lg font-bold tabular">{qty}</span>
            <button className="flex size-10 items-center justify-center rounded-lg hover:bg-line disabled:opacity-40" disabled={locked} onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Increase quantity">
              <Plus className="size-4" />
            </button>
          </div>
          <Button variant="primary" size="lg" className="flex-1" onClick={submit} disabled={locked}>
            {initial ? "Update" : "Add"} · {money(unit * qty)}
          </Button>
        </div>
      }
    >
      {locked && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          This item is already in the kitchen and can’t be changed. Void it and add a new one instead.
        </p>
      )}
      <div className="space-y-5">
        {itemGroups.map((g) => {
          const cur = selected[g.id] ?? [];
          const err = showErrors && cur.length < g.min;
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{g.name}</h3>
                <span className={cx("text-xs font-semibold", err ? "text-rose-600" : "text-muted")}>
                  {g.min > 0 ? `Required${g.max > 1 ? ` · pick ${g.min}–${g.max}` : ""}` : g.max > 1 ? `Optional · up to ${g.max}` : "Optional"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.options.map((o) => {
                  const on = cur.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggle(g, o.id)}
                      className={cx(
                        "flex min-h-14 items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition active:scale-[0.98]",
                        on ? "border-brand bg-brand-soft" : err ? "border-rose-300" : "border-line hover:border-line-strong",
                      )}
                    >
                      <span className={cx("flex size-5 shrink-0 items-center justify-center border-2", g.max === 1 ? "rounded-full" : "rounded-md", on ? "border-brand bg-brand text-white" : "border-line-strong")}>
                        {on && <Check className="size-3" strokeWidth={4} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-tight">{o.name}</span>
                        {o.price !== 0 && <span className="text-xs text-muted">+{money(o.price)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <section>
          <h3 className="mb-2 font-bold">Notes for kitchen</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                disabled={locked}
                onClick={() => setNotes((v) => (v.includes(n) ? v : v ? `${v}, ${n}` : n))}
                className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-surface-3"
              >
                {n}
              </button>
            ))}
          </div>
          <Textarea value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions" className="min-h-16" />
        </section>
      </div>
    </Modal>
  );
}
