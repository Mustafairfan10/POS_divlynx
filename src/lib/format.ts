const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    }
    formatters.set(key, f);
  }
  return f.format(cents / 100);
}

/** Parse a user-typed decimal amount ("12.5", "12,50") to cents. Returns NaN if invalid. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^\d.,-]/g, "").replace(",", ".");
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function startOfDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export const ORDER_TYPE_LABEL = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
} as const;

export const FULFILLMENT_LABEL = {
  new: "New",
  in_kitchen: "In kitchen",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  done: "Completed",
} as const;

export const METHOD_LABEL = {
  cash: "Cash",
  card: "Card",
  wallet: "Mobile wallet",
  other: "Other",
} as const;
