"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  ChefHat,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Lock,
  MapPin,
  MoreHorizontal,
  Percent,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  StickyNote,
  Trash2,
  User,
  UtensilsCrossed,
  X,
  XCircle,
} from "lucide-react";
import { useSession } from "@/client/session";
import { useCategories, useMenuItems, useModifierGroups, useOpenOrders, useOrder, useTables } from "@/client/hooks";
import {
  blankOrder,
  findPossibleDuplicate,
  newItemFromMenu,
  now,
  reconcileOrderStatus,
  sameLine,
  saveOrder,
  sendToKitchen,
  updateOrder,
} from "@/client/repo";
import { activeItems, computeTotals } from "@/lib/calc";
import { ORDER_TYPE_LABEL, uid } from "@/lib/format";
import type { MenuItem, Order, OrderItem, OrderType } from "@/lib/types";
import { Badge, Button, EmptyState, Modal, Segmented, cx, useBusy, useConfirm, useToast } from "../ui";
import { ItemModal, type ItemChoice } from "../ItemModal";
import { categoryIcon } from "../categoryIcon";
import { OrderLines } from "../OrderLines";
import { CustomerModal, DiscountModal, NoteModal, TablePickerModal, useMoney, useOrderActions } from "../orderActions";

type Dialog = null | "table" | "customer" | "discount" | "note" | "more";

/** Validate an order before it goes to the kitchen or to payment. Returns the dialog to fix it. */
export function orderProblem(o: Order): { message: string; fix?: Dialog } | null {
  if (!activeItems(o).length) return { message: "Add at least one item first" };
  if (o.type === "dine_in" && !o.tableId) return { message: "Choose a table for this dine-in order", fix: "table" };
  if (o.type === "delivery") {
    const c = o.customer;
    if (!c.name.trim() || c.phone.replace(/\D/g, "").length < 6 || c.address.trim().length < 5)
      return { message: "Delivery orders need the customer's name, phone and address", fix: "customer" };
  }
  return null;
}

