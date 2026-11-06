"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CloudUpload,
  Laptop,
  Link2,
  Moon,
  Palette,
  Pencil,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Sun,
  Trash2,
  Undo2,
  Users,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { db, setMeta } from "@/client/db";
import { useNotices, useOnline, useStaffList, useSyncStatus, useTables } from "@/client/hooks";
import { hashPin, isPinTaken, save, softDelete } from "@/client/repo";
import { ROLE_LABEL, useSession } from "@/client/session";
import { discardFailed, registerWithServer, resyncAllLocal, retryFailed, syncNow } from "@/client/sync";
import { getThemePref, setThemePref, type ThemePref } from "@/client/theme";
import { printNode } from "@/components/print";
import { Receipt } from "@/components/Receipt";
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
  type Tone,
} from "@/components/ui";
import { computeTotals } from "@/lib/calc";
import { centsToInput, formatDateTime, formatMoney, parseMoney, uid } from "@/lib/format";
import type { DiningTable, Order, Payment, Role, Settings, Staff } from "@/lib/types";

type Section = "business" | "taxes" | "receipt" | "staff" | "tables" | "device" | "appearance";

const SECTIONS: Array<{ id: Section; label: string; icon: ReactNode; usesDraft?: boolean; perm?: "staff" }> = [
  { id: "business", label: "Business", icon: <Building2 className="size-5" />, usesDraft: true },
  { id: "taxes", label: "Taxes & charges", icon: <Percent className="size-5" />, usesDraft: true },
  { id: "receipt", label: "Receipt", icon: <ReceiptText className="size-5" />, usesDraft: true },
  { id: "staff", label: "Staff", icon: <Users className="size-5" />, perm: "staff" },
  { id: "tables", label: "Tables", icon: <UtensilsCrossed className="size-5" /> },
  { id: "device", label: "Device & sync", icon: <Server className="size-5" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="size-5" /> },
];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CNY", "INR", "SAR", "AED", "KWD", "QAR", "BHD", "OMR", "EGP", "TRY", "CHF", "SEK", "NOK", "DKK", "ZAR", "MXN", "BRL", "SGD", "HKD", "MYR", "PHP", "IDR", "THB", "KRW"];
const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU", "en-IN", "fr-FR", "de-DE", "es-ES", "es-MX", "it-IT", "pt-BR", "nl-NL", "ar-SA", "ar-AE", "tr-TR", "ja-JP", "zh-CN", "ko-KR"];

