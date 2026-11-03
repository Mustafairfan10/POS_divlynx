import "server-only";
import path from "node:path";
import fs from "node:fs";

/**
 * Minimal database abstraction over either:
 *  - a real Postgres (Neon / Vercel Postgres / Supabase / any) via DATABASE_URL, or
 *  - an embedded Postgres (PGlite) for zero-config local development.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  kind: "postgres" | "embedded";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

const SCHEMA = [
  `CREATE SEQUENCE IF NOT EXISTS pos_seq`,
  `CREATE TABLE IF NOT EXISTS pos_records (
     entity text NOT NULL,
     id text NOT NULL,
     data jsonb NOT NULL,
     version integer NOT NULL,
     seq bigint NOT NULL,
     device_id text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (entity, id)
   )`,
  `CREATE INDEX IF NOT EXISTS pos_records_seq_idx ON pos_records (seq)`,
  `CREATE TABLE IF NOT EXISTS pos_mutations (
     mutation_id text PRIMARY KEY,
     device_id text,
     result jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS pos_devices (
     id text PRIMARY KEY,
     code text UNIQUE NOT NULL,
     name text,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen timestamptz
   )`,
];

function connectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    undefined
  );
}

async function createPostgres(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 10_000,
  });
  return {
    kind: "postgres",
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Queryable = {
          async query(sql, params) {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows };
          },
        };
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function createEmbedded(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.VERCEL
    ? "/tmp/pos-pglite"
    : path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  // PGlite is single-connection; serialize transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "embedded",
    async query(sql, params) {
      const r = await db.query(sql, params as unknown[]);
      return { rows: r.rows as never[] };
    },
    transaction(fn) {
      const run = chain.then(() =>
        db.transaction(async (t) =>
          fn({
            async query(sql, params) {
              const r = await t.query(sql, params as unknown[]);
              return { rows: r.rows as never[] };
            },
          }),
        ),
      );
      chain = run.catch(() => {});
      return run;
    },
  };
}

const g = globalThis as unknown as { __posDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!g.__posDb) {
    g.__posDb = (async () => {
      const url = connectionString();
      const db = url ? await createPostgres(url) : await createEmbedded();
      for (const stmt of SCHEMA) await db.query(stmt);
      return db;
    })().catch((e) => {
      g.__posDb = undefined;
      throw e;
    });
  }
  return g.__posDb;
}
