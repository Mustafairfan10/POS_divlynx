"use client";
import { db, getMeta, setMeta, stripLocal, type OutboxEntry } from "./db";
import { uid } from "@/lib/format";
import {
  ENTITIES,
  type EntityName,
  type Mutation,
  type PullResponse,
  type PushResponse,
  type RegisterResponse,
} from "@/lib/types";
import type { DeviceInfo } from "./repo";

/**
 * Offline-first sync engine.
 *
 *  - Every local write lands in IndexedDB + an outbox entry in the same transaction.
 *  - push: outbox → /api/sync/push. Each mutation carries a unique id, so retries after a
 *    timeout or crash are idempotent on the server (no duplicate orders/payments).
 *  - pull: /api/sync/pull?cursor=N returns everything changed since N in commit order.
 *  - Only one tab per browser syncs at a time (Web Locks), others see results via IndexedDB.
 *  - Failures back off exponentially (2s → 60s) and resume on reconnect / app restart.
 */

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error" | "unpaired" | "unauthorized";
  lastSyncAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
}

const MAX_ATTEMPTS = 5;
const PUSH_BATCH = 50;
const REQUEST_TIMEOUT = 15_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let started = false;
let inFlight: Promise<void> | null = null;

async function setStatus(patch: Partial<SyncStatus>) {
  const cur = (await getMeta<SyncStatus>("syncStatus")) ?? { state: "idle" };
  await setMeta("syncStatus", { ...cur, ...patch });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {}
      throw new HttpError(res.status, msg);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Request timed out");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function addNotice(kind: "merged" | "rejected" | "reset" | "info", message: string) {
  await db.notices.put({ id: uid(), at: Date.now(), kind, message, read: false });
}

async function pushOnce(token: string): Promise<number> {
  const all = await db.outbox.orderBy("seq").toArray();
  const batch = all.filter((e) => e.attempts < MAX_ATTEMPTS).slice(0, PUSH_BATCH);
  if (!batch.length) return 0;

  const mutations: Mutation[] = batch.map((e) => ({
    mutationId: e.mutationId,
    entity: e.entity,
    recordId: e.recordId,
    baseVersion: e.baseVersion,
    data: e.data,
  }));

  const res = await api<PushResponse>("/api/sync/push", token, {
    method: "POST",
    body: JSON.stringify({ mutations }),
  });

  const sent = new Map(batch.map((e) => [e.mutationId, e]));
  await db.transaction("rw", [db.outbox, db.notices, ...db.entityTables()], async () => {
    for (const r of res.results) {
      const sentEntry = sent.get(r.mutationId);
      if (!sentEntry) continue;
      const key = sentEntry.key;
      const current = await db.outbox.get(key);
      const table = db.raw(r.entity);

      if (r.status === "rejected") {
        if (current && current.mutationId === r.mutationId) {
          await db.outbox.put({ ...current, attempts: MAX_ATTEMPTS, lastError: r.error ?? "Rejected by server" });
        }
        await addNotice("rejected", `A ${r.entity} change was rejected by the server: ${r.error ?? "unknown error"}`);
        continue;
      }

      const merged = !!r.data;
      if (current && current.mutationId === r.mutationId) {
        // Nothing changed locally while the request was in flight.
        await db.outbox.delete(key);
        const local = await table.get(r.recordId);
        if (merged && r.data) await table.put({ ...r.data, _v: r.version });
        else if (local) await table.put({ ...local, _v: r.version });
      } else if (current) {
        // The record was edited again while in flight. If our earlier write applied cleanly,
        // the newer edit is now based on the version the server just stored.
        if (!merged) await db.outbox.put({ ...current, baseVersion: r.version });
      }
      if (merged && r.entity === "orders") {
        const num = (r.data as { number?: string }).number;
        await addNotice("merged", `Order #${num ?? r.recordId.slice(0, 6)} was also changed on another device — changes were merged.`);
      }
    }
  });
  return batch.length;
}

async function pullAll(token: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const cursor = (await getMeta<number>("cursor")) ?? 0;
    const res = await api<PullResponse>(`/api/sync/pull?cursor=${cursor}`, token);

    if (res.maxSeq < cursor) {
      // The server lost data (e.g. non-durable storage was reset). Re-upload everything we have.
      await resyncAllLocal();
      await addNotice("reset", "The server was reset. This device is re-uploading its data.");
      return;
    }

    await db.transaction("rw", [db.outbox, db.meta, ...db.entityTables()], async () => {
      for (const rec of res.records) {
        const pending = await db.outbox.get(`${rec.entity}:${rec.id}`);
        // Local unsynced edits win locally; the server merges them on the next push.
        if (pending) continue;
        const table = db.raw(rec.entity);
        const local = await table.get(rec.id);
        if (local && local._v >= rec.version) continue;
        await table.put({ ...rec.data, _v: rec.version });
      }
      await setMeta("cursor", res.cursor);
    });
    if (!res.hasMore) return;
  }
}

