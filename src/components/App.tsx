"use client";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  CloudOff,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Settings as SettingsIcon,
  ShoppingBag,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import { db, getMeta, setMeta } from "@/client/db";
import { findStaffByPin, getDevice, type DeviceInfo } from "@/client/repo";
import { startSync, syncNow, registerWithServer } from "@/client/sync";
import { seedStore, hasLocalData, usingDefaultAdminPin, DEFAULT_PINS } from "@/client/seed";
import { applyTheme } from "@/client/theme";
import { PinPad, SessionProvider, useSession, roleCan, ROLE_LABEL, type View, type Perm } from "@/client/session";
import { useNotices, useOnline, useSyncStatus } from "@/client/hooks";
import { Button, ColHead, ConfirmProvider, Field, Input, Modal, Spinner, ToastProvider, cx, useToast } from "./ui";
import { SyncIndicator } from "./SyncIndicator";
import { uid } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { RegisterView } from "./views/Register";
import { CheckoutView } from "./views/Checkout";
import { OrdersView } from "./views/Orders";
import { TablesView } from "./views/Tables";
import { KitchenView } from "./views/Kitchen";
import { MenuView } from "./views/Menu";
import { ReportsView } from "./views/Reports";
import { SettingsView } from "./views/Settings";

export default function App() {
  const device = useLiveQuery(async () => (await getMeta<DeviceInfo | null>("device")) ?? null, []);
  const session = useLiveQuery(async () => (await getMeta<{ staffId: string } | null>("session")) ?? null, []);
  const staff = useLiveQuery(
    async () => (session?.staffId ? ((await db.staff.get(session.staffId)) ?? null) : null),
    [session?.staffId],
  );

  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => applyTheme();
    mq.addEventListener("change", onScheme);
    const stop = startSync();
    navigator.storage?.persist?.().catch(() => {});
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    return () => {
      mq.removeEventListener("change", onScheme);
      stop();
    };
  }, []);

  let body: React.ReactNode;
  if (device === undefined || session === undefined || (session && staff === undefined)) body = <Splash />;
  else if (device === null) body = <SetupScreen />;
  else if (!session || !staff || !staff.active || staff.deleted) body = <LoginScreen />;
  else
    body = (
      <SessionProvider device={device} staff={staff as Staff}>
        <Shell />
      </SessionProvider>
    );

  return (
    <ToastProvider>
      <ConfirmProvider>{body}</ConfirmProvider>
    </ToastProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

/** The store's mark: its initials, set condensed like a printed pad heading. */
function Logo({ name, className }: { name?: string; className?: string }) {
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "POS";
  return (
    <div aria-hidden className={cx("cond flex items-center justify-center rounded-lg border-2 border-current text-[15px] tracking-[0.04em]", className)}>
      {initials}
    </div>
  );
}

function greeting(d: Date | null) {
  const h = d?.getHours() ?? 12;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ------------------------------------------------------------------ Setup / pairing

function SetupScreen() {
  const [accessCode, setAccessCode] = useState("");
  const [deviceName, setDeviceName] = useState("Front counter");
  const [businessName, setBusinessName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"form" | "downloading">("form");
  const online = useOnline();

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const existing = await getDevice();
      const deviceId = existing?.deviceId ?? uid();
      const res = await registerWithServer(accessCode.trim(), deviceId, deviceName.trim() || "Device");
      const info: DeviceInfo = { deviceId, deviceCode: res.deviceCode, deviceName: deviceName.trim(), token: res.token, pairedAt: Date.now() };
      if (res.isNewStore && !(await hasLocalData())) {
        await seedStore(businessName.trim());
        await setMeta("device", info);
      } else {
        setStage("downloading");
        await setMeta("device", info);
        await syncNow();
      }
    } catch (e) {
      setError((e as Error).message);
      setStage("form");
    } finally {
      setBusy(false);
    }
  }

  async function offline() {
    const info: DeviceInfo = { deviceId: uid(), deviceCode: `L${Math.random().toString(36).slice(2, 4).toUpperCase()}`, deviceName: deviceName.trim() || "Device" };
    if (!(await hasLocalData())) await seedStore(businessName.trim());
    await setMeta("device", info);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="anim-pop w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <Logo name={businessName || "Cafe POS"} className="size-12 shrink-0 text-brand-ink" />
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.015em]">Set up this device</h1>
            <p className="text-[15px] text-ink-2">Connect this tablet, phone or computer to your store. You only need to do this once.</p>
          </div>
        </div>
        <div className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-card">
          {stage === "downloading" ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Spinner className="size-8" />
              <p className="font-semibold">Downloading menu, staff and orders…</p>
            </div>
          ) : (
            <>
              <Field label="Store access code" hint="Set by the owner as STORE_ACCESS_CODE on the server (demo default: “demo”).">
                <Input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Enter access code" autoFocus type="password" onKeyDown={(e) => e.key === "Enter" && connect()} />
              </Field>
              <Field label="Device name" hint="Helps you tell devices apart, e.g. “Bar tablet”.">
                <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
              </Field>
              <Field label="Business name" hint="Only used if this is a brand-new store.">
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Corner Café" />
              </Field>
              {error && <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-medium text-bad">{error}</p>}
              <Button variant="primary" size="lg" block loading={busy} disabled={!accessCode.trim() || !online} onClick={connect}>
                {online ? "Connect device" : "Offline — connect later"}
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button variant="outline" block onClick={offline} icon={<CloudOff className="size-4" />}>
                Start offline, pair later
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Login

function LoginScreen() {
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const settings = useLiveQuery(() => db.settings.get("store"), []);
  const staffCount = useLiveQuery(() => db.staff.count(), []);
  const demo = useLiveQuery(() => usingDefaultAdminPin(), [staffCount]);
  const { status } = useSyncStatus();
  const service = useLiveQuery(async () => {
    const open = (await db.orders.where("status").equals("open").toArray()).filter((o) => !o.deleted);
    return {
      open: open.length,
      kitchen: open.filter((o) => o.items.some((i) => i.status === "sent" && !i.voided)).length,
      ready: open.filter((o) => o.items.some((i) => i.status === "ready" && !i.voided)).length,
    };
  }, []);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  const time = now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.9fr)]">
      {/* The pad's cover: store, clock and the state of service. */}
      <section className="hidden flex-col justify-between bg-rail p-12 text-rail-on lg:flex">
        <div className="flex items-center gap-3">
          <Logo name={settings?.businessName} className="size-12 text-rail-on" />
          <div>
            <p className="text-lg font-bold leading-tight">{settings?.businessName ?? "Cafe POS"}</p>
            <p className="text-sm text-rail-ink">Point of sale</p>
          </div>
        </div>
        <div>
          <p className="text-lg text-rail-ink">{greeting(now)}</p>
          <p className="display mt-1 text-[clamp(4rem,8vw,6rem)] leading-none tracking-[-0.03em]">{time}</p>
          <p className="mt-3 text-xl text-rail-ink">{now?.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
          {service && (
            <dl className="mt-10 grid max-w-md grid-cols-3 divide-x divide-rail-ink/30 rounded-lg border border-rail-ink/30">
              <ServiceCell label="Open checks" value={service.open} />
              <ServiceCell label="In kitchen" value={service.kitchen} />
              <ServiceCell label="Ready" value={service.ready} />
            </dl>
          )}
        </div>
        <p className="text-sm text-rail-ink">Works offline · syncs across every device in the store</p>
      </section>

      <section className="flex flex-col items-center justify-center p-6">
        <div className="anim-pop w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo name={settings?.businessName} className="size-11 shrink-0 text-brand-ink" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{settings?.businessName ?? "Cafe POS"}</p>
              <p className="text-sm text-muted">{now?.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</p>
            </div>
            <p className="display text-2xl">{time}</p>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.015em]">Enter your PIN</h1>
          <p className="mb-6 mt-1 text-ink-2">Tap your 4-digit staff PIN to start your shift.</p>
          {staffCount === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface py-10 text-center text-ink-2">
              <Spinner className="size-7" />
              <p>{status.state === "offline" ? "Waiting for connection to download staff accounts…" : "Downloading store data…"}</p>
            </div>
          ) : (
            <PinPad
              error={error}
              onComplete={async (pin) => {
                const s = await findStaffByPin(pin);
                if (!s) {
                  setError("Incorrect PIN. Try again.");
                  return false;
                }
                setError("");
                await setMeta("session", { staffId: s.id, at: Date.now() });
                return true;
              }}
            />
          )}
          {demo && (
            <div className="mt-6 rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-ink-2">
              <ColHead>Demo PINs</ColHead>
              <p className="mt-1 tabular-nums">
                Admin <b className="text-ink">{DEFAULT_PINS.admin}</b> · Manager <b className="text-ink">{DEFAULT_PINS.manager}</b> · Cashier{" "}
                <b className="text-ink">{DEFAULT_PINS.cashier}</b> · Kitchen <b className="text-ink">{DEFAULT_PINS.kitchen}</b>
              </p>
              <p className="mt-1 text-xs text-muted">Change the admin PIN in Settings → Staff to hide this.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ServiceCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="cond text-[11px] text-rail-ink">{label}</dt>
      <dd className="display mt-0.5 text-3xl">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ Shell

const NAV: Array<{ view: View; perm: Perm; label: string; icon: typeof ShoppingBag; primary?: boolean }> = [
  { view: "register", perm: "register", label: "Register", icon: ShoppingBag, primary: true },
  { view: "orders", perm: "orders", label: "Orders", icon: ClipboardList, primary: true },
  { view: "tables", perm: "tables", label: "Tables", icon: LayoutGrid, primary: true },
  { view: "kitchen", perm: "kitchen", label: "Kitchen", icon: ChefHat, primary: true },
  { view: "menu", perm: "menu", label: "Menu", icon: UtensilsCrossed },
  { view: "reports", perm: "reports", label: "Reports", icon: BarChart3 },
  { view: "settings", perm: "settings", label: "Settings", icon: SettingsIcon },
];

function Shell() {
  const { view, go, staff, lock, settings } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const online = useOnline();
  const { pending } = useSyncStatus();
  const items = NAV.filter((n) => roleCan(staff.role, n.perm));
  const primary = items.filter((n) => n.primary);
  const secondary = items.filter((n) => !n.primary);
  const active = view === "checkout" ? "register" : view;
  useNoticeToasts();

  const content = (() => {
    switch (view) {
      case "register":
        return <RegisterView />;
      case "checkout":
        return <CheckoutView />;
      case "orders":
        return <OrdersView />;
      case "tables":
        return <TablesView />;
      case "kitchen":
        return <KitchenView />;
      case "menu":
        return <MenuView />;
      case "reports":
        return <ReportsView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Desktop / landscape tablet rail: printed green, like the pad's cover. */}
      <nav aria-label="Main" className="hidden w-[84px] shrink-0 flex-col items-center gap-1 bg-rail py-4 text-rail-ink lg:flex">
        <Logo name={settings.businessName} className="mb-5 size-11 text-rail-on" />
        {items.map((n) => {
          const on = active === n.view;
          return (
            <button
              key={n.view}
              onClick={() => go(n.view)}
              aria-current={on ? "page" : undefined}
              className={cx(
                "flex w-[68px] flex-col items-center gap-1 rounded-lg py-2.5 text-[11px] font-semibold transition-colors duration-150",
                on ? "bg-rail-on text-rail dark:bg-brand-soft dark:text-brand-ink" : "hover:bg-rail-on/10 hover:text-rail-on",
              )}
            >
              <n.icon className="size-[22px]" strokeWidth={on ? 2.25 : 1.9} />
              {n.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={lock} className="flex w-[68px] flex-col items-center gap-1 rounded-lg py-2.5 text-[11px] font-semibold transition-colors hover:bg-rail-on/10 hover:text-rail-on">
          <Lock className="size-[22px]" strokeWidth={1.9} />
          Lock
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] sm:px-5">
          <Logo name={settings.businessName} className="size-9 shrink-0 text-[12px] text-brand-ink lg:hidden" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight">{settings.businessName}</p>
            <p className="truncate text-xs text-muted">
              {staff.name} · {ROLE_LABEL[staff.role]}
            </p>
          </div>
          <SyncIndicator />
          <button onClick={lock} className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3 sm:flex lg:hidden" aria-label="Lock">
            <Lock className="size-4" /> Lock
          </button>
        </header>
        {!online && (
          <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b border-warn-line bg-warn-soft px-3 py-1.5 text-center text-[13px] font-semibold text-warn">
            <Wifi className="size-4" />
            Offline — everything is saved on this device{pending ? ` (${pending} change${pending === 1 ? "" : "s"} waiting)` : ""} and will sync automatically.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">{content}</main>

        {/* Phone / portrait tablet tab bar */}
        {items.length > 1 && (
          <nav aria-label="Main" className="flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
            {primary.map((n) => {
              const on = active === n.view;
              return (
                <button
                  key={n.view}
                  onClick={() => go(n.view)}
                  aria-current={on ? "page" : undefined}
                  className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", on ? "text-brand-ink" : "text-muted")}
                >
                  <span className={cx("flex h-7 w-12 items-center justify-center rounded-lg transition-colors", on && "bg-brand-soft")}>
                    <n.icon className="size-5" />
                  </span>
                  {n.label}
                </button>
              );
            })}
            <button
              onClick={() => setMoreOpen(true)}
              className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", secondary.some((s) => s.view === active) ? "text-brand-ink" : "text-muted")}
            >
              <span className={cx("flex h-7 w-12 items-center justify-center rounded-lg", secondary.some((s) => s.view === active) && "bg-brand-soft")}>
                <MoreHorizontal className="size-5" />
              </span>
              More
            </button>
          </nav>
        )}
      </div>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More" size="sm">
        <div className="grid grid-cols-2 gap-2">
          {secondary.map((n) => (
            <button
              key={n.view}
              onClick={() => {
                setMoreOpen(false);
                go(n.view);
              }}
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-5 text-sm font-semibold transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <n.icon className="size-6 text-brand-ink" />
              {n.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMoreOpen(false);
              lock();
            }}
            className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-5 text-sm font-semibold transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <Lock className="size-6 text-brand-ink" />
            Lock / switch user
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Surface sync conflicts/merges as toasts once. */
function useNoticeToasts() {
  const notices = useNotices();
  const toast = useToast();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!notices) return;
    for (const n of notices) {
      if (n.read || seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.kind === "rejected") toast.error(n.message);
      else if (n.kind === "merged" || n.kind === "reset") toast.warning(n.message);
      else toast.info(n.message);
      db.notices.update(n.id, { read: true });
    }
  }, [notices, toast]);
}
