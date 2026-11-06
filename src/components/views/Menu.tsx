"use client";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Layers,
  ListPlus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { save, softDelete } from "@/client/repo";
import { useCategories, useMenuItems, useModifierGroups } from "@/client/hooks";
import { useSession } from "@/client/session";
import { centsToInput, formatMoney, parseMoney, uid } from "@/lib/format";
import type { Category, ID, MenuItem, ModifierGroup, ModifierOption } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ColHead,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Spinner,
  Textarea,
  Toggle,
  cx,
  useBusy,
  useConfirm,
  useToast,
} from "../ui";

type Tab = "items" | "categories" | "modifiers";
type Errors = Record<string, string | undefined>;

const SWATCHES = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
];

const UNCATEGORIZED_COLOR = "#9ca3af";

function useMoney() {
  const { settings } = useSession();
  return (cents: number) => formatMoney(cents, settings.currency, settings.locale);
}

function ruleText(g: Pick<ModifierGroup, "min" | "max">): string {
  if (g.min > 0) return `Required · choose ${g.min === g.max ? g.min : `${g.min}–${g.max}`}`;
  return g.max === 1 ? "Optional · choose 1" : `Optional · up to ${g.max}`;
}

function hasErrors(e: Errors) {
  return Object.values(e).some(Boolean);
}

function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

// ====================================================================== View

export function MenuView() {
  const [tab, setTab] = useState<Tab>("items");
  const [categoryFilter, setCategoryFilter] = useState<ID | "all">("all");
  const items = useMenuItems();
  const categories = useCategories();
  const groups = useModifierGroups();

  const loading = !items || !categories || !groups;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-bold tracking-[-0.01em] text-ink sm:text-[22px]">Menu</h1>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            className="w-full sm:w-auto sm:min-w-[24rem]"
            options={[
              { value: "items", label: "Items", icon: <UtensilsCrossed className="size-4" /> },
              { value: "categories", label: "Categories", icon: <Tags className="size-4" /> },
              { value: "modifiers", label: "Modifiers", icon: <SlidersHorizontal className="size-4" /> },
            ]}
          />
        </div>
      </header>
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-7" />
        </div>
      ) : tab === "items" ? (
        <ItemsTab
          items={items}
          categories={categories}
          groups={groups}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
        />
      ) : tab === "categories" ? (
        <CategoriesTab
          items={items}
          categories={categories}
          onShowItems={(id) => {
            setCategoryFilter(id);
            setTab("items");
          }}
        />
      ) : (
        <ModifiersTab items={items} groups={groups} />
      )}
    </div>
  );
}

// ====================================================================== Items