function settingsEqual(a: Settings, b: Settings): boolean {
  const strip = (s: Settings) => ({ ...s, updatedAt: 0, createdAt: 0 });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// ================================================================== view

export function SettingsView() {
  const { settings, can } = useSession();
  const toast = useToast();
  const [section, setSection] = useState<Section>("business");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [runSave, saving] = useBusy();

  const sections = SECTIONS.filter((s) => !s.perm || can(s.perm));
  const current = sections.some((s) => s.id === section) ? section : "business";
  const value = draft ?? settings;
  const dirty = draft !== null && !settingsEqual(draft, settings);
  const usesDraft = !!SECTIONS.find((s) => s.id === current)?.usesDraft;

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...(d ?? settings), ...p }));

  const errors = validateSettings(value);
  const hasErrors = Object.keys(errors).length > 0;

  async function onSave() {
    if (!draft) return;
    if (hasErrors) {
      toast.error("Please fix the highlighted fields first");
      return;
    }
    await runSave(async () => {
      try {
        const clean: Settings = {
          ...draft,
          businessName: draft.businessName.trim() || "My Cafe",
          currency: draft.currency.trim().toUpperCase(),
          locale: draft.locale.trim(),
        };
        await save("settings", clean);
        setDraft(null);
        toast.success("Settings saved");
      } catch (e) {
        toast.error(`Could not save: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Navigation */}
      <nav aria-label="Settings sections" className="shrink-0 border-b border-line bg-surface md:w-60 md:overflow-y-auto md:border-b-0 md:border-r">
        <h1 className="hidden px-5 pb-3 pt-5 text-xl font-bold tracking-[-0.01em] text-ink md:block">Settings</h1>
        <div className="flex gap-2 overflow-x-auto px-3 py-2.5 md:flex-col md:gap-1 md:overflow-visible md:px-3 md:py-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={current === s.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
              className={cx(
                "flex h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-[15px] font-semibold transition-colors duration-150 md:w-full",
                current === s.id ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                "max-md:border max-md:border-line-strong",
                current === s.id && "max-md:border-brand",
              )}
            >
              <span className="hidden md:inline">{s.icon}</span>
              <span className="md:flex-1 md:text-left">{s.label}</span>
              {s.usesDraft && dirty && <span className="size-2 shrink-0 rounded-full bg-warn" aria-label="unsaved changes" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-3 pb-10 sm:p-5">
            {current === "business" && <BusinessSection value={value} patch={patch} errors={errors} />}
            {current === "taxes" && <TaxesSection value={value} patch={patch} errors={errors} />}
            {current === "receipt" && <ReceiptSection value={value} patch={patch} />}
            {current === "staff" && <StaffSection />}
            {current === "tables" && <TablesSection />}
            {current === "device" && <DeviceSection />}
            {current === "appearance" && <AppearanceSection />}
          </div>
        </div>

        {(dirty || (usesDraft && saving)) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-5">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold text-warn">
              <span className="size-2.5 shrink-0 rounded-full bg-warn" />
              Unsaved changes
            </span>
            <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setDraft(null)} disabled={saving}>
              Discard
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} onClick={onSave} loading={saving} disabled={hasErrors}>
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type Errors = Partial<Record<keyof Settings, string>>;

function validateSettings(s: Settings): Errors {
  const e: Errors = {};
  if (!/^[A-Za-z]{3}$/.test(s.currency.trim())) e.currency = "Use a 3-letter ISO code, e.g. USD";
  else {
    try {
      new Intl.NumberFormat("en-US", { style: "currency", currency: s.currency.trim().toUpperCase() });
    } catch {
      e.currency = "Unknown currency code";
    }
  }
  try {
    if (!s.locale.trim()) throw new Error();
    new Intl.NumberFormat(s.locale.trim());
  } catch {
    e.locale = "Unknown locale, e.g. en-US";
  }
  const pct = (v: number) => !Number.isFinite(v) || v < 0 || v > 100;
  if (pct(s.taxRate)) e.taxRate = "Enter 0 – 100";
  if (pct(s.serviceChargeRate)) e.serviceChargeRate = "Enter 0 – 100";
  if (pct(s.discountApprovalThreshold)) e.discountApprovalThreshold = "Enter 0 – 100";
  if (!Number.isFinite(s.deliveryFee) || s.deliveryFee < 0) e.deliveryFee = "Enter a valid amount";
  if (s.tipPresets.some((p) => pct(p) || p === 0)) e.tipPresets = "Percents between 1 and 100";
  return e;
}

// ------------------------------------------------------------------ shared bits

function Panel({ title, description, children, action }: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Numeric input that keeps the user's raw text while typing. */
function NumberInput({
  value,
  onChange,
  suffix,
  ...rest
}: { value: number; onChange: (n: number) => void; suffix?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(() => String(value));
  const [prev, setPrev] = useState(value);
  // Resync the text when the value changes from outside (e.g. "Discard"), keeping the user's own formatting otherwise.
  if (!Object.is(prev, value)) {
    setPrev(value);
    if (!(text.trim() !== "" && Number(text.replace(",", ".")) === value)) setText(Number.isFinite(value) ? String(value) : "");
  }
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="decimal"
        value={text}
        className={cx(suffix && "pr-10")}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value.trim() === "" ? NaN : Number(e.target.value.replace(",", "."));
          onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[15px] font-semibold text-muted">{suffix}</span>}
    </div>
  );
}

function MoneyInput({ value, onChange, currency, ...rest }: { value: number; onChange: (c: number) => void; currency: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(() => centsToInput(value));
  const [prev, setPrev] = useState(value);
  if (!Object.is(prev, value)) {
    setPrev(value);
    if (parseMoney(text) !== value && Number.isFinite(value)) setText(centsToInput(value));
  }
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="decimal"
        value={text}
        className="pr-14"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseMoney(e.target.value));
        }}
        onBlur={() => {
          const c = parseMoney(text);
          if (Number.isFinite(c)) setText(centsToInput(c));
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-muted">{currency}</span>
    </div>
  );
}

interface DraftProps {
  value: Settings;
  patch: (p: Partial<Settings>) => void;
  errors: Errors;
}

// ------------------------------------------------------------------ Business

function BusinessSection({ value, patch, errors }: DraftProps) {
  const currencyOptions = CURRENCIES.includes(value.currency.toUpperCase()) ? CURRENCIES : [value.currency.toUpperCase(), ...CURRENCIES];
  const [customCurrency, setCustomCurrency] = useState(() => !CURRENCIES.includes(value.currency.toUpperCase()));
  let sample = "";
  try {
    sample = formatMoney(123456, value.currency.trim().toUpperCase(), value.locale.trim());
  } catch {
    sample = "";
  }
  return (
    <Panel title="Business" description="Shown on receipts, bills and reports.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" className="sm:col-span-2">
          <Input value={value.businessName} onChange={(e) => patch({ businessName: e.target.value })} placeholder="My Cafe" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea value={value.address} onChange={(e) => patch({ address: e.target.value })} rows={2} placeholder="Street, city" />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={value.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="(555) 123-4567" />
        </Field>
        <Field label="Tax / VAT number">
          <Input value={value.taxId} onChange={(e) => patch({ taxId: e.target.value })} placeholder="Optional" />
        </Field>
        <Field label="Currency" error={errors.currency} hint={customCurrency ? <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => setCustomCurrency(false)}>Choose from list</button> : <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => setCustomCurrency(true)}>Enter another code</button>}>
          {customCurrency ? (
            <Input value={value.currency} maxLength={3} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} placeholder="USD" className="uppercase" />
          ) : (
            <Select value={value.currency.toUpperCase()} onChange={(e) => patch({ currency: e.target.value })}>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Locale (number & date format)" error={errors.locale} hint={sample ? `Example: ${sample}` : undefined}>
          <Input value={value.locale} list="pos-locales" onChange={(e) => patch({ locale: e.target.value })} placeholder="en-US" />
          <datalist id="pos-locales">
            {LOCALES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ Taxes

function TaxesSection({ value, patch, errors }: DraftProps) {
  const [tipText, setTipText] = useState(() => value.tipPresets.join(", "));
  const tipKey = value.tipPresets.join(",");
  const [prevTipKey, setPrevTipKey] = useState(tipKey);
  if (prevTipKey !== tipKey) {
    setPrevTipKey(tipKey);
    if (parseTips(tipText).join(",") !== tipKey) setTipText(value.tipPresets.join(", "));
  }

  return (
    <>
      <div className="flex items-start gap-3 rounded-xl border border-line bg-info-soft p-3.5 text-sm text-ink-2">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-info" />
        <p>Tax and service charge changes apply to <strong>new orders only</strong>. Existing orders keep the rates they were created with.</p>
      </div>
      <Panel title="Tax">
        <div className="space-y-4">
          <Field label="Tax rate" error={errors.taxRate} className="max-w-xs">
            <NumberInput value={value.taxRate} suffix="%" onChange={(n) => patch({ taxRate: n })} />
          </Field>
          <Toggle
            checked={value.taxInclusive}
            onChange={(v) => patch({ taxInclusive: v })}
            label="Prices include tax"
            description={value.taxInclusive ? "Menu prices already contain tax; tax is shown as a portion of the total." : "Tax is added on top of menu prices at checkout."}
          />
        </div>
      </Panel>
      <Panel title="Charges">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service charge (dine-in)" error={errors.serviceChargeRate} hint="0 to disable">
            <NumberInput value={value.serviceChargeRate} suffix="%" onChange={(n) => patch({ serviceChargeRate: n })} />
          </Field>
          <Field label="Delivery fee" error={errors.deliveryFee} hint="Added to delivery orders">
            <MoneyInput value={value.deliveryFee} currency={value.currency} onChange={(c) => patch({ deliveryFee: c })} />
          </Field>
        </div>
      </Panel>
      <Panel title="Tips">
        <div className="space-y-4">
          <Toggle checked={value.tipsEnabled} onChange={(v) => patch({ tipsEnabled: v })} label="Accept tips" description="Show tip options at checkout and on printed bills." />
          <Field label="Tip presets" error={errors.tipPresets} hint="Comma-separated percents, e.g. 10, 15, 20" className="max-w-sm">
            <Input
              value={tipText}
              disabled={!value.tipsEnabled}
              inputMode="decimal"
              onChange={(e) => {
                setTipText(e.target.value);
                patch({ tipPresets: parseTips(e.target.value) });
              }}
            />
          </Field>
        </div>
      </Panel>
      <Panel title="Discounts">
        <Field label="Manager approval above" error={errors.discountApprovalThreshold} hint="Discounts larger than this percent of the subtotal need a manager PIN." className="max-w-xs">
          <NumberInput value={value.discountApprovalThreshold} suffix="%" onChange={(n) => patch({ discountApprovalThreshold: n })} />
        </Field>
      </Panel>
    </>
  );
}

function parseTips(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim().replace("%", ""))
    .filter(Boolean)
    .map(Number);
}

// ------------------------------------------------------------------ Receipt

function sampleOrder(s: Settings, by: string, t: number): Order {
  const order: Order = {
    id: "sample-order",
    createdAt: t - 25 * 60_000,
    updatedAt: t,
    number: "A1-042",
    deviceCode: "A1",
    type: "dine_in",
    status: "closed",
    fulfillment: "done",
    tableId: "sample-table",
    guests: 2,
    customer: { name: "", phone: "", address: "" },
    items: [
      {
        id: "s1",
        menuItemId: "m-latte",
        name: "Caffè Latte",
        basePrice: 450,
        modifiers: [
          { groupId: "g-size", groupName: "Size", optionId: "o-large", name: "Large", price: 70 },
          { groupId: "g-milk", groupName: "Milk", optionId: "o-oat", name: "Oat milk", price: 60 },
        ],
        qty: 2,
        notes: "Extra hot",
        status: "served",
        addedBy: by,
        updatedAt: t,
      },
      {
        id: "s2",
        menuItemId: "m-croissant",
        name: "Butter Croissant",
        basePrice: 375,
        modifiers: [{ groupId: "g-warm", groupName: "Prep", optionId: "o-warm", name: "Warmed", price: 0 }],
        qty: 1,
        notes: "",
        status: "served",
        addedBy: by,
        updatedAt: t,
      },
      {
        id: "s3",
        menuItemId: "m-avocado",
        name: "Avocado Toast",
        basePrice: 1150,
        modifiers: [{ groupId: "g-add", groupName: "Add-ons", optionId: "o-egg", name: "Poached egg", price: 200 }],
        qty: 1,
        notes: "No chili flakes",
        status: "served",
        addedBy: by,
        updatedAt: t,
      },
    ],
    serviceCharge: s.serviceChargeRate > 0,
    tip: 0,
    deliveryFee: 0,
    adjustments: [],
    note: "",
    createdBy: by,
    closedAt: t,
    receiptPrints: 0,
    log: [],
    taxRate: Number.isFinite(s.taxRate) ? s.taxRate : 0,
    taxInclusive: s.taxInclusive,
    serviceChargeRate: Number.isFinite(s.serviceChargeRate) ? s.serviceChargeRate : 0,
  };
  return order;
}

function SampleReceipt({ settings, by, now }: { settings: Settings; by: string; now: number }) {
  const order = useMemo(() => sampleOrder(settings, by, now), [settings, by, now]);
  const payments = useMemo<Payment[]>(() => {
    const total = computeTotals(order).total;
    const tendered = Math.ceil(total / 1000) * 1000; // round cash note above the total
    const t = now;
    return [
      {
        id: "sample-pay",
        createdAt: t,
        updatedAt: t,
        orderId: order.id,
        orderNumber: order.number,
        kind: "payment",
        method: "cash",
        amount: total,
        tendered,
        change: tendered - total,
        status: "approved",
        reference: "",
        by,
        deviceCode: "A1",
      },
    ];
  }, [order, by, now]);
  return <Receipt kind="receipt" order={order} payments={payments} settings={settings} tableName="T4" printedBy={by} />;
}

function ReceiptSection({ value, patch }: Omit<DraftProps, "errors">) {
  const { staff } = useSession();
  const [now] = useState(() => Date.now());
  const previewSettings = useMemo<Settings>(
    () => ({
      ...value,
      currency: /^[A-Za-z]{3}$/.test(value.currency) ? value.currency.toUpperCase() : "USD",
    }),
    [value],
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Receipt">
        <div className="space-y-4">
          <Field label="Header text" hint="Printed under the business details, e.g. opening hours or Wi-Fi password.">
            <Textarea value={value.receiptHeader} onChange={(e) => patch({ receiptHeader: e.target.value })} rows={2} />
          </Field>
          <Field label="Footer text" hint="Printed at the bottom, e.g. a thank-you note or return policy.">
            <Textarea value={value.receiptFooter} onChange={(e) => patch({ receiptFooter: e.target.value })} rows={2} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Paper width</p>
            <Segmented
              value={value.paperWidth}
              onChange={(v) => patch({ paperWidth: v })}
              options={[
                { value: "58", label: "58 mm" },
                { value: "80", label: "80 mm" },
              ]}
              className="max-w-xs"
            />
          </div>
          <Toggle
            checked={value.autoPrintReceipt}
            onChange={(v) => patch({ autoPrintReceipt: v })}
            label="Print receipt automatically"
            description="Open the print dialog as soon as an order is paid."
          />
          <Button
            variant="outline"
            icon={<Printer className="size-4" />}
            onClick={() => void printNode(<SampleReceipt settings={previewSettings} by={staff.name} now={Date.now()} />, value.paperWidth)}
          >
            Print test receipt
          </Button>
        </div>
      </Panel>
      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold text-ink-2">Live preview</p>
        <div className="rounded-xl border border-line bg-surface-3 p-4 sm:p-6" aria-label="Receipt preview">
          <div className="mx-auto" style={{ maxWidth: value.paperWidth === "58" ? "58mm" : "80mm" }}>
            <div className="border border-line-strong shadow-card">
              <SampleReceipt settings={previewSettings} by={staff.name} now={now} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Staff

const ROLES: Role[] = ["admin", "manager", "cashier", "kitchen"];
const ROLE_TONE: Record<Role, Tone> = { admin: "brand", manager: "blue", cashier: "gray", kitchen: "amber" };

function StaffSection() {
  const list = useStaffList();
  const { staff: me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  async function remove(s: Staff) {
    if (s.id === me.id) return toast.error("You can't delete yourself");
    const otherAdmins = (list ?? []).filter((x) => x.id !== s.id && x.role === "admin" && x.active);
    if (s.role === "admin" && s.active && otherAdmins.length === 0) return toast.error("Keep at least one active admin");
    const { ok } = await confirm({
      title: `Delete ${s.name}?`,
      message: "They will no longer be able to sign in. Past orders keep their name.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await softDelete("staff", s.id);
      toast.success(`${s.name} deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Panel
      title="Staff"
      description="Each person signs in with their own 4-digit PIN."
      action={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Add staff
        </Button>
      }
    >
      {!list ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No staff yet" />
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[30rem] text-left">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th scope="col" className="py-2 pl-4 pr-3 sm:pl-5">
                  <ColHead>Name</ColHead>
                </th>
                <th scope="col" className="px-3 py-2">
                  <ColHead>Role</ColHead>
                </th>
                <th scope="col" className="px-3 py-2">
                  <ColHead>Status</ColHead>
                </th>
                <th scope="col" className="py-2 pl-3 pr-4 text-right sm:pr-5">
                  <ColHead>
                    <span className="sr-only">Actions</span>
                  </ColHead>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-surface-2">
                  <td className="py-1.5 pl-4 pr-3 sm:pl-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cx(
                          "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                          s.active ? "bg-brand-soft text-brand-ink" : "bg-surface-3 text-muted",
                        )}
                      >
                        {s.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <p className={cx("min-w-0 truncate text-[15px] font-semibold", s.active ? "text-ink" : "text-muted line-through")}>
                        {s.name}
                        {s.id === me.id && <span className="ml-1.5 text-sm font-medium text-muted no-underline">(you)</span>}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge tone={ROLE_TONE[s.role]}>{ROLE_LABEL[s.role]}</Badge>
                  </td>
                  <td className="px-3 py-1.5">{s.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                  <td className="py-1.5 pl-3 pr-2 sm:pr-3">
                    <div className="flex justify-end">
                      <IconButton label={`Edit ${s.name}`} className="size-11" onClick={() => setEditing(s)}>
                        <Pencil className="size-5" />
                      </IconButton>
                      <IconButton
                        label={`Delete ${s.name}`}
                        className="size-11 text-bad hover:bg-bad-soft hover:text-bad"
                        onClick={() => void remove(s)}
                        disabled={s.id === me.id}
                      >
                        <Trash2 className="size-5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StaffModal key={editing === "new" ? "new" : editing?.id ?? "none"} editing={editing} list={list ?? []} onClose={() => setEditing(null)} />
    </Panel>
  );
}

function StaffModal({ editing, list, onClose }: { editing: Staff | "new" | null; list: Staff[]; onClose: () => void }) {
  const { staff: me } = useSession();
  const toast = useToast();
  const isNew = editing === "new";
  const existing = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<Role>(existing?.role ?? "cashier");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState("");
  const [run, busy] = useBusy();

  const isSelf = existing?.id === me.id;

  async function submit() {
    setError("");
    const n = name.trim();
    if (!n) return setError("Enter a name");
    if (isNew && !pin) return setError("Set a 4-digit PIN");
    if (pin && !/^\d{4}$/.test(pin)) return setError("PIN must be exactly 4 digits");
    if (isSelf && !active) return setError("You can't deactivate yourself");
    if (isSelf && role !== "admin" && existing?.role === "admin") return setError("You can't remove your own admin role");
    if (existing && existing.role === "admin" && existing.active && (role !== "admin" || !active)) {
      const others = list.filter((x) => x.id !== existing.id && x.role === "admin" && x.active);
      if (others.length === 0) return setError("Keep at least one active admin");
    }
    await run(async () => {
      try {
        const t = Date.now();
        const rec: Staff = existing
          ? { ...existing, name: n, role, active }
          : { id: uid(), createdAt: t, updatedAt: t, name: n, role, active, pinHash: "" };
        if (pin) {
          if (await isPinTaken(pin, rec.id)) {
            setError("That PIN is already used by someone else");
            return;
          }
          rec.pinHash = await hashPin(rec.id, pin);
        }
        await save("staff", rec);
        toast.success(isNew ? `${n} added` : `${n} updated`);
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Add staff" : `Edit ${existing?.name ?? "staff"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {isNew ? "Add staff" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Sam" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={isNew ? "PIN" : "New PIN"} hint={isNew ? "Exactly 4 digits, unique per person." : "Leave blank to keep the current PIN."}>
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="••••"
            className="max-w-40 text-center text-xl tracking-[0.5em]"
          />
        </Field>
        <Toggle checked={active} onChange={setActive} disabled={isSelf} label="Active" description={isSelf ? "You can't deactivate yourself." : "Inactive staff can't sign in."} />
        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
            <XCircle className="size-4 shrink-0" />
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ Tables

function TablesSection() {
  const tables = useTables();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<DiningTable | "new" | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, DiningTable[]>();
    for (const t of tables ?? []) {
      const k = t.area.trim() || "Main";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [tables]);
  const areas = groups.map(([a]) => a);

  async function remove(t: DiningTable) {
    const open = await db.orders.where("status").equals("open").filter((o) => !o.deleted && o.tableId === t.id).count();
    const { ok } = await confirm({
      title: `Delete table ${t.name}?`,
      message: open ? `${open} open order${open === 1 ? " is" : "s are"} still assigned to this table.` : "This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await softDelete("tables", t.id);
    toast.success(`Table ${t.name} deleted`);
  }

  return (
    <Panel
      title="Tables"
      description="Dining tables for dine-in orders, grouped by area."
      action={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Add table
        </Button>
      }
    >
      {!tables ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : tables.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed className="size-6" />} title="No tables yet">
          Add tables to seat dine-in orders.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map(([area, list]) => (
            <section key={area}>
              <h3 className="mb-2 flex items-center gap-2">
                <ColHead className="text-xs">{area}</ColHead> <Badge>{list.length}</Badge>
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 py-1 pl-3.5 pr-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-ink">{t.name}</p>
                      <p className="text-sm text-muted">
                        {t.seats} seat{t.seats === 1 ? "" : "s"} · sort {t.sort}
                      </p>
                    </div>
                    <IconButton label={`Edit table ${t.name}`} className="size-11" onClick={() => setEditing(t)}>
                      <Pencil className="size-5" />
                    </IconButton>
                    <IconButton label={`Delete table ${t.name}`} className="size-11 text-bad hover:bg-bad-soft hover:text-bad" onClick={() => void remove(t)}>
                      <Trash2 className="size-5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <TableModal
        key={editing === "new" ? "new" : editing?.id ?? "none"}
        editing={editing}
        areas={areas}
        nextSort={(tables ?? []).reduce((m, t) => Math.max(m, t.sort), 0) + 1}
        onClose={() => setEditing(null)}
      />
    </Panel>
  );
}

function TableModal({ editing, areas, nextSort, onClose }: { editing: DiningTable | "new" | null; areas: string[]; nextSort: number; onClose: () => void }) {
  const toast = useToast();
  const existing = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [seats, setSeats] = useState(String(existing?.seats ?? 4));
  const [area, setArea] = useState(existing?.area ?? areas[0] ?? "Main");
  const [sort, setSort] = useState(String(existing?.sort ?? nextSort));
  const [error, setError] = useState("");
  const [run, busy] = useBusy();

  async function submit() {
    setError("");
    const n = name.trim();
    const s = Number(seats);
    const so = Number(sort);
    if (!n) return setError("Enter a table name");
    if (!Number.isInteger(s) || s < 1 || s > 99) return setError("Seats must be 1 – 99");
    if (!Number.isFinite(so)) return setError("Sort must be a number");
    await run(async () => {
      const t = Date.now();
      const rec: DiningTable = existing
        ? { ...existing, name: n, seats: s, area: area.trim() || "Main", sort: so }
        : { id: uid(), createdAt: t, updatedAt: t, name: n, seats: s, area: area.trim() || "Main", sort: so };
      try {
        await save("tables", rec);
        toast.success(existing ? `Table ${n} updated` : `Table ${n} added`);
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      size="sm"
      title={existing ? `Edit table ${existing.name}` : "Add table"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {existing ? "Save" : "Add table"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. T5" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seats">
            <Input value={seats} inputMode="numeric" onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Sort order">
            <Input value={sort} inputMode="numeric" onChange={(e) => setSort(e.target.value.replace(/[^\d-]/g, ""))} />
          </Field>
        </div>
        <Field label="Area" hint="e.g. Main, Patio, Bar">
          <Input value={area} list="pos-areas" onChange={(e) => setArea(e.target.value)} />
          <datalist id="pos-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
            <XCircle className="size-4 shrink-0" />
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ Device & sync

interface Health {
  ok: boolean;
  storage?: "postgres" | "embedded" | string;
  durable?: boolean;
  insecureDefaults?: boolean;
  serverTime?: number;
  error?: string;
}

const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  idle: { label: "Up to date", tone: "green" },
  syncing: { label: "Syncing…", tone: "blue" },
  offline: { label: "Offline", tone: "amber" },
  error: { label: "Error", tone: "red" },
  unpaired: { label: "Not paired", tone: "amber" },
  unauthorized: { label: "Unauthorized", tone: "red" },
};

async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Health;
  } catch {
    return null;
  }
}

function DeviceSection() {
  const { device } = useSession();
  const { status, pending, failed } = useSyncStatus();
  const notices = useNotices();
  const online = useOnline();
  const toast = useToast();
  const confirm = useConfirm();
  const [health, setHealth] = useState<Health | null | "loading">("loading");
  const [run, busy] = useBusy();
  const [action, setAction] = useState<string | null>(null);

  function loadHealth() {
    setHealth("loading");
    void fetchHealth().then(setHealth);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((h) => !cancelled && setHealth(h));
    return () => {
      cancelled = true;
    };
  }, [online]);

  const paired = !!device.token;
  const needsPair = !paired || status.state === "unauthorized";
  const st = STATE_LABEL[status.state] ?? { label: status.state, tone: "gray" as Tone };

  async function act(name: string, fn: () => Promise<void>, success: string) {
    setAction(name);
    await run(async () => {
      try {
        await fn();
        toast.success(success);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
    setAction(null);
  }

  async function onDiscard() {
    const { ok } = await confirm({
      title: `Discard ${failed.length} failed change${failed.length === 1 ? "" : "s"}?`,
      message: "These changes will never reach the server and will be lost from other devices. This can't be undone.",
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (ok) await act("discard", discardFailed, "Failed changes discarded");
  }

  async function onResync() {
    const { ok } = await confirm({
      title: "Re-upload all local data?",
      message: "Every record on this device will be queued and sent to the server again. Use this if the server was reset or data is missing on other devices.",
      confirmLabel: "Re-upload",
      tone: "warning",
    });
    if (ok)
      await act(
        "resync",
        async () => {
          await resyncAllLocal();
          await syncNow();
        },
        "All local data queued for upload",
      );
  }

  async function onReset() {
    const first = await confirm({
      title: "Reset this device?",
      message: "All local data on this device will be erased and you'll need to set it up again. Data already synced to the server is kept.",
      confirmLabel: "Reset device",
      tone: "danger",
    });
    if (!first.ok) return;
    if (pending > 0) {
      const second = await confirm({
        title: `${pending} change${pending === 1 ? " has" : "s have"} not synced`,
        message: (
          <span>
            These changes exist <strong>only on this device</strong> and will be permanently lost. Sync first if you can.
          </span>
        ),
        confirmLabel: "Erase anyway",
        tone: "danger",
      });
      if (!second.ok) return;
    }
    try {
      sessionStorage.clear();
    } catch {}
    await db.delete();
    location.reload();
  }

  return (
    <>
      <Panel title="This device">
        <dl className="grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
          <Info label="Device name" value={device.deviceName || "—"} />
          <Info label="Device code" value={<span className="tabular font-semibold tracking-wide">{device.deviceCode}</span>} />
          <Info
            label="Paired with server"
            value={paired ? <Badge tone="green">Paired{device.pairedAt ? ` · ${formatDateTime(device.pairedAt)}` : ""}</Badge> : <Badge tone="amber">Offline only</Badge>}
          />
          <Info label="Network" value={online ? <Badge tone="green">Online</Badge> : <Badge tone="amber">Offline</Badge>} />
        </dl>
      </Panel>

      {needsPair && <PairForm unauthorized={status.state === "unauthorized"} />}

      <Panel title="Sync" description="Changes are saved on this device first and uploaded automatically.">
        <dl className="mb-4 grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
          <Info label="Status" value={<Badge tone={st.tone}>{st.label}</Badge>} />
          <Info label="Last synced" value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "Never"} />
          <Info label="Waiting to upload" value={<span className={cx("font-semibold", pending > 0 && "text-warn")}>{pending}</span>} />
          <Info label="Failed" value={<span className={cx("font-semibold", failed.length > 0 && "text-bad")}>{failed.length}</span>} />
        </dl>
        {status.lastError && status.state !== "idle" && (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{status.lastError}</span>
          </p>
        )}
        {failed.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-line-strong">
            <p className="flex items-center gap-2 border-b border-line bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
              <XCircle className="size-4 shrink-0" />
              Changes that failed to upload
            </p>
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {failed.map((f) => (
                <li key={f.key} className="px-3 py-2 text-sm">
                  <span className="font-semibold text-ink">{f.entity}</span>
                  <span className="tabular ml-1.5 text-xs text-muted">{f.recordId.slice(0, 8)}</span>
                  <span className="block text-muted">{f.lastError ?? "Unknown error"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={busy && action === "sync"} disabled={busy || !paired} onClick={() => void act("sync", syncNow, "Sync complete")}>
            Sync now
          </Button>
          {failed.length > 0 && (
            <>
              <Button variant="outline" icon={<RotateCcw className="size-4" />} loading={busy && action === "retry"} disabled={busy} onClick={() => void act("retry", retryFailed, "Retrying failed changes")}>
                Retry failed
              </Button>
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={busy && action === "discard"} disabled={busy} onClick={() => void onDiscard()}>
                Discard failed
              </Button>
            </>
          )}
          <Button variant="ghost" icon={<CloudUpload className="size-4" />} loading={busy && action === "resync"} disabled={busy || !paired} onClick={() => void onResync()}>
            Re-upload all local data
          </Button>
        </div>
      </Panel>

      <Panel
        title="Server"
        action={
          <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void loadHealth()} disabled={health === "loading"}>
            Check
          </Button>
        }
      >
        {health === "loading" ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : !health ? (
          <p className="text-[15px] text-muted">Server unreachable{online ? "" : " — this device is offline"}. Sales keep working and will sync later.</p>
        ) : !health.ok ? (
          <p className="flex items-center gap-2 text-[15px] text-bad">
            <XCircle className="size-4 shrink-0" />
            Server error: {health.error ?? "unknown"}</p>
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
              <Info label="Storage" value={<Badge tone={health.storage === "postgres" ? "green" : "blue"}>{health.storage === "postgres" ? "PostgreSQL" : "Embedded"}</Badge>} />
              <Info
                label="Durable"
                value={
                  health.durable ? (
                    <span className="flex items-center gap-1.5 font-semibold text-ok">
                      <CheckCircle2 className="size-4" /> Yes
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-semibold text-bad">
                      <XCircle className="size-4" /> No — data may be lost on redeploy
                    </span>
                  )
                }
              />
            </dl>
            {health.insecureDefaults && (
              <div className="flex items-start gap-3 rounded-lg border border-warn-line bg-warn-soft p-3.5 text-sm text-ink-2">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
                <p>
                  <strong>Insecure server configuration.</strong> <code className="font-semibold text-ink">STORE_ACCESS_CODE</code> and/or <code className="font-semibold text-ink">AUTH_SECRET</code> are not set, so default
                  values are in use. Set them in the server environment before going live.
                </p>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Recent sync notices">
        {!notices ? (
          <Spinner />
        ) : notices.length === 0 ? (
          <p className="text-[15px] text-muted">No notices.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {notices.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5">
                <Badge tone={n.kind === "rejected" ? "red" : n.kind === "merged" ? "amber" : n.kind === "reset" ? "blue" : "gray"}>{n.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-ink">{n.message}</p>
                  <p className="text-xs text-muted">{formatDateTime(n.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Card className="border-bad/40 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em] text-bad">
          <AlertTriangle className="size-5" />
          Danger zone
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-muted">
          Erase all data stored on this device and start setup again.
          {pending > 0 && <strong className="text-bad"> {pending} unsynced change{pending === 1 ? "" : "s"} would be lost.</strong>}
        </p>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void onReset()}>
          Reset this device
        </Button>
      </Card>
    </>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function PairForm({ unauthorized }: { unauthorized: boolean }) {
  const { device } = useSession();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [run, busy] = useBusy();

  async function pair() {
    setError("");
    if (!code.trim()) return setError("Enter the store access code");
    await run(async () => {
      try {
        const res = await registerWithServer(code.trim(), device.deviceId, device.deviceName);
        await setMeta("device", { ...device, token: res.token, deviceCode: res.deviceCode, pairedAt: Date.now() });
        setCode("");
        toast.success("Device paired — syncing now");
        await syncNow();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Link2 className="size-5 text-brand-ink" /> {unauthorized ? "Re-pair this device" : "Pair with server"}
        </span>
      }
      description={
        unauthorized
          ? "The server rejected this device's credentials (the access code or server secret may have changed). Enter the access code to reconnect."
          : "This device works offline only. Enter your store access code to sync with other devices and back up your data."
      }
    >
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void pair();
        }}
      >
        <Field error={error} className="flex-1">
          <Input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Store access code" aria-label="Store access code" />
        </Field>
        <Button type="submit" variant="primary" loading={busy} icon={<Link2 className="size-4" />}>
          Pair device
        </Button>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ Appearance

function AppearanceSection() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  return (
    <Panel title="Appearance" description="Applies to this device only.">
      <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Theme</p>
      <Segmented
        value={pref}
        onChange={(v) => {
          setPref(v);
          setThemePref(v);
        }}
        options={[
          { value: "light", label: "Light", icon: <Sun className="size-4" /> },
          { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
          { value: "system", label: "System", icon: <Laptop className="size-4" /> },
        ]}
        className="max-w-md [&>button]:h-11"
      />
    </Panel>
  );
}

