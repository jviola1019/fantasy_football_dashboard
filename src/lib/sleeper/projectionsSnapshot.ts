import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, getDriver, pgSchemaTables, schema } from "../../db";
import {
  ProjectionsSnapshotPayloadSchema,
  type ProjectionsSnapshotPayload,
  type ProjectionsSnapshot,
  snapshotSourceKey
} from "./projections";

// Self-healing CREATE TABLE — runs once per cold-started function instance
// so the projections-refresh cron works even if init-db hasn't been re-
// applied. Mirror of ktc/snapshot.ts pattern.
let ensuredTable = false;

async function ensureProjectionsTable(): Promise<void> {
  if (ensuredTable) return;
  if (getDriver() !== "postgres") {
    ensuredTable = true;
    return;
  }
  const db = getDb() as unknown as { execute: (q: unknown) => Promise<unknown> };
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS projections_snapshots (
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
      CREATE INDEX IF NOT EXISTS projections_snapshots_source_fetched
        ON projections_snapshots (source, "fetchedAt" DESC)
    `)
  );
  ensuredTable = true;
}

// Dual-driver guard: SELECTs work on either builder, but INSERTs must go
// through the Postgres table object on prod (the SQLite timestamp encoder
// breaks Postgres TIMESTAMP columns).
function projectionsTable() {
  return getDriver() === "postgres"
    ? pgSchemaTables.projectionsSnapshots
    : schema.projectionsSnapshots;
}

/**
 * Read the freshest cached projections snapshot for a (season, week). Returns
 * null when the table is empty for that key (cron hasn't run, or we're off-
 * season). Callers (NexusSim) treat null as "data unavailable" and fall back
 * to season-aggregate trueValue.
 */
export async function getLatestProjectionsSnapshot(
  season: string,
  week: number
): Promise<ProjectionsSnapshot | null> {
  await ensureProjectionsTable();
  const db = getDb();
  const source = snapshotSourceKey(season, week);
  const rows = await db
    .select()
    .from(schema.projectionsSnapshots)
    .where(eq(schema.projectionsSnapshots.source, source))
    .orderBy(desc(schema.projectionsSnapshots.fetchedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const data = parsePayload(row.payload);
  if (!data) return null;
  return {
    id: row.id,
    source,
    fetchedAt:
      row.fetchedAt instanceof Date
        ? row.fetchedAt
        : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

export interface InsertProjectionsInput {
  data: ProjectionsSnapshotPayload;
}

export async function insertProjectionsSnapshot({
  data
}: InsertProjectionsInput): Promise<ProjectionsSnapshot> {
  // Runtime Zod validation on the write path so schema drift is caught before
  // persisting (mirrors the parse already done on the read path in parsePayload).
  const validated = ProjectionsSnapshotPayloadSchema.parse(data);
  await ensureProjectionsTable();
  const db = getDb();
  const isPostgres = getDriver() === "postgres";
  const source = snapshotSourceKey(validated.season, validated.week);
  const sizeBytes = Buffer.byteLength(JSON.stringify(validated));
  const fetchedAt = new Date();
  const table = projectionsTable() as unknown as typeof schema.projectionsSnapshots;
  const inserted = await db
    .insert(table)
    .values({
      source,
      sizeBytes,
      payload: (isPostgres ? validated : JSON.stringify(validated)) as string,
      fetchedAt
    })
    .returning();
  const row = inserted[0]!;
  return {
    id: row.id,
    source,
    fetchedAt:
      row.fetchedAt instanceof Date
        ? row.fetchedAt
        : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    data
  };
}

/**
 * Delete snapshots older than `keepLastMs` for the given (season, week).
 * Used by the cron to keep the table bounded — we only need the freshest
 * weekly snapshot to drive NexusSim.
 */
export async function pruneOldProjectionsSnapshots(
  season: string,
  week: number,
  keepLastMs: number
): Promise<number> {
  await ensureProjectionsTable();
  const db = getDb();
  const source = snapshotSourceKey(season, week);
  const cutoff = new Date(Date.now() - keepLastMs);
  const table = projectionsTable() as unknown as typeof schema.projectionsSnapshots;
  const result = await db
    .delete(table)
    .where(and(eq(table.source, source), lt(table.fetchedAt, cutoff)))
    .returning({ id: table.id });
  return result.length;
}

function parsePayload(value: unknown): ProjectionsSnapshotPayload | null {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = ProjectionsSnapshotPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
