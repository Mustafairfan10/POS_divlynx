"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ Button

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "warning" | "outline";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "bg-surface-3 text-ink hover:bg-line",
  outline: "border border-line-strong bg-surface text-ink hover:border-brand-ink/50 hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
  danger: "bg-bad text-surface hover:brightness-110",
  success: "bg-ok text-surface hover:brightness-110",
  warning: "bg-warn text-surface hover:brightness-110",
};
const SIZE: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-[15px] gap-2 rounded-lg",
  lg: "h-13 px-5 text-base gap-2 rounded-xl",
  xl: "h-16 px-6 text-lg gap-2.5 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  block,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-[background,border-color,transform,opacity,filter] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95 disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Inputs

export function Field({ label, hint, error, children, className }: { label?: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1 block text-sm font-medium text-bad">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs leading-relaxed text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted outline-none transition focus:border-brand focus:ring-3 focus:ring-[var(--ring)] disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(inputCls, "h-11", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(inputCls, "min-h-20 py-2.5", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(inputCls, "h-11 pr-8", className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-lg py-1 text-left disabled:opacity-50"
    >
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[15px] font-semibold text-ink">{label}</span>}
          {description && <span className="block text-sm text-muted">{description}</span>}
        </span>
      )}
      <span className={cx("relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors duration-150", checked ? "bg-brand" : "bg-line-strong")}>
        <span className={cx("absolute top-0.5 size-6 rounded-full bg-surface shadow-card transition-[left] duration-150", checked ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }>;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("flex divide-x divide-line-strong overflow-hidden rounded-lg border border-line-strong bg-surface", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 font-semibold transition-colors duration-150 disabled:opacity-40",
            size === "sm" ? "h-8 px-2 text-[13px]" : "h-10 px-3 text-sm",
            value === o.value ? "bg-brand text-on-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Badge

const TONES = {
  gray: "bg-surface-3 text-ink-2",
  brand: "bg-brand-soft text-brand-ink",
  green: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-bad-soft text-bad",
  blue: "bg-info-soft text-info",
  violet: "bg-pen-soft text-pen",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("rounded-xl border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

/** Condensed printed column head, as on a guest check (QTY · ITEM · AMOUNT). */
export function ColHead({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("cond text-[11px] text-brand-ink", className)}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 flex size-12 items-center justify-center rounded-full border border-dashed border-line-strong text-muted">{icon}</div>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Modal (dialog on desktop, bottom sheet on phones)

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);
  if (!open || !mounted) return null;
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-[#0b120e]/50" onClick={dismissable ? onClose : undefined} />
      <div
        className={cx(
          "anim-sheet sm:anim-pop relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl",
          width,
        )}
      >
        {(title || dismissable) && (
          <div className="flex items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-lg font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {dismissable && (
              <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
                <X className="size-5" />
              </IconButton>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Toasts

type ToastKind = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: ReactNode;
}
const ToastCtx = createContext<(kind: ToastKind, message: ReactNode) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const push = useCallback((kind: ToastKind, message: ReactNode) => {
    const id = ++idRef.current;
    setItems((x) => [...x.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  const icon = {
    success: <CheckCircle2 className="size-5 text-ok" />,
    error: <XCircle className="size-5 text-bad" />,
    info: <Info className="size-5 text-info" />,
    warning: <AlertTriangle className="size-5 text-warn" />,
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className="anim-pop pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-[15px] font-medium text-ink shadow-pop"
            onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}
          >
            <span className="mt-0.5 shrink-0">{icon[t.kind]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(
    () => ({
      success: (m: ReactNode) => push("success", m),
      error: (m: ReactNode) => push("error", m),
      info: (m: ReactNode) => push("info", m),
      warning: (m: ReactNode) => push("warning", m),
    }),
    [push],
  );
}

// ------------------------------------------------------------------ Confirm / prompt dialogs

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary" | "warning";
  /** When set, the user must type/select a reason. */
  reason?: { label: string; options?: string[]; required?: boolean };
}
type ConfirmResult = { ok: boolean; reason: string };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<ConfirmResult>>(async () => ({ ok: false, reason: "" }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const ask = useCallback(
    (o: ConfirmOpts) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason("");
        setCustom("");
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    if (!state) return;
    const r = reason === "__other" ? custom.trim() : reason.trim();
    state.resolve({ ok, reason: r });
    setState(null);
  };
  const needReason = state?.reason?.required !== false && !!state?.reason;
  const finalReason = reason === "__other" ? custom.trim() : reason.trim();
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {state?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={state?.tone === "danger" ? "danger" : state?.tone === "warning" ? "warning" : "primary"}
              disabled={needReason && !finalReason}
              onClick={() => close(true)}
            >
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {state?.message && <div className="text-[15px] text-ink-2">{state.message}</div>}
        {state?.reason && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-ink-2">{state.reason.label}</p>
            {state.reason.options ? (
              <div className="flex flex-wrap gap-2">
                {[...state.reason.options, "__other"].map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setReason(o)}
                    className={cx(
                      "rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
                      reason === o ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line-strong text-ink-2 hover:bg-surface-2",
                    )}
                  >
                    {o === "__other" ? "Other…" : o}
                  </button>
                ))}
              </div>
            ) : null}
            {(!state.reason.options || reason === "__other") && (
              <Input autoFocus placeholder="Type a reason" value={state.reason.options ? custom : reason} onChange={(e) => (state.reason?.options ? setCustom(e.target.value) : setReason(e.target.value))} />
            )}
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

// ------------------------------------------------------------------ Number keypad

export function Keypad({ onKey, className, decimal = true }: { onKey: (k: string) => void; className?: string; decimal?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "." : "C", "0", "⌫"];
  return (
    <div className={cx("grid grid-cols-3 gap-2", className)}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className="h-14 rounded-lg border border-line bg-surface text-xl font-semibold tabular-nums text-ink transition hover:bg-surface-2 active:scale-95 active:bg-surface-3"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-muted", className)} />;
}

/** Guards an async action against double taps: returns [run, busy]. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  return [run, busy] as const;
}
