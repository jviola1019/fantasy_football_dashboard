import { makeSnapshotStore } from "../../db/snapshotStore";
import {
  KtcSnapshotPayloadSchema,
  type KtcSnapshotPayload,
  type KtcRankingsSnapshot,
  type KtcVariant
} from "./types";

const store = makeSnapshotStore<KtcSnapshotPayload>({
  table: "ktc_snapshots",
  tableKey: "ktcSnapshots",
  schema: KtcSnapshotPayloadSchema
});

/**
 * Read the freshest cached KTC snapshot for a variant. Returns null when the
 * table is empty for that variant (cron has not run yet). source key = variant.
 */
export async function getLatestKtcSnapshot(
  variant: KtcVariant
): Promise<KtcRankingsSnapshot | null> {
  const rec = await store.getLatest(variant);
  if (!rec) return null;
  return { id: rec.id, variant, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

export interface InsertKtcInput {
  variant: KtcVariant;
  data: KtcSnapshotPayload;
}

export async function insertKtcSnapshot({
  variant,
  data
}: InsertKtcInput): Promise<KtcRankingsSnapshot> {
  const rec = await store.insert(variant, data);
  return { id: rec.id, variant, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, data: rec.payload };
}

/** Delete snapshots older than `keepLastMs` for the given variant. */
export async function pruneOldKtcSnapshots(
  variant: KtcVariant,
  keepLastMs: number
): Promise<number> {
  return store.pruneOlderThan(variant, keepLastMs);
}
