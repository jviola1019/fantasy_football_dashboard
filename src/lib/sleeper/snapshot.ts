import { and, desc, eq, lt } from "drizzle-orm";
import { getDb, getDriver, schema } from "../../db";
import { SleeperPlayersMapSchema, type SleeperPlayersMap } from "./schemas";

export const SLEEPER_SNAPSHOT_SOURCE = "sleeper-nfl";

export interface SnapshotRow {
  id: string;
  fetchedAt: Date;
  sizeBytes: number;
  players: SleeperPlayersMap;
}

/**
 * Read the freshest cached Sleeper players snapshot from the DB.
 * Returns null if no snapshot exists. The caller decides whether to
 * fall back to a live fetch.
 */
export async function getLatestPlayersSnapshot(): Promise<SnapshotRow | null> {
  const db = getDb();
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
  const payload: unknown = getDriver() === "postgres" ? players : JSON.stringify(players);
  const sizeBytes = Buffer.byteLength(JSON.stringify(players));
  const inserted = await db
    .insert(schema.playersSnapshots)
    .values({
      source: SLEEPER_SNAPSHOT_SOURCE,
      sizeBytes,
      // Drizzle's better-sqlite text column accepts a string; Postgres jsonb
      // accepts a JS object via the same `.values()` call.
      payload: payload as string,
      // Set fetchedAt from JS so we get millisecond resolution. The DB default
      // `(unixepoch() * 1000)` is whole-second resolution which breaks tests
      // that insert two snapshots in quick succession.
      fetchedAt: new Date()
    })
    .returning();
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
  // Drizzle's SQLite `timestamp_ms` column mode handles `Date → ms` conversion
  // automatically; the Postgres `timestamp` column expects a `Date` directly.
  const cutoff = new Date(Date.now() - keepLastMs);
  const result = await db
    .delete(schema.playersSnapshots)
    .where(
      and(
        eq(schema.playersSnapshots.source, SLEEPER_SNAPSHOT_SOURCE),
        lt(schema.playersSnapshots.fetchedAt, cutoff)
      )
    )
    .returning({ id: schema.playersSnapshots.id });
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
