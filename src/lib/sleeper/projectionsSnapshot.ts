import { makeSnapshotStore } from "../../db/snapshotStore";
import {
  ProjectionsSnapshotPayloadSchema,
  type ProjectionsSnapshotPayload,
  type ProjectionsSnapshot,
  snapshotSourceKey
} from "./projections";

const store = makeSnapshotStore<ProjectionsSnapshotPayload>({
  table: "projections_snapshots",
  tableKey: "projectionsSnapshots",
  schema: ProjectionsSnapshotPayloadSchema
});

/**
 * Read the freshest cached projections snapshot for a (season, week). Returns
 * null when the table is empty for that key (cron hasn't run, or we're off-
 * season). Callers (NexusSim) treat null as "data unavailable" and fall back to
 * season-aggregate trueValue. source key = "{season}-{week}".
 */
export async function getLatestProjectionsSnapshot(
  season: string,
  week: number
): Promise<ProjectionsSnapshot | null> {
  const source = snapshotSourceKey(season, week);
  const rec = await store.getLatest(source);
  if (!rec) return null;
  return { id: rec.id, source, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

export interface InsertProjectionsInput {
  data: ProjectionsSnapshotPayload;
}

export async function insertProjectionsSnapshot({
  data
}: InsertProjectionsInput): Promise<ProjectionsSnapshot> {
  // The source key is derived from the payload's own (season, week).
  const source = snapshotSourceKey(data.season, data.week);
  const rec = await store.insert(source, data);
  return { id: rec.id, source, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

/**
 * Delete snapshots older than `keepLastMs` for the given (season, week). Used by
 * the cron to keep the table bounded — we only need the freshest weekly snapshot.
 */
export async function pruneOldProjectionsSnapshots(
  season: string,
  week: number,
  keepLastMs: number
): Promise<number> {
  return store.pruneOlderThan(snapshotSourceKey(season, week), keepLastMs);
}