function ItemsTab({
  items,
  categories,
  groups,
  categoryFilter,
  setCategoryFilter,
}: {
  items: MenuItem[];
  categories: Category[];
  groups: ModifierGroup[];
  categoryFilter: ID | "all";
  setCategoryFilter: (id: ID | "all") => void;
}) {
  const money = useMoney();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ item?: MenuItem } | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const filter = categoryFilter !== "all" && !catById.has(categoryFilter) ? "all" : categoryFilter;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === "all" || i.categoryId === filter) &&
        (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
    );
  }, [items, filter, query]);

  const soldOut = items.filter((i) => !i.available).length;

  async function setAvailable(item: MenuItem, available: boolean) {
    try {
      await save("menuItems", { ...item, available });
      if (!available) toast.info(`${item.name} marked sold out`);
    } catch {
      toast.error("Couldn't update availability");
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {categories.length > 0 && (
          <nav
            aria-label="Filter by category"
            className="shrink-0 border-b border-line bg-surface lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          >
            <ColHead className="hidden px-5 pb-1 pt-4 lg:block">Categories</ColHead>
            <div className="flex gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-2.5 lg:py-1.5">
              <Chip active={filter === "all"} onClick={() => setCategoryFilter("all")}>
                <span className="flex-1 text-left">All</span> <span className="tabular text-muted">{items.length}</span>
              </Chip>
              {categories.map((c) => (
                <Chip key={c.id} active={filter === c.id} onClick={() => setCategoryFilter(c.id)}>
                  <Dot color={c.color} />
                  <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                  <span className="tabular text-muted">{items.filter((i) => i.categoryId === c.id).length}</span>
                </Chip>
              ))}
            </div>
          </nav>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-4 sm:px-5">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  type="search"
                  placeholder="Search items"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  aria-label="Search items"
                />
              </div>
              <Button
                variant="primary"
                icon={<Plus className="size-5" />}
                onClick={() => setEditing({})}
                disabled={categories.length === 0}
                title={categories.length === 0 ? "Create a category first" : undefined}
              >
                <span className="hidden sm:inline">Add item</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="mx-auto w-full max-w-5xl">
              {soldOut > 0 && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <Badge tone="red">{soldOut} sold out</Badge> <span>Flip the switch to bring items back.</span>
                </p>
              )}
              {categories.length === 0 ? (
                <Card>
                  <EmptyState icon={<Tags className="size-6" />} title="No categories yet">
                    Create at least one category in the Categories tab, then add items to it.
                  </EmptyState>
                </Card>
              ) : items.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<UtensilsCrossed className="size-6" />}
                    title="No menu items yet"
                    action={
                      <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing({})}>
                        Add item
                      </Button>
                    }
                  >
                    Add the dishes and drinks you sell.
                  </EmptyState>
                </Card>
              ) : visible.length === 0 ? (
                <Card>
                  <EmptyState icon={<Search className="size-6" />} title="No matching items">
                    Try a different search or category.
                  </EmptyState>
                </Card>
              ) : (
                <Card>
                  <div className={cx(ITEM_GRID, "sticky top-0 z-[1] rounded-t-xl border-b border-line bg-surface-2 py-2")}>
                    <ColHead>Item</ColHead>
                    <ColHead className="hidden md:block">Category</ColHead>
                    <ColHead className="hidden md:block">Modifiers</ColHead>
                    <ColHead className="text-right">Price</ColHead>
                    <ColHead className="text-right">Avail.</ColHead>
                  </div>
                  <ul className="divide-y divide-line">
                    {visible.map((item) => {
                      const cat = catById.get(item.categoryId);
                      const mods = item.modifierGroupIds.map((id) => groupById.get(id)).filter((g): g is ModifierGroup => !!g);
                      return (
                        <li
                          key={item.id}
                          className={cx(ITEM_GRID, "min-h-14 transition-colors last:rounded-b-xl hover:bg-surface-2", !item.available && "bg-surface-2/60")}
                        >
                          <button
                            type="button"
                            onClick={() => setEditing({ item })}
                            className="group flex min-h-14 min-w-0 flex-col justify-center py-2 text-left"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={cx("truncate text-[15px] font-semibold group-hover:underline", item.available ? "text-ink" : "text-muted")}>
                                {item.name}
                              </span>
                              {!item.available && <Badge tone="red">Sold out</Badge>}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted md:hidden">
                              <Dot color={cat?.color ?? UNCATEGORIZED_COLOR} className="size-2" />
                              <span className="truncate">{cat?.name ?? "Uncategorized"}</span>
                              {mods.length > 0 && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="inline-flex shrink-0 items-center gap-1">
                                    <Layers className="size-3.5" />
                                    {mods.length} modifier{mods.length === 1 ? "" : "s"}
                                  </span>
                                </>
                              )}
                            </span>
                          </button>
                          <span className="hidden min-w-0 items-center gap-2 text-sm text-ink-2 md:flex">
                            <Dot color={cat?.color ?? UNCATEGORIZED_COLOR} />
                            <span className="truncate">{cat?.name ?? "Uncategorized"}</span>
                          </span>
                          <span className="hidden min-w-0 flex-wrap items-center gap-1 py-2 md:flex">
                            {mods.length === 0 ? (
                              <span className="text-sm text-muted">—</span>
                            ) : (
                              <>
                                {mods.slice(0, 3).map((g) => (
                                  <Badge key={g.id} tone="gray" className="max-w-[9rem]">
                                    <span className="truncate">{g.name}</span>
                                  </Badge>
                                ))}
                                {mods.length > 3 && <Badge tone="gray">+{mods.length - 3}</Badge>}
                              </>
                            )}
                          </span>
                          <span
                            className={cx(
                              "tabular text-right text-[15px] font-semibold",
                              item.available ? "text-ink" : "text-muted line-through decoration-bad",
                            )}
                          >
                            {money(item.price)}
                          </span>
                          <div className="flex justify-end">
                            <div className="w-12">
                              <Toggle
                                checked={item.available}
                                onChange={(v) => void setAvailable(item, v)}
                                label={<span className="sr-only">{item.available ? `${item.name}: Available` : `${item.name}: Sold out`}</span>}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <ItemEditor
          item={editing.item}
          items={items}
          categories={categories}
          groups={groups}
          defaultCategoryId={filter !== "all" ? filter : categories[0]?.id}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

const ITEM_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_4rem] items-center gap-x-3 pl-4 pr-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_6.5rem_4rem]";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors duration-150 lg:h-11 lg:w-full",
        "max-lg:border",
        active ? "bg-brand-soft text-brand-ink max-lg:border-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink max-lg:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

function ItemEditor({
  item,
  items,
  categories,
  groups,
  defaultCategoryId,
  onClose,
}: {
  item?: MenuItem;
  items: MenuItem[];
  categories: Category[];
  groups: ModifierGroup[];
  defaultCategoryId?: ID;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [run, busy] = useBusy();
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? centsToInput(item.price) : "");
  const [categoryId, setCategoryId] = useState<ID>(item?.categoryId ?? defaultCategoryId ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [available, setAvailable] = useState(item?.available ?? true);
  const [sort, setSort] = useState(String(item?.sort ?? Math.max(0, ...items.map((i) => i.sort)) + 1));
  const [groupIds, setGroupIds] = useState<ID[]>(item?.modifierGroupIds ?? []);
  const [errors, setErrors] = useState<Errors>({});

  const knownGroups = new Set(groups.map((g) => g.id));
  const categoryMissing = !!categoryId && !categories.some((c) => c.id === categoryId);

  function toggleGroup(id: ID) {
    setGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const cents = parseMoney(price);
    const sortNum = Number(sort.trim() === "" ? "0" : sort);
    const errs: Errors = {
      name: name.trim() ? undefined : "Name is required",
      price: price.trim() === "" ? "Price is required" : Number.isNaN(cents) ? "Enter a valid amount" : cents < 0 ? "Price can't be negative" : undefined,
      categoryId: !categoryId || categoryMissing ? "Choose a category" : undefined,
      sort: Number.isInteger(sortNum) ? undefined : "Use a whole number",
    };
    setErrors(errs);
    if (hasErrors(errs)) return;
    await run(async () => {
      const t = Date.now();
      const base: MenuItem = item ?? {
        id: uid(),
        createdAt: t,
        updatedAt: t,
        name: "",
        categoryId: "",
        price: 0,
        description: "",
        available: true,
        modifierGroupIds: [],
        sort: 0,
      };
      try {
        await save("menuItems", {
          ...base,
          name: name.trim(),
          price: cents,
          categoryId,
          description: description.trim(),
          available,
          sort: sortNum,
          // Keep chosen order; drop references to groups that no longer exist.
          modifierGroupIds: groupIds.filter((id) => knownGroups.has(id)),
        });
        toast.success(item ? `Saved ${name.trim()}` : `Added ${name.trim()}`);
        onClose();
      } catch {
        toast.error("Couldn't save the item");
      }
    });
  }

  async function remove() {
    if (!item) return;
    const { ok } = await confirm({
      title: `Delete ${item.name}?`,
      message: "It will be removed from the menu on all devices. Past orders keep their records.",
      confirmLabel: "Delete item",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await softDelete("menuItems", item.id);
      toast.success(`Deleted ${item.name}`);
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item ? "Edit item" : "New item"}
      subtitle={item?.name}
      footer={
        <>
          {item && (
            <Button variant="ghost" className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-4" />} onClick={() => void remove()} disabled={busy}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="menu-item-form" loading={busy} icon={<Check className="size-4" />}>
            Save
          </Button>
        </>
      }
    >
      <form id="menu-item-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!item} placeholder="e.g. Flat white" maxLength={80} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price" error={errors.price}>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Category" error={errors.categoryId}>
            <Select value={categoryMissing ? "" : categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description" hint="Optional — shown on the register.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <div className="rounded-xl border border-line px-3.5 py-2">
            <Toggle checked={available} onChange={setAvailable} label="Available" description={available ? "Can be ordered" : "Sold out (86'd)"} />
          </div>
          <Field label="Sort order" error={errors.sort} hint="Lower numbers appear first.">
            <Input value={sort} onChange={(e) => setSort(e.target.value)} inputMode="numeric" type="number" step={1} />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-2">Modifier groups</p>
          {groups.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">No modifier groups yet. Create them in the Modifiers tab.</p>
          ) : (
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {groups.map((g) => {
                const pos = groupIds.indexOf(g.id);
                const checked = pos >= 0;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleGroup(g.id)}
                    className={cx("flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left transition hover:bg-surface-2", checked && "bg-brand-soft")}
                  >
                    <span
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                        checked ? "border-brand bg-brand text-on-brand" : "border-line-strong bg-surface",
                      )}
                    >
                      {checked ? pos + 1 : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{g.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {ruleText(g)} · {g.options.length} option{g.options.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {groupIds.length > 1 && <p className="mt-1 text-xs text-muted">Numbers show the order groups are asked on the register.</p>}
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================== Categories

function CategoriesTab({
  items,
  categories,
  onShowItems,
}: {
  items: MenuItem[];
  categories: Category[];
  onShowItems: (id: ID) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [run, busy] = useBusy();
  const [editing, setEditing] = useState<{ category?: Category } | null>(null);

  const counts = useMemo(() => {
    const m = new Map<ID, number>();
    for (const i of items) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [items]);

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const order = [...categories];
    [order[index], order[target]] = [order[target], order[index]];
    await run(async () => {
      // Renumber so duplicate/gappy sort values get normalised; only save rows that changed.
      for (let i = 0; i < order.length; i++) {
        if (order[i].sort !== i) await save("categories", { ...order[i], sort: i });
      }
    });
  }

  async function remove(c: Category) {
    const n = counts.get(c.id) ?? 0;
    if (n > 0) {
      const { ok } = await confirm({
        title: `Can't delete ${c.name} yet`,
        message: (
          <>
            This category still has {n} item{n === 1 ? "" : "s"}. Move {n === 1 ? "it" : "them"} to another category (or delete{" "}
            {n === 1 ? "it" : "them"}) first, then try again.
          </>
        ),
        confirmLabel: "Show items",
        cancelLabel: "Close",
        tone: "primary",
      });
      if (ok) onShowItems(c.id);
      return;
    }
    const { ok } = await confirm({
      title: `Delete ${c.name}?`,
      message: "This category is empty and will be removed on all devices.",
      confirmLabel: "Delete category",
      tone: "danger",
    });
    if (!ok) return;
    await softDelete("categories", c.id);
    toast.success(`Deleted ${c.name}`);
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {categories.length} categor{categories.length === 1 ? "y" : "ies"} · order matches the register
            </p>
            <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing({})}>
              <span className="hidden sm:inline">Add category</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
          {categories.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Tags className="size-6" />}
                title="No categories yet"
                action={
                  <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing({})}>
                    Add category
                  </Button>
                }
              >
                Categories group your menu on the register, e.g. Coffee, Breakfast, Desserts.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2">
                <ColHead className="w-6 text-right">#</ColHead>
                <ColHead className="flex-1">Category</ColHead>
                <ColHead className="hidden w-20 text-right sm:block">Items</ColHead>
                <span aria-hidden className="hidden w-4 sm:block" />
                <ColHead className="w-[8.5rem] text-right">Order</ColHead>
              </div>
              <ul className="divide-y divide-line">
              {categories.map((c, i) => {
                const n = counts.get(c.id) ?? 0;
                return (
                  <li key={c.id} className="flex min-h-14 items-center gap-1 pl-4 pr-2 transition-colors hover:bg-surface-2">
                    <span className="tabular w-6 shrink-0 text-right text-sm text-muted">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => setEditing({ category: c })}
                      className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 px-2 text-left"
                    >
                      <span className="size-3 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: c.color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink group-hover:underline">{c.name}</span>
                        <span className="block text-[13px] text-muted sm:hidden">
                          {n} item{n === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="tabular hidden w-20 shrink-0 text-right text-sm text-ink-2 sm:block">
                        {n} item{n === 1 ? "" : "s"}
                      </span>
                      <Pencil className="hidden size-4 shrink-0 text-muted sm:block" />
                    </button>
                    <IconButton label="Move up" className="size-11" disabled={i === 0 || busy} onClick={() => void move(i, -1)}>
                      <ArrowUp className="size-5" />
                    </IconButton>
                    <IconButton
                      label="Move down"
                      className="size-11"
                      disabled={i === categories.length - 1 || busy}
                      onClick={() => void move(i, 1)}
                    >
                      <ArrowDown className="size-5" />
                    </IconButton>
                    <IconButton label={`Delete ${c.name}`} className="size-11 hover:bg-bad-soft hover:text-bad" onClick={() => void remove(c)}>
                      <Trash2 className="size-5" />
                    </IconButton>
                  </li>
                );
              })}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {editing && (
        <CategoryEditor
          category={editing.category}
          nextSort={categories.length ? Math.max(...categories.map((c) => c.sort)) + 1 : 0}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CategoryEditor({ category, nextSort, onClose }: { category?: Category; nextSort: number; onClose: () => void }) {
  const toast = useToast();
  const [run, busy] = useBusy();
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? SWATCHES[(nextSort * 3) % SWATCHES.length]);
  const [error, setError] = useState<string>();

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    await run(async () => {
      const t = Date.now();
      const base: Category = category ?? { id: uid(), createdAt: t, updatedAt: t, name: "", color, sort: nextSort };
      try {
        await save("categories", { ...base, name: name.trim(), color });
        toast.success(category ? `Saved ${name.trim()}` : `Added ${name.trim()}`);
        onClose();
      } catch {
        toast.error("Couldn't save the category");
      }
    });
  }

  const isPreset = SWATCHES.includes(color.toLowerCase());

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={category ? "Edit category" : "New category"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="menu-category-form" loading={busy} icon={<Check className="size-4" />}>
            Save
          </Button>
        </>
      }
    >
      <form id="menu-category-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label="Name" error={error}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            autoFocus={!category}
            placeholder="e.g. Coffee"
            maxLength={40}
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-2">Color</p>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Color ${s}`}
                aria-pressed={color.toLowerCase() === s}
                onClick={() => setColor(s)}
                className={cx(
                  "flex size-11 items-center justify-center rounded-lg transition active:scale-95",
                  color.toLowerCase() === s && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                )}
                style={{ background: s }}
              >
                {color.toLowerCase() === s && <Check className="size-5 text-white drop-shadow" />}
              </button>
            ))}
            <label
              className={cx(
                "relative flex size-11 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong",
                !isPreset && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
              )}
              style={!isPreset ? { background: color } : undefined}
              title="Custom color"
            >
              {isPreset && <Plus className="size-5 text-muted" />}
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#000000"}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="Custom color"
              />
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
          <Dot color={color} className="size-3" />
          <span className="truncate text-[15px] font-semibold text-ink">{name.trim() || "Preview"}</span>
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================== Modifiers

function ModifiersTab({ items, groups }: { items: MenuItem[]; groups: ModifierGroup[] }) {
  const money = useMoney();
  const [editing, setEditing] = useState<{ group?: ModifierGroup } | null>(null);

  const usage = useMemo(() => {
    const m = new Map<ID, MenuItem[]>();
    for (const i of items) for (const g of i.modifierGroupIds) m.set(g, [...(m.get(g) ?? []), i]);
    return m;
  }, [items]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Options like sizes, milks or extras that items can offer.</p>
            <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing({})} className="shrink-0">
              <span className="hidden sm:inline">Add group</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
          {groups.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SlidersHorizontal className="size-6" />}
                title="No modifier groups yet"
                action={
                  <Button variant="primary" icon={<Plus className="size-5" />} onClick={() => setEditing({})}>
                    Add group
                  </Button>
                }
              >
                Create groups such as “Size” or “Extra shots”, then attach them to items.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className={cx(GROUP_GRID, "border-b border-line bg-surface-2 py-2")}>
                <ColHead>Group</ColHead>
                <ColHead className="hidden md:block">Rule</ColHead>
                <ColHead className="hidden md:block">Options</ColHead>
                <ColHead className="text-right">Used by</ColHead>
                <span aria-hidden />
              </div>
              <ul className="divide-y divide-line">
                {groups.map((g) => {
                  const used = usage.get(g.id)?.length ?? 0;
                  const optionText =
                    g.options.map((o) => (o.price ? `${o.name} (${o.price > 0 ? "+" : ""}${money(o.price)})` : o.name)).join(", ") || "No options";
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => setEditing({ group: g })}
                        className={cx(GROUP_GRID, "group min-h-14 w-full py-2.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-3")}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold text-ink group-hover:underline">{g.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden">
                            <Badge tone={g.min > 0 ? "amber" : "gray"}>{ruleText(g)}</Badge>
                          </span>
                          <span className="mt-1 block truncate text-[13px] text-muted md:hidden">{optionText}</span>
                        </span>
                        <span className="hidden md:block">
                          <Badge tone={g.min > 0 ? "amber" : "gray"}>{ruleText(g)}</Badge>
                        </span>
                        <span className="hidden min-w-0 text-sm text-ink-2 md:line-clamp-2">{optionText}</span>
                        <span className="text-right">
                          <Badge tone={used ? "brand" : "gray"}>
                            {used} item{used === 1 ? "" : "s"}
                          </Badge>
                        </span>
                        <ChevronRight className="size-4 text-muted" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {editing && (
        <GroupEditor group={editing.group} items={items} usedBy={editing.group ? (usage.get(editing.group.id) ?? []) : []} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

const GROUP_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 px-4 md:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,2fr)_6rem_1rem]";

interface OptionRow {
  id: ID;
  name: string;
  price: string;
}

function GroupEditor({
  group,
  items,
  usedBy,
  onClose,
}: {
  group?: ModifierGroup;
  items: MenuItem[];
  usedBy: MenuItem[];
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [run, busy] = useBusy();
  const [name, setName] = useState(group?.name ?? "");
  const [min, setMin] = useState(String(group?.min ?? 0));
  const [max, setMax] = useState(String(group?.max ?? 1));
  const [rows, setRows] = useState<OptionRow[]>(
    group?.options.length
      ? group.options.map((o) => ({ id: o.id, name: o.name, price: o.price ? centsToInput(o.price) : "" }))
      : [{ id: uid(), name: "", price: "" }],
  );
  const [errors, setErrors] = useState<Errors>({});

  function updateRow(id: ID, patch: Partial<OptionRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const filled = rows.filter((r) => r.name.trim() || r.price.trim());
    const minN = Number(min);
    const maxN = Number(max);
    const errs: Errors = {
      name: name.trim() ? undefined : "Name is required",
      min: min.trim() === "" || !Number.isInteger(minN) || minN < 0 ? "Use 0 or more" : undefined,
      max:
        max.trim() === "" || !Number.isInteger(maxN) || maxN < 1
          ? "Use 1 or more"
          : Number.isInteger(minN) && maxN < minN
            ? "Max must be at least min"
            : filled.length > 0 && maxN > filled.length
              ? `Only ${filled.length} option${filled.length === 1 ? "" : "s"} to choose from`
              : undefined,
      options: filled.length === 0 ? "Add at least one option" : undefined,
    };
    const options: ModifierOption[] = [];
    for (const r of filled) {
      if (!r.name.trim()) errs[`opt-name-${r.id}`] = "Name required";
      const cents = r.price.trim() === "" ? 0 : parseMoney(r.price);
      if (Number.isNaN(cents)) errs[`opt-price-${r.id}`] = "Invalid";
      options.push({ id: r.id, name: r.name.trim(), price: Number.isNaN(cents) ? 0 : cents });
    }
    setErrors(errs);
    if (hasErrors(errs)) return;
    await run(async () => {
      const t = Date.now();
      const base: ModifierGroup = group ?? { id: uid(), createdAt: t, updatedAt: t, name: "", min: 0, max: 1, options: [] };
      try {
        await save("modifierGroups", { ...base, name: name.trim(), min: minN, max: maxN, options });
        toast.success(group ? `Saved ${name.trim()}` : `Added ${name.trim()}`);
        onClose();
      } catch {
        toast.error("Couldn't save the modifier group");
      }
    });
  }

  async function remove() {
    if (!group) return;
    const n = usedBy.length;
    const { ok } = await confirm({
      title: `Delete ${group.name}?`,
      message:
        n > 0
          ? `It will be detached from ${n} item${n === 1 ? "" : "s"} and removed on all devices.`
          : "It will be removed on all devices.",
      confirmLabel: "Delete group",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      try {
        for (const it of items) {
          if (it.modifierGroupIds.includes(group.id)) {
            await save("menuItems", { ...it, modifierGroupIds: it.modifierGroupIds.filter((id) => id !== group.id) });
          }
        }
        await softDelete("modifierGroups", group.id);
        toast.success(`Deleted ${group.name}`);
        onClose();
      } catch {
        toast.error("Couldn't delete the modifier group");
      }
    });
  }

  const minN = Number(min);
  const maxN = Number(max);
  const preview = Number.isInteger(minN) && Number.isInteger(maxN) && maxN >= 1 && minN >= 0 ? ruleText({ min: minN, max: maxN }) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={group ? "Edit modifier group" : "New modifier group"}
      subtitle={group?.name}
      footer={
        <>
          {group && (
            <Button variant="ghost" className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-4" />} onClick={() => void remove()} disabled={busy}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="menu-group-form" loading={busy} icon={<Check className="size-4" />}>
            Save
          </Button>
        </>
      }
    >
      <form id="menu-group-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!group} placeholder="e.g. Milk" maxLength={60} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min choices" error={errors.min} hint="0 = optional">
            <Input type="number" inputMode="numeric" min={0} step={1} value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Max choices" error={errors.max} hint="1 = single choice">
            <Input type="number" inputMode="numeric" min={1} step={1} value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>
        {preview && (
          <p className="-mt-1 text-sm text-muted">
            Guests will see: <span className="font-semibold text-ink-2">{preview}</span>
          </p>
        )}

        <div>
          <div className="mb-1.5 flex items-end justify-between gap-2">
            <p className="text-sm font-semibold text-ink-2">Options</p>
            <p className="text-xs text-muted">Price is added to the item (can be 0)</p>
          </div>
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={r.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={r.name}
                    onChange={(e) => updateRow(r.id, { name: e.target.value })}
                    placeholder={`Option ${idx + 1}`}
                    aria-label={`Option ${idx + 1} name`}
                    maxLength={60}
                    className={cx(errors[`opt-name-${r.id}`] && "border-bad")}
                  />
                  {errors[`opt-name-${r.id}`] && <span className="mt-1 block text-xs font-medium text-bad">{errors[`opt-name-${r.id}`]}</span>}
                </div>
                <div className="w-24 shrink-0 sm:w-32">
                  <Input
                    value={r.price}
                    onChange={(e) => updateRow(r.id, { price: e.target.value })}
                    placeholder="+0.00"
                    inputMode="decimal"
                    aria-label={`Option ${idx + 1} price`}
                    className={cx("text-right tabular-nums", errors[`opt-price-${r.id}`] && "border-bad")}
                  />
                  {errors[`opt-price-${r.id}`] && <span className="mt-1 block text-right text-xs font-medium text-bad">{errors[`opt-price-${r.id}`]}</span>}
                </div>
                <IconButton
                  label={`Remove option ${idx + 1}`}
                  className="size-11 hover:bg-bad-soft hover:text-bad"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                >
                  <X className="size-5" />
                </IconButton>
              </div>
            ))}
          </div>
          {errors.options && <p className="mt-1 text-sm font-medium text-bad">{errors.options}</p>}
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            icon={<ListPlus className="size-4" />}
            onClick={() => setRows((rs) => [...rs, { id: uid(), name: "", price: "" }])}
          >
            Add option
          </Button>
        </div>

        {group && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-2">Used by</p>
            {usedBy.length === 0 ? (
              <p className="text-sm text-muted">Not attached to any items yet. Attach it from an item&apos;s edit screen.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {usedBy.map((i) => (
                  <Badge key={i.id} tone="brand">
                    {i.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
