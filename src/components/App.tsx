"use client";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart3,
  Coffee,
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
import { Button, ConfirmProvider, Field, Input, Modal, Spinner, ToastProvider, cx, useToast } from "./ui";
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
    const stop = startSync();
    navigator.storage?.persist?.().catch(() => {});
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    return stop;
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

function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center justify-center rounded-2xl bg-brand text-on-brand shadow-glow", className)}>
      <Coffee className="size-1/2" strokeWidth={2.2} />
    </div>
  );
}

/** Warm ambient light + grain behind every screen. */
function Ambient() {
  return (
    <div className="ambient" aria-hidden>
      <div className="grain" />
    </div>
  );
}

/** A cup with rising steam: the login screen's one animated moment. */
function SteamingCup() {
  return (
    <div className="relative h-40 w-44" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute bottom-24 h-14 w-2.5 rounded-full bg-gradient-to-t from-brand/50 to-transparent blur-[3px]"
          style={{ left: 58 + i * 22, animation: "steam 3.2s ease-out " + i * 0.9 + "s infinite" }}
        />
      ))}
      <svg viewBox="0 0 176 120" className="absolute bottom-0 w-44">
        <ellipse cx="80" cy="112" rx="72" ry="7" fill="var(--brand)" opacity="0.18" />
        <path d="M24 34h112v34a46 46 0 0 1-46 46H70a46 46 0 0 1-46-46z" fill="var(--surface-3)" stroke="var(--brand)" strokeWidth="3" />
        <path d="M136 46h10a18 18 0 0 1 0 36h-12" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="80" cy="34" rx="56" ry="9" fill="var(--brand)" opacity="0.9" />
        <ellipse cx="80" cy="33" rx="40" ry="5" fill="var(--on-brand)" opacity="0.25" />
      </svg>
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
    <div className="relative flex min-h-dvh items-center justify-center p-4">
      <Ambient />
      <div className="anim-rise relative z-10 w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-4 size-16" />
          <h1 className="display text-2xl font-semibold">Set up this device</h1>
          <p className="mt-1 text-[15px] text-muted">Connect this tablet, phone or computer to your store. You only need to do this once.</p>
        </div>
        <div className="glass space-y-4 rounded-[2rem] border border-line p-6 shadow-pop">
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
              {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
              <Button variant="primary" size="lg" block loading={busy} disabled={!accessCode.trim() || !online} onClick={connect}>
                {online ? "Connect device" : "Offline — connect later"}
              </Button>
              <div className="relative py-1 text-center text-xs text-muted">
                <span className="relative z-10 bg-surface px-2">or</span>
                <span className="absolute inset-x-0 top-1/2 border-t border-line" />
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

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Ambient />
      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
        <section className="hidden flex-col justify-between p-12 lg:flex">
          <div className="flex items-center gap-3">
            <Logo className="size-12" />
            <div>
              <p className="display text-lg font-semibold">{settings?.businessName ?? "POS"}</p>
              <p className="text-sm text-muted">Point of sale</p>
            </div>
          </div>
          <div className="anim-rise">
            <SteamingCup />
            <p className="mt-6 text-lg text-ink-2">{greeting(now)}</p>
            <p className="display text-[clamp(4rem,9vw,7.5rem)] font-semibold leading-none">
              {now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="mt-3 text-xl text-muted">{now?.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
            {service && (
              <div className="mt-8 flex flex-wrap gap-3">
                <ServiceStat value={service.open} label={service.open === 1 ? "open check" : "open checks"} />
                <ServiceStat value={service.kitchen} label="in the kitchen" />
                <ServiceStat value={service.ready} label="ready to serve" />
              </div>
            )}
          </div>
          <p className="text-sm text-muted">Works offline · syncs across every device in the store</p>
        </section>

        <section className="flex flex-col items-center justify-center p-6">
          <div className="glass anim-rise w-full max-w-[400px] rounded-[2rem] border border-line p-7 shadow-pop">
            <div className="mb-6 flex flex-col items-center text-center lg:hidden">
              <Logo className="mb-3 size-14" />
              <p className="display text-lg font-semibold">{settings?.businessName ?? "POS"}</p>
              <p className="display mt-2 text-4xl font-semibold">{now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            </div>
            <h1 className="text-center text-2xl font-bold">Enter your PIN</h1>
            <p className="mb-5 mt-1 text-center text-muted">Tap your 4-digit staff PIN to start your shift</p>
            {staffCount === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center text-muted">
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
          </div>
          {demo && (
            <div className="mt-5 max-w-[400px] rounded-2xl border border-dashed border-line-strong px-4 py-3 text-center text-sm text-muted">
              <p className="font-semibold text-ink-2">Demo PINs</p>
              Admin <b className="tabular text-ink">{DEFAULT_PINS.admin}</b> · Manager <b className="tabular text-ink">{DEFAULT_PINS.manager}</b> · Cashier{" "}
              <b className="tabular text-ink">{DEFAULT_PINS.cashier}</b> · Kitchen <b className="tabular text-ink">{DEFAULT_PINS.kitchen}</b>
              <p className="mt-1 text-xs">Change the admin PIN in Settings → Staff to hide this.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ServiceStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="glass min-w-28 rounded-2xl border border-line px-4 py-3">
      <p className="display text-3xl font-semibold text-brand-ink">{value}</p>
      <p className="text-sm text-muted">{label}</p>
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
    <div className="relative flex h-dvh overflow-hidden">
      <Ambient />
      {/* Desktop / landscape tablet rail */}
      <nav className="glass relative z-10 hidden w-[92px] shrink-0 flex-col items-center gap-1.5 border-r border-line py-4 lg:flex">
        <Logo className="mb-4 size-12" />
        {items.map((n) => {
          const on = active === n.view;
          return (
            <button
              key={n.view}
              onClick={() => go(n.view)}
              aria-current={on ? "page" : undefined}
              className={cx(
                "relative flex w-[74px] flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-semibold transition",
                on ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-surface-3/70 hover:text-ink",
              )}
            >
              <n.icon className="size-[22px]" strokeWidth={on ? 2.4 : 2} />
              {n.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={lock} className="flex w-[72px] flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-semibold text-muted transition hover:bg-surface-3 hover:text-ink">
          <Lock className="size-[22px]" />
          Lock
        </button>
      </nav>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass flex min-h-15 shrink-0 items-center gap-3 border-b border-line px-3 pt-[env(safe-area-inset-top)] sm:px-5">
          <Logo className="size-9 lg:hidden" />
          <div className="min-w-0 flex-1">
            <p className="display truncate text-[15px] font-semibold leading-tight">{settings.businessName}</p>
            <p className="truncate text-xs text-muted">
              {staff.name} · {ROLE_LABEL[staff.role]}
            </p>
          </div>
          <SyncIndicator />
          <button onClick={lock} className="hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3 sm:flex lg:hidden" aria-label="Lock">
            <Lock className="size-4" /> Lock
          </button>
        </header>
        {!online && (
          <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-center text-[13px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            <Wifi className="size-4" />
            Offline — everything is saved on this device{pending ? ` (${pending} change${pending === 1 ? "" : "s"} waiting)` : ""} and will sync automatically.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">{content}</main>

        {/* Phone / portrait tablet tab bar */}
        {items.length > 1 && (
          <nav className="glass flex shrink-0 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden">
            {primary.map((n) => (
              <button
                key={n.view}
                onClick={() => go(n.view)}
                className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", active === n.view ? "text-brand-ink" : "text-muted")}
              >
                <n.icon className="size-[22px]" />
                {n.label}
              </button>
            ))}
            {(secondary.length > 0 || true) && (
              <button onClick={() => setMoreOpen(true)} className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", secondary.some((s) => s.view === active) ? "text-brand" : "text-muted")}>
                <MoreHorizontal className="size-[22px]" />
                More
              </button>
            )}
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
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface-2 py-5 text-sm font-semibold hover:bg-surface-3"
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
            className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface-2 py-5 text-sm font-semibold hover:bg-surface-3"
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
