import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, getDriver, pgSchemaTables, schema } from "../../db";
import { EspnNewsArticleListSchema, type EspnNewsArticle } from "./news";

// Self-healing CREATE TABLE — runs once per cold-started function instance.
// Postgres path only; SQLite relies on applySqliteSchemaIfNeeded.
let ensuredTable = false;

async function ensureNewsTable(): Promise<void> {
  if (ensuredTable) return;
  if (getDriver() !== "postgres") {
    ensuredTable = true;
    return;
  }
  const db = getDb() as unknown as { execute: (q: unknown) => Promise<unknown> };
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS news_snapshots (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "sizeBytes" INTEGER NOT NULL,
        payload JSONB NOT NULL
      )
    `)
  );
  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS news_snapshots_source_fetched
        ON news_snapshots (source, "fetchedAt" DESC)
    `)
  );
  ensuredTable = true;
}

// Dual-driver: SQLite uses TEXT for payload; Postgres uses JSONB.
// INSERTs MUST route through this helper so the Drizzle column encoder is right.
function newsTable() {
  return getDriver() === "postgres"
    ? pgSchemaTables.newsSnapshots
    : schema.newsSnapshots;
}

function parsePayload(raw: unknown): EspnNewsArticle[] | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = EspnNewsArticleListSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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
 * Retrieve the most recent news snapshot for the given source key.
 * Returns null if no snapshot has been stored yet.
 */
export async function getLatestNewsSnapshot(source: string): Promise<NewsSnapshot | null> {
  await ensureNewsTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.newsSnapshots)
    .where(eq(schema.newsSnapshots.source, source))
    .orderBy(desc(schema.newsSnapshots.fetchedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const articles = parsePayload(row.payload);
  if (!articles) return null;
  return {
    id: row.id,
    source,
    fetchedAt:
      row.fetchedAt instanceof Date
        ? row.fetchedAt
        : new Date(row.fetchedAt as unknown as number),
    sizeBytes: row.sizeBytes,
    articles
  };
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
  // Runtime Zod validation on the write path (mirrors read-path parsePayload).
  const validated = EspnNewsArticleListSchema.parse(articles);
  await ensureNewsTable();
  const db = getDb();
  const id = crypto.randomUUID();
  const payloadStr = JSON.stringify(validated);
  const sizeBytes = Buffer.byteLength(payloadStr, "utf8");
  const payload =
    getDriver() === "postgres" ? (validated as unknown) : payloadStr;

  await db.insert(newsTable()).values({
    id,
    source,
    sizeBytes,
    payload
  } as never);

  return { id, sizeBytes };
}

/**
 * Prune rows older than keepLastMs for the given source.
 * Returns the number of rows deleted.
 */
export async function pruneOldNewsSnapshots(
  source: string,
  keepLastMs: number
): Promise<number> {
  await ensureNewsTable();
  const db = getDb();
  const cutoff = new Date(Date.now() - keepLastMs);

  const result = await db
    .delete(newsTable())
    .where(and(eq(newsTable().source, source), lt(newsTable().fetchedAt, cutoff)));

  return typeof result === "object" && result !== null && "rowCount" in result
    ? ((result as { rowCount: number }).rowCount ?? 0)
    : 0;
}
