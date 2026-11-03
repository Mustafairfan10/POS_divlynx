"use client";
import Dexie, { type Table } from "dexie";
import { ENTITIES, type BaseRecord, type EntityMap, type EntityName } from "@/lib/types";

/** IndexedDB store name for an entity ("tables" clashes with Dexie#tables). */
export function storeName(e: EntityName): string {
  return e === "tables" ? "diningTables" : e;
}

/** A locally stored record plus the server version it was last based on. */
export type Local<T> = T & { _v: number };

export interface OutboxEntry {
  key: string; // `${entity}:${recordId}` — one pending mutation per record (coalesced)
  seq: number;
  mutationId: string;
  entity: EntityName;
  recordId: string;
  baseVersion: number;
  data: BaseRecord;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface Notice {
  id: string;
  at: number;
  kind: "merged" | "rejected" | "reset" | "info";
  message: string;
  read: boolean;
}

class PosDB extends Dexie {
  settings!: Table<Local<EntityMap["settings"]>, string>;
  categories!: Table<Local<EntityMap["categories"]>, string>;
  modifierGroups!: Table<Local<EntityMap["modifierGroups"]>, string>;
  menuItems!: Table<Local<EntityMap["menuItems"]>, string>;
  staff!: Table<Local<EntityMap["staff"]>, string>;
  orders!: Table<Local<EntityMap["orders"]>, string>;
  payments!: Table<Local<EntityMap["payments"]>, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaEntry, string>;
  notices!: Table<Notice, string>;

  constructor() {
    super("pos-db");
    this.version(1).stores({
      settings: "id",
      categories: "id, sort",
      modifierGroups: "id",
      menuItems: "id, categoryId, sort",
      diningTables: "id, sort",
      staff: "id",
      orders: "id, status, createdAt, updatedAt, tableId, number",
      payments: "id, orderId, createdAt",
      outbox: "key, seq",
      meta: "key",
      notices: "id, at",
    });
  }

  /** The dining-tables store (dining tables). `Dexie#tables` is a reserved property, hence the getter. */
  get diningTables(): Table<Local<EntityMap["tables"]>, string> {
    return this.table("diningTables") as Table<Local<EntityMap["tables"]>, string>;
  }

  /** Local store for a sync entity. */
  entity<E extends EntityName>(name: E): Table<Local<EntityMap[E]>, string> {
    return this.table(storeName(name)) as Table<Local<EntityMap[E]>, string>;
  }

  /** Untyped access for generic sync code that handles every entity the same way. */
  raw(name: EntityName): Table<Local<BaseRecord>, string> {
    return this.table(storeName(name)) as Table<Local<BaseRecord>, string>;
  }

  /** All entity stores (for multi-table transactions). */
  entityTables(): Table[] {
    return ENTITIES.map((e) => this.table(storeName(e)));
  }
}

export const db = new PosDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export function stripLocal<T extends BaseRecord>(row: Local<T> | T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _v, ...rest } = row as Local<T>;
  return rest as unknown as T;
}
