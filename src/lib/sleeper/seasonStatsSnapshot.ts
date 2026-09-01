import { makeSnapshotStore } from "../../db/snapshotStore";
import { SeasonStatsMapSchema, type SeasonStatsMap } from "./seasonStats";

const store = makeSnapshotStore<SeasonStatsMap>({
  table: "season_stats_snapshots",
  tableKey: "seasonStatsSnapshots",
  schema: SeasonStatsMapSchema
});

export interface SeasonStatsSnapshot {
  id: string;
  source: string;
  fetchedAt: Date;
  sizeBytes: number;
  stats: SeasonStatsMap;
}

/**
 * Freshest season-stats snapshot for a source key, or null.
 *
 * The cron writes under the SEASON string ("2025"), not a fixed key, because
 * unlike snap share these aggregates are meaningless across seasons -- reading
 * last year's totals as this year's points-to-date would be the same class of
 * error as P0-5, where a stale snapshot was presented as current.
 */
export async function getLatestSeasonStatsSnapshot(season: string): Promise<SeasonStatsSnapshot | null> {
  const rec = await store.getLatest(season);
  if (!rec) return null;
  return { id: rec.id, source: season, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, stats: rec.payload };
}

export async function insertSeasonStatsSnapshot({
  season,
  stats
}: {
  season: string;
  stats: SeasonStatsMap;
}): Promise<{ id: string; sizeBytes: number }> {
  const rec = await store.insert(season, stats);
  return { id: rec.id, sizeBytes: rec.sizeBytes };
}

export async function pruneOldSeasonStatsSnapshots(season: string, keepLastMs: number): Promise<number> {
  return store.pruneOlderThan(season, keepLastMs);
}

export async function ensureSeasonStatsTable(): Promise<void> {
  await store.ensureTable();
}
