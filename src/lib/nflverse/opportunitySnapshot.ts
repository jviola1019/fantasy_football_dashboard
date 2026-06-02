import { makeSnapshotStore } from "../../db/snapshotStore";
import { OpportunityMapSchema, type OpportunityMap } from "./opportunity";

const store = makeSnapshotStore<OpportunityMap>({
  table: "opportunity_snapshots",
  tableKey: "opportunitySnapshots",
  schema: OpportunityMapSchema
});

export interface OpportunitySnapshot {
  id: string;
  source: string;
  fetchedAt: Date;
  sizeBytes: number;
  scores: OpportunityMap;
}

/** Freshest opportunity snapshot for a season key (e.g. "2025"), or null. */
export async function getLatestOpportunitySnapshot(source: string): Promise<OpportunitySnapshot | null> {
  const rec = await store.getLatest(source);
  if (!rec) return null;
  return { id: rec.id, source, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, scores: rec.payload };
}

export async function insertOpportunitySnapshot({
  source,
  scores
}: {
  source: string;
  scores: OpportunityMap;
}): Promise<{ id: string; sizeBytes: number }> {
  const rec = await store.insert(source, scores);
  return { id: rec.id, sizeBytes: rec.sizeBytes };
}

export async function pruneOldOpportunitySnapshots(source: string, keepLastMs: number): Promise<number> {
  return store.pruneOlderThan(source, keepLastMs);
}

export async function ensureOpportunityTable(): Promise<void> {
  await store.ensureTable();
}