/** Queue every local record for upload as if new (used after a server reset or re-pair). */
export async function resyncAllLocal(): Promise<void> {
  await db.transaction("rw", [db.outbox, db.meta, ...db.entityTables()], async () => {
    let seq = Date.now() * 1000;
    for (const entity of ENTITIES) {
      const rows = await db.raw(entity).toArray();
      for (const row of rows) {
        await db.raw(entity).put({ ...row, _v: 0 });
        const key = `${entity}:${row.id}`;
        const existing = await db.outbox.get(key);
        const entry: OutboxEntry = {
          key,
          seq: existing?.seq ?? seq++,
          mutationId: uid(),
          entity: entity as EntityName,
          recordId: row.id,
          baseVersion: 0,
          data: stripLocal(row),
          attempts: 0,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        await db.outbox.put(entry);
      }
    }
    await setMeta("cursor", 0);
  });
}

async function runCycle(): Promise<void> {
  const device = await getMeta<DeviceInfo>("device");
  if (!device) return;
  if (!device.token) {
    await setStatus({ state: "unpaired" });
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await setStatus({ state: "offline", lastError: "No network connection" });
    failures = Math.min(failures + 1, 5);
    return;
  }
  await setStatus({ state: "syncing", lastAttemptAt: Date.now() });
  try {
    for (let i = 0; i < 20; i++) {
      const n = await pushOnce(device.token);
      if (n < PUSH_BATCH) break;
    }
    await pullAll(device.token);
    // Anything queued during the pull (or by a server reset) goes out immediately.
    await pushOnce(device.token);
    failures = 0;
    await setStatus({ state: "idle", lastSyncAt: Date.now(), lastError: undefined });
  } catch (e) {
    failures++;
    if (e instanceof HttpError && e.status === 401) {
      await setStatus({ state: "unauthorized", lastError: "This device is no longer authorized. Pair it again in Settings." });
    } else {
      const offline = e instanceof TypeError || (e as Error).message === "Request timed out";
      await setStatus({ state: offline ? "offline" : "error", lastError: (e as Error).message });
    }
  }
}

async function cycle(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (typeof navigator !== "undefined" && "locks" in navigator) {
        await navigator.locks.request("pos-sync", { ifAvailable: true }, async (lock) => {
          if (lock) await runCycle();
        });
      } else {
        await runCycle();
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await cycle();
    schedule(nextDelay());
  }, ms);
}

function nextDelay(): number {
  if (failures > 0) return Math.min(60_000, 2_000 * 2 ** (failures - 1));
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return 20_000;
  return 5_000;
}

/** Trigger a sync soon (debounced) — called after every local write. */
export function requestSync(delay = 300) {
  if (!started) return;
  schedule(delay);
}

export function syncNow(): Promise<void> {
  failures = 0;
  return cycle();
}

export function startSync(): () => void {
  if (started) return () => {};
  started = true;
  const onOnline = () => {
    failures = 0;
    schedule(100);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule(100);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", () => setStatus({ state: "offline" }));
  document.addEventListener("visibilitychange", onVisible);
  schedule(50);
  return () => {
    started = false;
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Retry mutations that previously failed permanently. */
export async function retryFailed(): Promise<void> {
  const failed = (await db.outbox.toArray()).filter((e) => e.attempts >= MAX_ATTEMPTS);
  await db.outbox.bulkPut(failed.map((e) => ({ ...e, attempts: 0, lastError: undefined, mutationId: uid() })));
  await syncNow();
}

export async function discardFailed(): Promise<void> {
  const failed = (await db.outbox.toArray()).filter((e) => e.attempts >= MAX_ATTEMPTS);
  await db.outbox.bulkDelete(failed.map((e) => e.key));
}

export async function registerWithServer(accessCode: string, deviceId: string, deviceName: string): Promise<RegisterResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch("/api/devices/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode, deviceId, deviceName }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Server error (${res.status})`);
    return body as RegisterResponse;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Server did not respond. Check your connection.");
    if (e instanceof TypeError) throw new Error("Cannot reach the server. Check your internet connection.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export { MAX_ATTEMPTS };
