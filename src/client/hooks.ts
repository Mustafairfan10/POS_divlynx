"use client";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getMeta, stripLocal, type Notice } from "./db";
import type { SyncStatus } from "./sync";
import type { Category, DiningTable, MenuItem, ModifierGroup, Order, Payment, Staff } from "@/lib/types";

const alive = <T extends { deleted?: boolean }>(x: T) => !x.deleted;

export function useCategories(): Category[] | undefined {
  return useLiveQuery(async () => (await db.categories.orderBy("sort").toArray()).filter(alive).map(stripLocal), []);
}

export function useMenuItems(): MenuItem[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.menuItems.toArray())
        .filter(alive)
        .map(stripLocal)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    [],
  );
}

export function useModifierGroups(): ModifierGroup[] | undefined {
  return useLiveQuery(async () => (await db.modifierGroups.toArray()).filter(alive).map(stripLocal).sort((a, b) => a.name.localeCompare(b.name)), []);
}

export function useTables(): DiningTable[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.diningTables.toArray())
        .filter(alive)
        .map(stripLocal)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, undefined, { numeric: true })),
    [],
  );
}

export function useStaffList(): Staff[] | undefined {
  return useLiveQuery(async () => (await db.staff.toArray()).filter(alive).map(stripLocal).sort((a, b) => a.name.localeCompare(b.name)), []);
}

// Live queries keep returning the previous result for a moment after their deps change.
// Tag results with the id they were computed for, so callers never see another order's data.

export function useOrder(id: string | null | undefined): Order | null | undefined {
  const res = useLiveQuery(async () => {
    if (!id) return { id, value: null };
    const o = await db.orders.get(id);
    return { id, value: o && !o.deleted ? stripLocal(o) : null };
  }, [id]);
  return res && res.id === id ? res.value : undefined;
}

export function useOrderPayments(orderId: string | null | undefined): Payment[] | undefined {
  const res = useLiveQuery(async () => {
    if (!orderId) return { id: orderId, value: [] as Payment[] };
    const value = (await db.payments.where("orderId").equals(orderId).toArray())
      .filter(alive)
      .map(stripLocal)
      .sort((a, b) => a.createdAt - b.createdAt);
    return { id: orderId, value };
  }, [orderId]);
  return res && res.id === orderId ? res.value : undefined;
}

export function useOpenOrders(): Order[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.orders.where("status").equals("open").toArray())
        .filter(alive)
        .map(stripLocal)
        .sort((a, b) => a.createdAt - b.createdAt),
    [],
  );
}

export function useOrdersSince(since: number, until = Number.MAX_SAFE_INTEGER): Order[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.orders.where("createdAt").between(since, until, true, true).toArray())
        .filter(alive)
        .map(stripLocal)
        .sort((a, b) => b.createdAt - a.createdAt),
    [since, until],
  );
}

export function usePaymentsSince(since: number, until = Number.MAX_SAFE_INTEGER): Payment[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.payments.where("createdAt").between(since, until, true, true).toArray()).filter(alive).map(stripLocal),
    [since, until],
  );
}

/** All payments for a set of order ids (for order lists). */
export function usePaymentsByOrders(orderIds: string[] | undefined): Map<string, Payment[]> | undefined {
  const key = orderIds?.join(",") ?? "";
  return useLiveQuery(async () => {
    const map = new Map<string, Payment[]>();
    if (!orderIds?.length) return map;
    const rows = await db.payments.where("orderId").anyOf(orderIds).toArray();
    for (const p of rows) {
      if (p.deleted) continue;
      const arr = map.get(p.orderId) ?? [];
      arr.push(stripLocal(p));
      map.set(p.orderId, arr);
    }
    return map;
  }, [key]);
}

export function useSyncStatus() {
  const status = useLiveQuery(() => getMeta<SyncStatus>("syncStatus"), []);
  const pending = useLiveQuery(() => db.outbox.count(), []);
  const failed = useLiveQuery(async () => (await db.outbox.toArray()).filter((e) => e.attempts >= 5), []);
  return { status: status ?? { state: "idle" as const }, pending: pending ?? 0, failed: failed ?? [] };
}

export function useNotices(): Notice[] | undefined {
  return useLiveQuery(() => db.notices.orderBy("at").reverse().limit(50).toArray(), []);
}

/** Re-render every `ms` (for timers / "x minutes ago"). */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    setM(mq.matches);
    const fn = () => setM(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [q]);
  return m;
}
