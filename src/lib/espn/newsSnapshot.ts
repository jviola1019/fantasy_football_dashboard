import { makeSnapshotStore } from "../../db/snapshotStore";
import { EspnNewsArticleListSchema, type EspnNewsArticle } from "./news";

const store = makeSnapshotStore<EspnNewsArticle[]>({
  table: "news_snapshots",
  tableKey: "newsSnapshots",
  schema: EspnNewsArticleListSchema
});

export interface NewsSnapshot {
  id: string;
  source: string;
  fetchedAt: Date;
  sizeBytes: number;
  articles: EspnNewsArticle[];
}

export interface InsertNewsSnapshotResult {
  id: string;
  sizeBytes: number;
}

/**
 * Retrieve the most recent news snapshot for the given source key. Returns null
 * if no snapshot has been stored yet.
 */
export async function getLatestNewsSnapshot(source: string): Promise<NewsSnapshot | null> {
  const rec = await store.getLatest(source);
  if (!rec) return null;
  return { id: rec.id, source, fetchedAt: rec.fetchedAt, sizeBytes: rec.sizeBytes, articles: rec.payload };
}

/**
 * Persist a news snapshot. Returns the new row's id and sizeBytes.
 */
export async function insertNewsSnapshot({
  source,
  articles
}: {
  source: string;
  articles: EspnNewsArticle[];
}): Promise<InsertNewsSnapshotResult> {
  const rec = await store.insert(source, articles);
  return { id: rec.id, sizeBytes: rec.sizeBytes };
}

/**
 * Prune rows older than keepLastMs for the given source. Returns the number of
 * rows deleted.
 */
export async function pruneOldNewsSnapshots(
  source: string,
  keepLastMs: number
): Promise<number> {
  return store.pruneOlderThan(source, keepLastMs);
}
