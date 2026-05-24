import { and, desc, eq, lt } from "drizzle-orm";
import { getDb, getDriver, pgSchemaTables, schema } from "../../db";
import { SleeperPlayersMapSchema, type SleeperPlayersMap } from "./schemas";

export const SLEEPER_SNAPSHOT_SOURCE = "sleeper-nfl";

export interface SnapshotRow {
  id: string;
  fetchedAt: Date;
  sizeBytes: number;
  players: SleeperPlayersMap;
}

// The dual-driver story: `schema` is the SQLite table set (integer timestamps,
// text payloads), and `pgSchemaTables` is the Postgres set (TIMESTAMP, JSONB).
// SELECTs work fine against either because postgres-js's wire-format parsers
// don't care about Drizzle's column type. INSERTs and DELETEs are different —
// Drizzle serializes the input value through the *column type's* encoder
// before handing it to postgres-js, which is where Date → ms (SQLite mode)
// breaks Postgres TIMESTAMP. So for writes we have to use the matching schema.
function playersSnapshotsTable() {
  // The runtime tables share column names; the type-only difference is which
  // Drizzle encoders the column gets. We cast to `any` because the file's
  // exported `Db` type is narrowed to the SQLite shape.
  return getDriver() === "postgres" ? pgSchemaTables.playersSnapshots : schema.playersSnapshots;
}

/**
 * Read the freshest cached Sleeper players snapshot from the DB.
 * Returns null if no snapshot exists. The caller decides whether to
 * fall back to a live fetch.
 */
export async function getLatestPlayersSnapshot(): Promise<SnapshotRow | null> {
  const db = getDb();
  // SELECTs are safe against either schema because postgres-js parses the
  // wire format directly. Keep using the SQLite-typed columns for the
  // builder so this code stays a single path.
  const rows = await db
    .select()
    .from(schema.playersSnapshots)
    .where(eq(schema.playersSnapshots.source, SLEEPER_SNAPSHOT_SOURCE))
    .orderBy(desc(schema.playersSnapshots.fetchedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const players = parsePayload(row.payload);
  if (!players) return null;
  return {
    id: row.id,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    players
  };
}

export interface InsertSnapshotInput {
  players: SleeperPlayersMap;
}

export async function insertPlayersSnapshot({ players }: InsertSnapshotInput): Promise<SnapshotRow> {
  const db = getDb();
  const isPostgres = getDriver() === "postgres";
  const sizeBytes = Buffer.byteLength(JSON.stringify(players));
  const fetchedAt = new Date();
  // Cast to satisfy the SQLite-narrowed Db type at the call site. The runtime
  // insert builder doesn't care which table object you pass it.
  const table = playersSnapshotsTable() as unknown as typeof schema.playersSnapshots;
  const values = {
    source: SLEEPER_SNAPSHOT_SOURCE,
    sizeBytes,
    // Postgres JSONB takes the JS object directly via postgres-js's encoder.
    // SQLite TEXT requires a JSON-encoded string.
    payload: (isPostgres ? players : JSON.stringify(players)) as string,
    fetchedAt
  };
  const inserted = await db.insert(table).values(values).returning();
  const row = inserted[0]!;
  return {
    id: row.id,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    players
  };
}

/** Delete snapshots older than `keepLastMs` ago for the Sleeper source. */
export async function pruneOldSnapshots(keepLastMs: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - keepLastMs);
  // Same dual-schema rationale as insertPlayersSnapshot — comparisons against
  // a TIMESTAMP column need the Postgres-typed table so the cutoff Date is
  // encoded correctly.
  const table = playersSnapshotsTable() as unknown as typeof schema.playersSnapshots;
  const result = await db
    .delete(table)
    .where(
      and(
        eq(table.source, SLEEPER_SNAPSHOT_SOURCE),
        lt(table.fetchedAt, cutoff)
      )
    )
    .returning({ id: table.id });
  return result.length;
}

function parsePayload(value: unknown): SleeperPlayersMap | null {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = SleeperPlayersMapSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
