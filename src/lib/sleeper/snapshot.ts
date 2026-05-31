import { makeSnapshotStore } from "../../db/snapshotStore";
import { SleeperPlayersMapSchema, type SleeperPlayersMap } from "./schemas";

export const SLEEPER_SNAPSHOT_SOURCE = "sleeper-nfl";

export interface SnapshotRow {
  id: string;
  fetchedAt: Date;
  sizeBytes: number;
  players: SleeperPlayersMap;
}

const store = makeSnapshotStore<SleeperPlayersMap>({
  table: "players_snapshots",
  tableKey: "playersSnapshots",
  schema: SleeperPlayersMapSchema
});

/**
 * Read the freshest cached Sleeper players snapshot from the DB. Returns null if
 * no snapshot exists. The caller decides whether to fall back to a live fetch.
 */
export async function getLatestPlayersSnapshot(): Promise<SnapshotRow | null> {
  const rec = await store.getLatest(SLEEPER_SNAPSHOT_SOURCE);
  if (!rec) return null;
  return { id: rec.id, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, players: rec.payload };
}

export interface InsertSnapshotInput {
  players: SleeperPlayersMap;
}

export async function insertPlayersSnapshot({ players }: InsertSnapshotInput): Promise<SnapshotRow> {
  const rec = await store.insert(SLEEPER_SNAPSHOT_SOURCE, players);
  return { id: rec.id, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, players: rec.payload };
}

/** Delete snapshots older than `keepLastMs` ago for the Sleeper source. */
export async function pruneOldSnapshots(keepLastMs: number): Promise<number> {
  return store.pruneOlderThan(SLEEPER_SNAPSHOT_SOURCE, keepLastMs);
}
