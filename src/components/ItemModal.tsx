"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Lock, Minus, Plus } from "lucide-react";
import type { MenuItem, ModifierGroup, OrderItem, SelectedModifier } from "@/lib/types";
import { Badge, Button, ColHead, Modal, Textarea, cx } from "./ui";
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
          <div className="flex shrink-0 items-center divide-x divide-line-strong overflow-hidden rounded-xl border border-line-strong bg-surface">
            <button
              type="button"
              className="flex size-12 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              disabled={qty <= 1 || locked}
              onClick={() => setQty((q) => q - 1)}
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" />
            </button>
            <span className="flex h-12 w-12 items-center justify-center text-lg font-bold tabular text-ink">{qty}</span>
            <button
              type="button"
              className="flex size-12 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              disabled={locked}
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              aria-label="Increase quantity"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <Button variant="primary" size="lg" className="flex-1" onClick={submit} disabled={locked}>
            {initial ? "Update" : "Add"} · <span className="tabular">{money(unit * qty)}</span>
          </Button>
        </div>
      }
    >
      {locked && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-sm font-medium text-warn">
          <Lock className="mt-0.5 size-4 shrink-0" />
          This item is already in the kitchen and can’t be changed. Void it and add a new one instead.
        </p>
      )}
      <div className="space-y-6">
        {itemGroups.map((g) => {
          const cur = selected[g.id] ?? [];
          const err = showErrors && cur.length < g.min;
          const rule = g.min > 0 ? (g.max > 1 ? `Pick ${g.min}–${g.max}` : "Pick 1") : g.max > 1 ? `Up to ${g.max}` : "Pick 1";
          return (
            <section key={g.id} aria-invalid={err || undefined}>
              <div className="mb-2 flex items-center gap-2">
                <ColHead className="text-[12px]">{g.name}</ColHead>
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs text-muted tabular">{rule}</span>
                {g.min > 0 ? (
                  <Badge tone={err ? "red" : "brand"}>
                    {err && <AlertCircle className="size-3" />}
                    Required
                  </Badge>
                ) : (
                  <Badge tone="gray">Optional</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.options.map((o) => {
                  const on = cur.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={g.max === 1 ? "radio" : "checkbox"}
                      aria-checked={on}
                      disabled={locked}
                      onClick={() => toggle(g, o.id)}
                      className={cx(
                        "flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed",
                        on
                          ? "border-brand bg-brand-soft"
                          : err
                            ? "border-dashed border-bad bg-surface hover:bg-surface-2"
                            : "border-line-strong bg-surface hover:border-brand-ink/50 hover:bg-surface-2",
                        locked && !on && "opacity-60",
                      )}
                    >
                      <span
                        className={cx(
                          "flex size-5 shrink-0 items-center justify-center border transition-colors duration-150",
                          g.max === 1 ? "rounded-full" : "rounded-md",
                          on ? "border-brand bg-brand text-on-brand" : "border-line-strong bg-surface",
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3.5} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block text-sm font-semibold leading-tight", on ? "text-brand-ink" : "text-ink")}>{o.name}</span>
                        {o.price !== 0 && <span className="mt-0.5 block text-xs text-muted tabular">+{money(o.price)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <ColHead className="text-[12px]">Notes for kitchen</ColHead>
            <span className="h-px flex-1 bg-line" />
            <Badge tone="gray">Optional</Badge>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((n) => {
              const used = notes.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={locked}
                  onClick={() => setNotes((v) => (v.includes(n) ? v : v ? `${v}, ${n}` : n))}
                  className={cx(
                    "h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 disabled:opacity-50",
                    used ? "border-pen/40 bg-pen-soft text-pen" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {used ? <Check className="-ml-0.5 mr-1 inline size-3.5 align-[-2px]" /> : <Plus className="-ml-0.5 mr-1 inline size-3.5 align-[-2px]" />}
                  {n}
                </button>
              );
            })}
          </div>
          <Textarea value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions" className="pen min-h-16" />
        </section>
      </div>
    </Modal>
  );
}
