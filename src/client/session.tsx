"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Delete, ShieldCheck } from "lucide-react";
import { db, setMeta, stripLocal } from "./db";
import { defaultSettings, findStaffByPin, type DeviceInfo } from "./repo";
import type { Order, Role, Settings, Staff } from "@/lib/types";
import { Modal, cx } from "@/components/ui";

export type View = "register" | "checkout" | "orders" | "tables" | "kitchen" | "menu" | "reports" | "settings";

export type Perm =
  | "register"
  | "orders"
  | "tables"
  | "kitchen"
  | "menu"
  | "reports"
  | "settings"
  | "staff"
  | "approve";

const ROLE_PERMS: Record<Role, Perm[]> = {
  admin: ["register", "orders", "tables", "kitchen", "menu", "reports", "settings", "staff", "approve"],
  manager: ["register", "orders", "tables", "kitchen", "menu", "reports", "settings", "approve"],
  cashier: ["register", "orders", "tables", "kitchen"],
  kitchen: ["kitchen"],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier / Server",
  kitchen: "Kitchen",
};

export function roleCan(role: Role, p: Perm) {
  return ROLE_PERMS[role].includes(p);
}

interface Ctx {
  device: DeviceInfo;
  staff: Staff;
  settings: Settings;
  view: View;
  go: (v: View, opts?: { orderId?: string | null }) => void;
  activeOrderId: string | null;
  setActiveOrderId: (id: string | null) => void;
  /** Preset applied to the next new (unsaved) order, e.g. a table chosen on the floor plan. */
  draftPreset: Partial<Order> | null;
  startNewOrder: (preset?: Partial<Order>) => void;
  can: (p: Perm) => boolean;
  /** Resolves with the approving manager, or null if cancelled. Managers approve themselves. */
  requestApproval: (action: string) => Promise<Staff | null>;
  lock: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}

export function useSettings(): Settings {
  return useSession().settings;
}

const ACTIVE_KEY = "pos:activeOrder";
const VIEW_KEY = "pos:view";

export function SessionProvider({ device, staff, children }: { device: DeviceInfo; staff: Staff; children: ReactNode }) {
  const settingsRow = useLiveQuery(() => db.settings.get("store"), []);
  const settings = useMemo(() => (settingsRow ? stripLocal(settingsRow) : defaultSettings()), [settingsRow]);

  const defaultView: View = staff.role === "kitchen" ? "kitchen" : "register";
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return defaultView;
    const v = sessionStorage.getItem(VIEW_KEY) as View | null;
    return v && roleCan(staff.role, v === "checkout" ? "register" : (v as Perm)) ? v : defaultView;
  });
  const [activeOrderId, setActive] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(ACTIVE_KEY),
  );

  const setActiveOrderId = useCallback((id: string | null) => {
    setActive(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {}
  }, []);

  const go = useCallback(
    (v: View, opts?: { orderId?: string | null }) => {
      if (opts && "orderId" in opts) setActiveOrderId(opts.orderId ?? null);
      setView(v);
      try {
        sessionStorage.setItem(VIEW_KEY, v);
      } catch {}
      window.scrollTo?.(0, 0);
    },
    [setActiveOrderId],
  );

  const [draftPreset, setDraftPreset] = useState<Partial<Order> | null>(null);
  const startNewOrder = useCallback(
    (preset?: Partial<Order>) => {
      setDraftPreset(preset ?? null);
      go("register", { orderId: null });
    },
    [go],
  );

  // Approval flow
  const [approval, setApproval] = useState<{ action: string; resolve: (s: Staff | null) => void } | null>(null);
  const requestApproval = useCallback(
    (action: string) => {
      if (roleCan(staff.role, "approve")) return Promise.resolve(staff);
      return new Promise<Staff | null>((resolve) => setApproval({ action, resolve }));
    },
    [staff],
  );

  const lock = useCallback(() => {
    setMeta("session", null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      device,
      staff,
      settings,
      view,
      go,
      activeOrderId,
      setActiveOrderId,
      draftPreset,
      startNewOrder,
      can: (p) => roleCan(staff.role, p),
      requestApproval,
      lock,
    }),
    [device, staff, settings, view, go, activeOrderId, setActiveOrderId, draftPreset, startNewOrder, requestApproval, lock],
  );

  return (
    <SessionCtx.Provider value={value}>
      {children}
      <ApprovalModal
        request={approval}
        onDone={(s) => {
          approval?.resolve(s);
          setApproval(null);
        }}
      />
    </SessionCtx.Provider>
  );
}

function ApprovalModal({ request, onDone }: { request: { action: string } | null; onDone: (s: Staff | null) => void }) {
  const [error, setError] = useState("");
  useEffect(() => setError(""), [request]);
  return (
    <Modal
      open={!!request}
      onClose={() => onDone(null)}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-amber-500" /> Manager approval
        </span>
      }
      subtitle={request?.action}
    >
      <PinPad
        key={request?.action}
        error={error}
        onComplete={async (pin) => {
          const s = await findStaffByPin(pin);
          if (!s) {
            setError("PIN not recognised");
            return false;
          }
          if (!roleCan(s.role, "approve")) {
            setError(`${s.name} can't approve this — a manager or admin is required`);
            return false;
          }
          onDone(s);
          return true;
        }}
      />
    </Modal>
  );
}

export function PinPad({
  onComplete,
  error,
  length = 4,
  maxLength = 4,
}: {
  onComplete: (pin: string) => Promise<boolean>;
  error?: string;
  length?: number;
  maxLength?: number;
}) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const busy = useRef(false);

  const submit = useCallback(
    async (p: string) => {
      if (busy.current) return;
      busy.current = true;
      const ok = await onComplete(p);
      busy.current = false;
      if (!ok) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setPin("");
      }
    },
    [onComplete],
  );

  const press = useCallback(
    (k: string) => {
      setPin((p) => {
        if (k === "back") return p.slice(0, -1);
        if (k === "clear") return "";
        if (k === "ok") {
          if (p.length >= length) void submit(p);
          return p;
        }
        if (p.length >= maxLength) return p;
        return p + k;
      });
    },
    [length, maxLength, submit],
  );

  // Auto-submit at 4 digits (most PINs); longer PINs use the ✓ key.
  useEffect(() => {
    if (pin.length === length) {
      const t = setTimeout(() => void submit(pin), 120);
      return () => clearTimeout(t);
    }
  }, [pin, length, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") press("ok");
      else if (e.key === "Escape") press("clear");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className={cx("mb-2 flex h-12 items-center justify-center gap-3", shake && "animate-[shake_0.35s]")} style={shake ? { animation: "shake .35s" } : undefined}>
        {Array.from({ length: Math.max(length, pin.length) }).map((_, i) => (
          <span key={i} className={cx("size-4 rounded-full border-2 transition", i < pin.length ? "border-brand bg-brand" : "border-line-strong")} />
        ))}
      </div>
      <p className="mb-3 h-5 text-center text-sm font-medium text-rose-600">{error}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={cx(
              "flex h-16 items-center justify-center rounded-2xl text-2xl font-semibold transition active:scale-95",
              k === "clear" || k === "back" ? "text-base text-muted hover:bg-surface-3" : "bg-surface-3 text-ink hover:bg-line",
            )}
          >
            {k === "back" ? <Delete className="size-6" /> : k === "clear" ? "Clear" : k}
          </button>
        ))}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:none}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}
