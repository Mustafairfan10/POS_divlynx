"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useNow, useSyncStatus } from "@/client/hooks";
import { syncNow } from "@/client/sync";
import { useSession } from "@/client/session";
import { timeAgo } from "@/lib/format";
import { Button, Modal, cx } from "./ui";

export function SyncIndicator() {
  const { status, pending, failed } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { can, go } = useSession();
  const now = useNow(10_000);

  let tone = "border-transparent text-ok";
  let icon = <CheckCircle2 className="size-4" />;
  let label = "Synced";
  if (status.state === "syncing") {
    tone = "border-transparent text-info";
    icon = <Loader2 className="size-4 animate-spin" />;
    label = "Syncing";
  } else if (status.state === "offline") {
    tone = "border-warn-line bg-warn-soft text-warn";
    icon = <CloudOff className="size-4" />;
    label = "Offline";
  } else if (status.state === "error" || status.state === "unauthorized" || failed.length) {
    tone = "border-transparent bg-bad-soft text-bad";
    icon = <AlertTriangle className="size-4" />;
    label = status.state === "unauthorized" ? "Not paired" : "Sync issue";
  } else if (status.state === "unpaired") {
    tone = "border-dashed border-line-strong text-ink-2";
    icon = <CloudOff className="size-4" />;
    label = "Local only";
  } else if (pending > 0) {
    tone = "border-dashed border-info text-info";
    icon = <RefreshCw className="size-4" />;
    label = "Pending";
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={cx("flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold transition-colors hover:bg-surface-2", tone)}>
        {icon}
        <span className="hidden sm:inline">{label}</span>
        {pending > 0 && <span className="tabular">{pending}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sync status" size="sm"
        footer={
          <>
            {can("settings") && (
              <Button variant="ghost" onClick={() => { setOpen(false); go("settings"); }}>
                Sync settings
              </Button>
            )}
            <Button
              variant="primary"
              loading={busy}
              icon={<RefreshCw className="size-4" />}
              onClick={async () => {
                setBusy(true);
                await syncNow();
                setBusy(false);
              }}
            >
              Sync now
            </Button>
          </>
        }
      >
        <dl className="space-y-3 text-[15px]">
          <Row label="Status" value={<span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm font-semibold", tone)}>{icon}{label}</span>} />
          <Row label="Waiting to upload" value={`${pending} change${pending === 1 ? "" : "s"}`} />
          <Row label="Last successful sync" value={status.lastSyncAt ? `${timeAgo(status.lastSyncAt, now)} ago` : "Never"} />
          {failed.length > 0 && <Row label="Failed changes" value={<span className="font-semibold text-bad">{failed.length}</span>} />}
          {status.lastError && status.state !== "idle" && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">{status.lastError}</p>
          )}
          <p className="text-sm text-muted">
            Orders and payments are always saved on this device first. They upload automatically when the connection is available — nothing is lost if the
            internet drops or the app is closed.
          </p>
        </dl>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
