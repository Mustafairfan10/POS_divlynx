import "server-only";
import { getDb, type Queryable } from "./db";
import { mergeRecords } from "@/lib/merge";
import {
  ENTITIES,
  type BaseRecord,
  type EntityName,
  type Mutation,
  type MutationResult,
  type PulledRecord,
  type PullResponse,
} from "@/lib/types";

const MAX_BATCH = 200;
const PULL_LIMIT = 500;
const WRITE_LOCK_KEY = 72_413_001;

function validateMutation(m: unknown): m is Mutation {
  if (!m || typeof m !== "object") return false;
  const x = m as Mutation;
  return (
    typeof x.mutationId === "string" &&
    x.mutationId.length > 0 &&
    x.mutationId.length <= 100 &&
    ENTITIES.includes(x.entity) &&
    typeof x.recordId === "string" &&
    x.recordId.length > 0 &&
    x.recordId.length <= 100 &&
    typeof x.baseVersion === "number" &&
    !!x.data &&
    typeof x.data === "object" &&
    x.data.id === x.recordId &&
    typeof x.data.updatedAt === "number"
  );
}

async function applyOne(tx: Queryable, m: Mutation, deviceId: string): Promise<MutationResult> {
  // Idempotency: a retried request returns the original result instead of writing twice.
  const prior = await tx.query<{ result: MutationResult }>(
    `SELECT result FROM pos_mutations WHERE mutation_id = $1`,
    [m.mutationId],
  );
  if (prior.rows[0]) {
    const r = prior.rows[0].result;
    return { ...r, status: "duplicate" };
  }

  const cur = await tx.query<{ data: BaseRecord; version: number }>(
    `SELECT data, version FROM pos_records WHERE entity = $1 AND id = $2 FOR UPDATE`,
    [m.entity, m.recordId],
  );

  let result: MutationResult;
  const row = cur.rows[0];
  if (!row) {
    await tx.query(
      `INSERT INTO pos_records (entity, id, data, version, seq, device_id, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, nextval('pos_seq'), $4, now())`,
      [m.entity, m.recordId, JSON.stringify(m.data), deviceId],
    );
    result = { mutationId: m.mutationId, entity: m.entity, recordId: m.recordId, version: 1, status: "applied" };
  } else {
    const version = row.version + 1;
    let data: BaseRecord;
    let status: MutationResult["status"];
    if (m.baseVersion === row.version) {
      data = m.data;
      status = "applied";
    } else {
      // Another device changed this record since the client last saw it.
      data = mergeRecords(m.entity, row.data, m.data);
      status = "merged";
    }
    await tx.query(
      `UPDATE pos_records SET data = $3::jsonb, version = $4, seq = nextval('pos_seq'), device_id = $5, updated_at = now()
       WHERE entity = $1 AND id = $2`,
      [m.entity, m.recordId, JSON.stringify(data), version, deviceId],
    );
    result = {
      mutationId: m.mutationId,
      entity: m.entity,
      recordId: m.recordId,
      version,
      status,
      ...(status === "merged" ? { data } : {}),
    };
  }

  await tx.query(
    `INSERT INTO pos_mutations (mutation_id, device_id, result) VALUES ($1, $2, $3::jsonb)`,
    [m.mutationId, deviceId, JSON.stringify(result)],
  );
  return result;
}

export async function pushMutations(input: unknown, deviceId: string): Promise<MutationResult[]> {
  if (!Array.isArray(input)) throw new Error("mutations must be an array");
  const list = input.slice(0, MAX_BATCH);
  const db = await getDb();
  const results: MutationResult[] = [];

  for (const raw of list) {
    if (!validateMutation(raw)) {
      const r = raw as Partial<Mutation>;
      results.push({
        mutationId: String(r?.mutationId ?? ""),
        entity: (r?.entity ?? "orders") as EntityName,
        recordId: String(r?.recordId ?? ""),
        version: 0,
        status: "rejected",
        error: "Invalid mutation payload",
      });
      continue;
    }
    // One short transaction per mutation: a single bad record never blocks the rest,
    // and the advisory lock makes sequence numbers commit in order so pulls never skip rows.
    const res = await db.transaction(async (tx) => {
      if (db.kind === "postgres") await tx.query(`SELECT pg_advisory_xact_lock($1)`, [WRITE_LOCK_KEY]);
      return applyOne(tx, raw, deviceId);
    });
    results.push(res);
  }

  await db
    .query(`UPDATE pos_devices SET last_seen = now() WHERE id = $1`, [deviceId])
    .catch(() => {});
  return results;
}

export async function pullChanges(cursor: number): Promise<PullResponse> {
  const db = await getDb();
  const r = await db.query<{ entity: EntityName; id: string; version: number; seq: string | number; data: BaseRecord }>(
    `SELECT entity, id, version, seq, data FROM pos_records WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
    [cursor, PULL_LIMIT + 1],
  );
  const mx = await db.query<{ m: string | number | null }>(`SELECT max(seq) AS m FROM pos_records`);
  const maxSeq = Number(mx.rows[0]?.m ?? 0);
  const hasMore = r.rows.length > PULL_LIMIT;
  const rows = hasMore ? r.rows.slice(0, PULL_LIMIT) : r.rows;
  const records: PulledRecord[] = rows.map((x) => ({
    entity: x.entity,
    id: x.id,
    version: x.version,
    seq: Number(x.seq),
    data: x.data,
  }));
  return {
    records,
    cursor: records.length ? records[records.length - 1].seq : cursor,
    hasMore,
    maxSeq,
    serverTime: Date.now(),
  };
}

function codeForIndex(i: number): string {
  // A, B, ... Z, AA, AB ...
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export async function registerDevice(deviceId: string, name: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (db.kind === "postgres") await tx.query(`SELECT pg_advisory_xact_lock($1)`, [WRITE_LOCK_KEY]);
    const existing = await tx.query<{ code: string }>(`SELECT code FROM pos_devices WHERE id = $1`, [deviceId]);
    const records = await tx.query<{ n: string | number }>(`SELECT count(*) AS n FROM pos_records`);
    const isNewStore = Number(records.rows[0]?.n ?? 0) === 0;
    if (existing.rows[0]) {
      await tx.query(`UPDATE pos_devices SET name = $2, last_seen = now() WHERE id = $1`, [deviceId, name]);
      return { code: existing.rows[0].code, isNewStore };
    }
    const count = await tx.query<{ n: string | number }>(`SELECT count(*) AS n FROM pos_devices`);
    let idx = Number(count.rows[0]?.n ?? 0);
    // Guard against gaps / collisions.
    for (;;) {
      const code = codeForIndex(idx);
      const taken = await tx.query(`SELECT 1 FROM pos_devices WHERE code = $1`, [code]);
      if (!taken.rows.length) {
        await tx.query(`INSERT INTO pos_devices (id, code, name, last_seen) VALUES ($1, $2, $3, now())`, [
          deviceId,
          code,
          name,
        ]);
        return { code, isNewStore };
      }
      idx++;
    }
  });
}