export function RegisterView() {
  const { activeOrderId, setActiveOrderId, staff, settings, device, draftPreset, go, startNewOrder } = useSession();
  const existing = useOrder(activeOrderId);
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();
  const actions = useOrderActions();
  const tables = useTables();
  const openOrders = useOpenOrders();
  const [run, busy] = useBusy();

  const lastType = useRef<OrderType>("takeaway");
  const makeDraft = useCallback(
    () => blankOrder(draftPreset?.type ?? lastType.current, settings, device, staff.name, draftPreset ?? {}),
    [draftPreset, settings, device, staff.name],
  );
  const [draft, setDraft] = useState<Order>(makeDraft);
  useEffect(() => {
    if (!activeOrderId) setDraft(makeDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrderId, draftPreset]);

  // Order removed elsewhere (or stale id after reset): fall back to a new order.
  useEffect(() => {
    if (activeOrderId && existing === null) setActiveOrderId(null);
  }, [activeOrderId, existing, setActiveOrderId]);

  const order: Order = existing ?? draft;
  const saved = !!existing;
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const locked = order.status === "cancelled" || (order.status === "closed" && unlocked !== order.id);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ menuItem: MenuItem; item?: OrderItem } | null>(null);

  /** Apply a change to the current order: persists immediately once it has items (crash-safe). */
  const mutate = useCallback(
    async (fn: (o: Order) => void, action?: string, detail?: string) => {
      if (existing) {
        await updateOrder(existing.id, staff.name, fn, action, detail);
        if (existing.status === "closed") await reconcileOrderStatus(existing.id, staff.name);
        return;
      }
      const o = structuredClone(draft);
      fn(o);
      lastType.current = o.type;
      if (o.items.length > 0) {
        const s = await saveOrder(o, staff.name);
        setActiveOrderId(s.id);
      } else {
        setDraft(o);
      }
    },
    [existing, draft, staff.name, setActiveOrderId],
  );

  // ------------------------------------------------------------ menu
  const categories = useCategories();
  const items = useMenuItems();
  const groups = useModifierGroups();
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items ?? []).filter((i) => (term ? i.name.toLowerCase().includes(term) : cat === "all" || i.categoryId === cat));
  }, [items, cat, q]);
  const groupName = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g.name])), [groups]);
  const catById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  // Visual feedback when an item lands in the order: the tile pops and the cart count bumps.
  const [popped, setPopped] = useState<{ id: string; n: number } | null>(null);
  const qtyInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of activeItems(order)) m.set(it.menuItemId, (m.get(it.menuItemId) ?? 0) + it.qty);
    return m;
  }, [order]);

  function addItem(mi: MenuItem, choice: ItemChoice) {
    if (locked) return;
    const line = newItemFromMenu({ menuItemId: mi.id, name: mi.name, basePrice: mi.price, modifiers: choice.modifiers, qty: choice.qty, notes: choice.notes, by: staff.name });
    let flash = line.id;
    void mutate((o) => {
      const same = o.items.find((i) => sameLine(i, line));
      if (same) {
        same.qty += line.qty;
        same.updatedAt = now();
        flash = same.id;
      } else o.items.push(line);
    }).then(() => {
      setFlashId(flash);
      setTimeout(() => setFlashId(null), 800);
    });
  }

  function tapItem(mi: MenuItem) {
    setPopped((p) => ({ id: mi.id, n: (p?.n ?? 0) + 1 }));
    if (locked) {
      toast.warning(order.status === "cancelled" ? "This order is cancelled. Start a new order." : "This order is paid. Unlock it to make changes.");
      return;
    }
    if (!mi.available) {
      toast.warning(`${mi.name} is sold out`);
      return;
    }
    if (mi.modifierGroupIds.length) setEditing({ menuItem: mi });
    else addItem(mi, { modifiers: [], qty: 1, notes: "" });
  }

  // ------------------------------------------------------------ lines
  const lineHandlers = {
    onIncrement: (it: OrderItem) => {
      if (it.status === "new") {
        void mutate((o) => {
          const x = o.items.find((i) => i.id === it.id);
          if (x) {
            x.qty += 1;
            x.updatedAt = now();
          }
        });
      } else {
        // Already in the kitchen: add another as a new line so the kitchen sees it.
        const clone: OrderItem = { ...structuredClone(it), id: uid(), qty: 1, status: "new", sentAt: undefined, addedBy: staff.name, updatedAt: now() };
        void mutate((o) => {
          const same = o.items.find((i) => sameLine(i, clone));
          if (same) same.qty += 1;
          else o.items.push(clone);
        });
      }
    },
    onDecrement: (it: OrderItem) => {
      if (it.status === "new")
        void mutate((o) => {
          const x = o.items.find((i) => i.id === it.id);
          if (x && x.qty > 1) {
            x.qty -= 1;
            x.updatedAt = now();
          }
        });
      else void actions.voidItem(order, it, 1);
    },
    onRemove: (it: OrderItem) => {
      if (it.status === "new") void mutate((o) => void (o.items = o.items.filter((i) => i.id !== it.id)), saved ? "Item removed" : undefined, `${it.qty}× ${it.name}`);
      else void actions.voidItem(order, it, it.qty);
    },
    onEdit: (it: OrderItem) => {
      const mi = items?.find((m) => m.id === it.menuItemId);
      if (!mi) {
        toast.info("This item is no longer on the menu");
        return;
      }
      setEditing({ menuItem: mi, item: it });
    },
  };

  // ------------------------------------------------------------ actions
  const totals = computeTotals(order);
  const unsent = order.items.filter((i) => i.status === "new" && !i.voided).reduce((s, i) => s + i.qty, 0);
  const table = tables?.find((t) => t.id === order.tableId);
  const nothingSentYet = !order.items.some((i) => i.status !== "new");

  async function checkProblems(): Promise<boolean> {
    const p = orderProblem(order);
    if (p) {
      toast.warning(p.message);
      if (p.fix) setDialog(p.fix);
      return false;
    }
    if (nothingSentYet) {
      const dup = await findPossibleDuplicate(order);
      if (dup) {
        const res = await confirm({
          title: "Possible duplicate order",
          message: (
            <>
              Order <b>#{dup.number}</b> with exactly the same items was placed a moment ago{dup.tableId ? " on the same table" : ""}. Continue anyway?
            </>
          ),
          confirmLabel: "Yes, it's a new order",
          cancelLabel: "Go back",
          tone: "warning",
        });
        if (!res.ok) return false;
      }
    }
    return true;
  }

  const send = () =>
    run(async () => {
      if (!saved || !unsent) return;
      if (!(await checkProblems())) return;
      const n = await sendToKitchen(order.id, staff.name);
      toast.success(`Sent ${n} item${n === 1 ? "" : "s"} to the kitchen`);
      setCartOpen(false);
    });

  const pay = () =>
    run(async () => {
      if (!saved) return;
      if (!(await checkProblems())) return;
      setCartOpen(false);
      go("checkout");
    });

  async function setType(t: OrderType) {
    if (locked || t === order.type) return;
    await mutate((o) => {
      o.type = t;
      o.deliveryFee = t === "delivery" ? settings.deliveryFee : 0;
      if (t !== "dine_in") {
        o.tableId = undefined;
        o.guests = undefined;
      }
    }, saved ? "Order type changed" : undefined, ORDER_TYPE_LABEL[t]);
    lastType.current = t;
    if (t === "dine_in" && !order.tableId) setDialog("table");
    if (t === "delivery" && !order.customer.address) setDialog("customer");
  }

  const otherOpen = (openOrders ?? []).filter((o) => o.id !== order.id).length;

  // ------------------------------------------------------------ render
  const cart = (
    <div className="glass flex h-full flex-col">
      {/* Cart header */}
      <div className="space-y-3 p-3 pb-4 sm:p-4">
        <div className="flex items-center gap-2">
          <button className="flex size-10 items-center justify-center rounded-xl hover:bg-surface-3 lg:hidden" onClick={() => setCartOpen(false)} aria-label="Close order">
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="display text-lg font-semibold leading-tight">{order.number ? `#${order.number}` : "New order"}</p>
            <p className="text-xs text-muted">
              {saved ? `Started by ${order.createdBy}` : "Add items to start"}
              {order.status === "closed" && " · Paid"}
            </p>
          </div>
          {order.status === "closed" && <Badge tone="green">Paid</Badge>}
          {order.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
          <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => startNewOrder({ type: order.type })} disabled={!saved && !order.items.length && !order.tableId}>
            New
          </Button>
        </div>
        <Segmented
          value={order.type}
          onChange={setType}
          options={[
            { value: "dine_in", label: "Dine-in", icon: <UtensilsCrossed className="size-4" />, disabled: locked },
            { value: "takeaway", label: "Takeaway", icon: <ShoppingBag className="size-4" />, disabled: locked },
            { value: "delivery", label: "Delivery", icon: <Bike className="size-4" />, disabled: locked },
          ]}
        />
        {order.type === "dine_in" && (
          <ContextButton
            icon={<UtensilsCrossed className="size-4" />}
            warn={!order.tableId}
            onClick={() => !locked && setDialog("table")}
            label={table ? `Table ${table.name}` : "Choose table"}
            sub={table ? `${order.guests ?? 1} guest${(order.guests ?? 1) > 1 ? "s" : ""} · ${table.area}` : "Required for dine-in"}
          />
        )}
        {order.type === "takeaway" && (
          <ContextButton icon={<User className="size-4" />} onClick={() => !locked && setDialog("customer")} label={order.customer.name || "Add customer name"} sub={order.customer.phone || "Optional — for calling out the order"} />
        )}
        {order.type === "delivery" && (
          <ContextButton
            icon={<MapPin className="size-4" />}
            warn={!order.customer.address}
            onClick={() => !locked && setDialog("customer")}
            label={order.customer.name ? `${order.customer.name} · ${order.customer.phone}` : "Add delivery details"}
            sub={order.customer.address || "Name, phone and address required"}
          />
        )}
      </div>

      <div className="stub-perf" aria-hidden />
      {/* Lines */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4">
        {locked && (
          <div className="mt-3 flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <Lock className="mt-0.5 size-5 shrink-0 text-muted" />
            <div className="flex-1 text-sm">
              <p className="font-semibold">{order.status === "cancelled" ? "This order was cancelled" : "This order is paid and closed"}</p>
              <p className="text-muted">{order.status === "cancelled" ? `${order.cancelled?.reason ?? ""} · ${order.cancelled?.by ?? ""}` : "Unlock with manager approval to add or change items."}</p>
              {order.status === "closed" && (
                <Button size="sm" variant="outline" className="mt-2" onClick={async () => (await actions.unlockClosed(order)) && setUnlocked(order.id)}>
                  Unlock to edit
                </Button>
              )}
            </div>
          </div>
        )}
        {order.items.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="size-7" />} title="No items yet">
            Tap items on the menu to add them to this order.
          </EmptyState>
        ) : (
          <OrderLines order={order} readOnly={locked} highlightId={flashId} {...lineHandlers} />
        )}
        {order.note && (
          <button onClick={() => setDialog("note")} className="mb-3 mt-1 flex w-full items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <StickyNote className="mt-0.5 size-4 shrink-0" /> {order.note}
          </button>
        )}
      </div>

      {/* Totals & actions */}
      <div className="border-t border-line bg-surface-2/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        <dl className="mb-3 space-y-1 text-sm">
          <TotalRow label="Subtotal" value={money(totals.subtotal)} />
          {totals.discount > 0 && <TotalRow label={`Discount${order.discount?.type === "percent" ? ` (${order.discount.value}%)` : ""}`} value={`−${money(totals.discount)}`} accent />}
          {totals.serviceCharge > 0 && <TotalRow label={`Service ${order.serviceChargeRate}%`} value={money(totals.serviceCharge)} />}
          {totals.deliveryFee > 0 && <TotalRow label="Delivery fee" value={money(totals.deliveryFee)} />}
          <TotalRow label={order.taxInclusive ? `Tax incl. ${order.taxRate}%` : `Tax ${order.taxRate}%`} value={money(totals.tax)} />
          <div className="flex items-baseline justify-between pt-1">
            <dt className="text-base font-bold">Total</dt>
            <dd key={totals.total} className="display anim-bump text-[1.7rem] font-semibold text-brand-ink">{money(totals.total)}</dd>
          </div>
        </dl>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="px-3.5" onClick={() => setDialog("more")} aria-label="More actions" disabled={!saved}>
            <MoreHorizontal className="size-5" />
          </Button>
          <Button variant="secondary" size="lg" className="flex-1" icon={<ChefHat className="size-5" />} disabled={!saved || !unsent || locked} loading={busy} onClick={send}>
            Send{unsent ? ` (${unsent})` : ""}
          </Button>
          <Button variant="primary" size="lg" className="flex-[1.3]" icon={<CreditCard className="size-5" />} disabled={!saved || !totals.itemCount} onClick={pay}>
            {order.status === "closed" ? "Payment" : "Pay"}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Menu */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3 px-3 pb-2 pt-3 sm:px-5 sm:pt-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search menu"
                className="glass h-12 w-full rounded-2xl border border-line pl-11 pr-10 text-[15px] outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--ring)]"
              />
              {q && (
                <button onClick={() => setQ("")} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-surface-3" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button variant="outline" onClick={() => go("orders")} icon={<ClipboardList className="size-4" />} className="shrink-0">
              <span className="hidden sm:inline">Open orders</span>
              {otherOpen > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-on-brand">{otherOpen}</span>}
            </Button>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 sm:-mx-4 sm:px-4">
            <CategoryChip active={cat === "all" && !q} onClick={() => { setCat("all"); setQ(""); }} label="All" icon={UtensilsCrossed} />
            {(categories ?? []).map((c) => (
              <CategoryChip key={c.id} active={cat === c.id && !q} color={c.color} icon={categoryIcon(c.name)} onClick={() => { setCat(c.id); setQ(""); }} label={c.name} />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-2 sm:px-5 lg:pb-5">
          {visible.length === 0 ? (
            <EmptyState icon={<Search className="size-7" />} title={items?.length ? "No matching items" : "Your menu is empty"}>
              {items?.length ? "Try a different search or category." : "Add categories and items in the Menu section."}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visible.map((mi) => {
                const n = qtyInCart.get(mi.id);
                const c = catById.get(mi.categoryId);
                const tint = c?.color ?? "#8a6a4a";
                const Icon = categoryIcon(c?.name);
                const pop = popped?.id === mi.id;
                return (
                  <button
                    key={mi.id + (pop ? ":" + popped.n : "")}
                    onClick={() => tapItem(mi)}
                    style={{
                      backgroundImage: `linear-gradient(150deg, color-mix(in oklab, ${tint} 30%, transparent) 0%, transparent 62%)`,
                    }}
                    className={cx(
                      "group relative flex min-h-[118px] flex-col justify-between overflow-hidden rounded-[1.25rem] border bg-surface p-3.5 text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-pop",
                      n ? "border-brand/60" : "border-line hover:border-line-strong",
                      pop && "anim-tile",
                      !mi.available && "opacity-50 saturate-50",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className="pointer-events-none absolute -bottom-3 -right-3 size-20 opacity-[0.13] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                      style={{ color: tint }}
                      strokeWidth={1.5}
                    />
                    {pop && <span className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/30" style={{ animation: "ripple .55s ease-out forwards" }} />}
                    <span className="relative line-clamp-2 pr-6 text-[15px] font-semibold leading-snug">{mi.name}</span>
                    <span className="relative mt-3 flex items-end justify-between gap-1">
                      <span className="display text-[15px] font-semibold text-ink">{money(mi.price)}</span>
                      {!mi.available ? (
                        <Badge tone="red">Sold out</Badge>
                      ) : mi.modifierGroupIds.length ? (
                        <span className="truncate text-right text-[11px] font-semibold text-muted">
                          {mi.modifierGroupIds
                            .slice(0, 2)
                            .map((id) => groupName.get(id))
                            .filter(Boolean)
                            .join(" · ")}
                          {mi.modifierGroupIds.length > 2 ? " +" : ""}
                        </span>
                      ) : null}
                    </span>
                    {n ? (
                      <span key={n} className="anim-bump absolute right-2.5 top-2.5 flex min-w-6 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-xs font-bold text-on-brand shadow-glow">{n}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Mobile: floating order summary */}
        <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 lg:hidden">
          <button
            onClick={() => setCartOpen(true)}
            className="flex h-15 w-full items-center gap-3 rounded-2xl bg-brand px-4 text-on-brand shadow-glow active:scale-[0.99]"
          >
            <span key={totals.itemCount} className="anim-bump flex size-9 items-center justify-center rounded-xl bg-black/10 text-sm font-bold tabular">{totals.itemCount}</span>
            <span className="flex-1 text-left font-semibold">{order.number ? `Review #${order.number}` : "Review order"}</span>
            <span className="display text-lg font-semibold">{money(totals.total)}</span>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </section>

      {/* Cart: side panel on large screens, full-screen sheet on phones/tablets */}
      <aside className="hidden w-[390px] shrink-0 border-l border-line lg:block xl:w-[430px]">{cart}</aside>
      {cartOpen && <div className="anim-sheet fixed inset-0 z-40 lg:hidden">{cart}</div>}

      {/* Dialogs */}
      <ItemModal
        open={!!editing}
        onClose={() => setEditing(null)}
        menuItem={editing?.menuItem ?? null}
        groups={groups ?? []}
        initial={editing?.item}
        locked={!!editing?.item && editing.item.status !== "new"}
        onSave={(c) => {
          if (!editing) return;
          if (editing.item) {
            const id = editing.item.id;
            void mutate((o) => {
              const x = o.items.find((i) => i.id === id);
              if (!x) return;
              x.modifiers = c.modifiers;
              x.qty = c.qty;
              x.notes = c.notes;
              x.updatedAt = now();
            });
          } else addItem(editing.menuItem, c);
        }}
      />
      <TablePickerModal
        open={dialog === "table"}
        onClose={() => setDialog(null)}
        currentOrderId={saved ? order.id : undefined}
        selectedId={order.tableId}
        guests={order.guests}
        onPick={(tableId, guests) => void mutate((o) => {
          o.type = "dine_in";
          o.tableId = tableId;
          o.guests = guests;
        }, saved ? "Table set" : undefined, tables?.find((t) => t.id === tableId)?.name)}
        onOpenExisting={(id) => setActiveOrderId(id)}
      />
      <CustomerModal
        open={dialog === "customer"}
        onClose={() => setDialog(null)}
        initial={order.customer}
        requireAddress={order.type === "delivery"}
        title={order.type === "delivery" ? "Delivery details" : "Customer"}
        onSave={(c) => void mutate((o) => void (o.customer = c), saved ? "Customer details updated" : undefined)}
      />
      {saved && <DiscountModal order={order} open={dialog === "discount"} onClose={() => setDialog(null)} />}
      <NoteModal open={dialog === "note"} onClose={() => setDialog(null)} initial={order.note} onSave={(v) => void mutate((o) => void (o.note = v), saved ? "Order note updated" : undefined)} />
      <Modal open={dialog === "more"} onClose={() => setDialog(null)} title={`Order #${order.number}`} size="sm">
        <div className="grid gap-1.5">
          <MoreItem icon={Percent} label={order.discount ? "Change discount" : "Add discount"} disabled={locked} onClick={() => setDialog("discount")} />
          <MoreItem icon={StickyNote} label={order.note ? "Edit order note" : "Add order note"} disabled={locked} onClick={() => setDialog("note")} />
          <MoreItem icon={User} label="Customer details" disabled={locked} onClick={() => setDialog("customer")} />
          <MoreItem icon={FileText} label="Print guest check (bill)" onClick={() => { setDialog(null); void actions.printBill(order); }} />
          <MoreItem icon={Printer} label="Print kitchen ticket" onClick={() => { setDialog(null); void actions.printKitchen(order, activeItems(order)); }} />
          <MoreItem icon={Plus} label="Hold & start new order" onClick={() => { setDialog(null); toast.info(`Order #${order.number} held — find it under Orders`); startNewOrder(); }} />
          <MoreItem
            icon={XCircle}
            label="Cancel order"
            danger
            disabled={order.status !== "open"}
            onClick={async () => {
              setDialog(null);
              if (await actions.cancelOrder(order)) startNewOrder();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

function ContextButton({ icon, label, sub, onClick, warn }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void; warn?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:bg-surface-2",
        warn ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5" : "border-line",
      )}
    >
      <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", warn ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-surface-3 text-ink-2")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      <ChevronRight className="size-4 text-muted" />
    </button>
  );
}

function CategoryChip({ label, active, onClick, color, icon: Icon }: { label: string; active: boolean; onClick: () => void; color?: string; icon: typeof Plus }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 text-sm font-semibold transition",
        active ? "border-brand bg-brand text-on-brand shadow-glow" : "glass border-line text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      <Icon className="size-4" style={!active && color ? { color } : undefined} />
      {label}
    </button>
  );
}

function TotalRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between text-muted">
      <dt>{label}</dt>
      <dd className={cx("tabular", accent ? "font-semibold text-emerald-600" : "text-ink-2")}>{value}</dd>
    </div>
  );
}

function MoreItem({ icon: Icon, label, onClick, danger, disabled }: { icon: typeof Trash2; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx("flex h-13 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold transition hover:bg-surface-3 disabled:opacity-40", danger && "text-rose-600")}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}
