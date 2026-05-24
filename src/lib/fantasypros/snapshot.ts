import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, getDriver, pgSchemaTables, schema } from "../../db";
import { FpEcrDataSchema, type FpEcrData, type FpRankingsSnapshot, type FpScoring } from "./types";

// Self-healing CREATE TABLE — runs once per cold-started function instance
// so the rankings-refresh cron works even if init-db hasn't been re-applied
// against the live Neon database. Idempotent and cheap.
let ensuredTable = false;

async function ensureRankingsTable(): Promise<void> {
  if (ensuredTable) return;
  if (getDriver() !== "postgres") {
    // SQLite already ensures its tables in applySqliteSchemaIfNeeded.
    ensuredTable = true;
    return;
  }
  const db = getDb() as unknown as { execute: (q: unknown) => Promise<unknown> };
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS rankings_snapshots (
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
      CREATE INDEX IF NOT EXISTS rankings_snapshots_source_fetched
        ON rankings_snapshots (source, "fetchedAt" DESC)
    `)
  );
  ensuredTable = true;
}

// See sleeper/snapshot.ts for the dual-driver rationale — INSERTs and DELETEs
// must use the pg-typed table object on Postgres because the SQLite TIMESTAMP
// encoder (Date -> number ms) breaks Postgres TIMESTAMP columns.
function rankingsTable() {
  return getDriver() === "postgres"
    ? pgSchemaTables.rankingsSnapshots
    : schema.rankingsSnapshots;
}

/**
 * Read the freshest cached FantasyPros snapshot for a scoring variant.
 * Returns null when no snapshot exists yet.
 */
export async function getLatestRankingsSnapshot(
  scoring: FpScoring
): Promise<FpRankingsSnapshot | null> {
  await ensureRankingsTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.rankingsSnapshots)
    .where(eq(schema.rankingsSnapshots.source, scoring))
    .orderBy(desc(schema.rankingsSnapshots.fetchedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const data = parsePayload(row.payload);
  if (!data) return null;
  return {
    id: row.id,
    scoring,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

export interface InsertRankingsInput {
  scoring: FpScoring;
  data: FpEcrData;
}

export async function insertRankingsSnapshot({
  scoring,
  data
}: InsertRankingsInput): Promise<FpRankingsSnapshot> {
  await ensureRankingsTable();
  const db = getDb();
  const isPostgres = getDriver() === "postgres";
  const sizeBytes = Buffer.byteLength(JSON.stringify(data));
  const fetchedAt = new Date();
  const table = rankingsTable() as unknown as typeof schema.rankingsSnapshots;
  const inserted = await db
    .insert(table)
    .values({
      source: scoring,
      sizeBytes,
      payload: (isPostgres ? data : JSON.stringify(data)) as string,
      fetchedAt
    })
    .returning();
  const row = inserted[0]!;
  return {
    id: row.id,
    scoring,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

/** Delete snapshots older than `keepLastMs` for the given scoring variant. */
export async function pruneOldRankings(scoring: FpScoring, keepLastMs: number): Promise<number> {
  await ensureRankingsTable();
  const db = getDb();
  const cutoff = new Date(Date.now() - keepLastMs);
  const table = rankingsTable() as unknown as typeof schema.rankingsSnapshots;
  const result = await db
    .delete(table)
    .where(
      and(
        eq(table.source, scoring),
        lt(table.fetchedAt, cutoff)
      )
    )
    .returning({ id: table.id });
  return result.length;
}

function parsePayload(value: unknown): FpEcrData | null {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = FpEcrDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
