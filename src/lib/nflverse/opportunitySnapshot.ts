import { makeSnapshotStore } from "../../db/snapshotStore";
import {
  OpportunityPayloadSchema,
  readOpportunityPayload,
  type OpportunityMap,
  type OpportunityPayload
} from "./opportunity";

const store = makeSnapshotStore<OpportunityPayload>({
  table: "opportunity_snapshots",
  tableKey: "opportunitySnapshots",
  schema: OpportunityPayloadSchema
});

export interface OpportunitySnapshot {
  id: string;
  source: string;
  fetchedAt: Date;
  sizeBytes: number;
  scores: OpportunityMap;
  /**
   * The nflverse season these snap shares describe, or null for a snapshot
   * written before the season was persisted (audit 2026-08-31, D-C).
   *
   * NOT the same fact as `fetchedAt`. A snapshot written last night can carry
   * last season's data, because the cron falls back a year when the current
   * season has no snap counts yet.
   */
  dataSeason: string | null;
}

/**
 * Freshest opportunity snapshot for a source key, or null. The cron writes
 * under the FIXED key "nfl" (opportunity-refresh/route.ts OPP_SOURCE) — NOT a
 * season string — so readers always find the latest snapshot without knowing
 * which season the cron resolved. Passing a season here returns null forever.
 */
export async function getLatestOpportunitySnapshot(source: string): Promise<OpportunitySnapshot | null> {
  const rec = await store.getLatest(source);
  if (!rec) return null;
  const { dataSeason, scores } = readOpportunityPayload(rec.payload);
  return { id: rec.id, source, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, scores, dataSeason };
}

export async function insertOpportunitySnapshot({
  source,
  scores,
  dataSeason
}: {
  source: string;
  scores: OpportunityMap;
  /** The season the scores describe. Required on write — see D-C. */
  dataSeason: string;
}): Promise<{ id: string; sizeBytes: number }> {
  const rec = await store.insert(source, { dataSeason, scores });
  return { id: rec.id, sizeBytes: rec.sizeBytes };
}

export async function pruneOldOpportunitySnapshots(source: string, keepLastMs: number): Promise<number> {
  return store.pruneOlderThan(source, keepLastMs);
}

export async function ensureOpportunityTable(): Promise<void> {
  await store.ensureTable();
}
