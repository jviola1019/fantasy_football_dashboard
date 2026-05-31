import { makeSnapshotStore } from "../../db/snapshotStore";
import { FpEcrDataSchema, type FpEcrData, type FpRankingsSnapshot, type FpScoring } from "./types";

const store = makeSnapshotStore<FpEcrData>({
  table: "rankings_snapshots",
  tableKey: "rankingsSnapshots",
  schema: FpEcrDataSchema
});

/**
 * Read the freshest cached FantasyPros snapshot for a scoring variant. Returns
 * null when no snapshot exists yet. The source key is the scoring code.
 */
export async function getLatestRankingsSnapshot(
  scoring: FpScoring
): Promise<FpRankingsSnapshot | null> {
  const rec = await store.getLatest(scoring);
  if (!rec) return null;
  return { id: rec.id, scoring, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

export interface InsertRankingsInput {
  scoring: FpScoring;
  data: FpEcrData;
}

export async function insertRankingsSnapshot({
  scoring,
  data
}: InsertRankingsInput): Promise<FpRankingsSnapshot> {
  const rec = await store.insert(scoring, data);
  return { id: rec.id, scoring, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

/** Delete snapshots older than `keepLastMs` for the given scoring variant. */
export async function pruneOldRankings(scoring: FpScoring, keepLastMs: number): Promise<number> {
  return store.pruneOlderThan(scoring, keepLastMs);
}
