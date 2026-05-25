import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, getDriver, pgSchemaTables, schema } from "../../db";
import {
  KtcSnapshotPayloadSchema,
  type KtcSnapshotPayload,
  type KtcRankingsSnapshot,
  type KtcVariant
} from "./types";

// Self-healing CREATE TABLE — runs once per cold-started function instance
// so the ktc-refresh cron works even if init-db hasn't been re-applied
// against the live Neon database. Mirror of FP rankings snapshot pattern.
let ensuredTable = false;

async function ensureKtcTable(): Promise<void> {
  if (ensuredTable) return;
  if (getDriver() !== "postgres") {
    // SQLite already ensures its tables in applySqliteSchemaIfNeeded.
    ensuredTable = true;
    return;
  }
  const db = getDb() as unknown as { execute: (q: unknown) => Promise<unknown> };
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS ktc_snapshots (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "sizeBytes" INTEGER NOT NULL,
        payload JSONB NOT NULL
      )
    `)
  );
  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS ktc_snapshots_source_fetched
        ON ktc_snapshots (source, "fetchedAt" DESC)
    `)
  );
  ensuredTable = true;
}

// Dual-driver: SQLite uses TEXT for payload + integer-ms for fetchedAt;
// Postgres uses JSONB + TIMESTAMP. INSERTs MUST use the Postgres table
// object on prod because the SQLite timestamp encoder breaks Postgres
// TIMESTAMP columns. SELECTs are safe on either builder.
function ktcTable() {
  return getDriver() === "postgres" ? pgSchemaTables.ktcSnapshots : schema.ktcSnapshots;
}

/**
 * Read the freshest cached KTC snapshot for a variant. Returns null when
 * the table is empty for that variant (cron has not run yet).
 */
export async function getLatestKtcSnapshot(
  variant: KtcVariant
): Promise<KtcRankingsSnapshot | null> {
  await ensureKtcTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.ktcSnapshots)
    .where(eq(schema.ktcSnapshots.source, variant))
    .orderBy(desc(schema.ktcSnapshots.fetchedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const data = parsePayload(row.payload);
  if (!data) return null;
  return {
    id: row.id,
    variant,
    fetchedAt:
      row.fetchedAt instanceof Date
        ? row.fetchedAt
        : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

export interface InsertKtcInput {
  variant: KtcVariant;
  data: KtcSnapshotPayload;
}

export async function insertKtcSnapshot({
  variant,
  data
}: InsertKtcInput): Promise<KtcRankingsSnapshot> {
  await ensureKtcTable();
  const db = getDb();
  const isPostgres = getDriver() === "postgres";
  const sizeBytes = Buffer.byteLength(JSON.stringify(data));
  const fetchedAt = new Date();
  const table = ktcTable() as unknown as typeof schema.ktcSnapshots;
  const inserted = await db
    .insert(table)
    .values({
      source: variant,
      sizeBytes,
      payload: (isPostgres ? data : JSON.stringify(data)) as string,
      fetchedAt
    })
    .returning();
  const row = inserted[0]!;
  return {
    id: row.id,
    variant,
    fetchedAt:
      row.fetchedAt instanceof Date
        ? row.fetchedAt
        : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

/** Delete snapshots older than `keepLastMs` for the given variant. */
export async function pruneOldKtcSnapshots(
  variant: KtcVariant,
  keepLastMs: number
): Promise<number> {
  await ensureKtcTable();
  const db = getDb();
  const cutoff = new Date(Date.now() - keepLastMs);
  const table = ktcTable() as unknown as typeof schema.ktcSnapshots;
  const result = await db
    .delete(table)
    .where(and(eq(table.source, variant), lt(table.fetchedAt, cutoff)))
    .returning({ id: table.id });
  return result.length;
}

function parsePayload(value: unknown): KtcSnapshotPayload | null {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = KtcSnapshotPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
