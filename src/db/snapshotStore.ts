import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { getDb, getDriver, schema, pgSchemaTables } from "./index";
import { snapshotIndexSql, snapshotTableSql, type SnapshotTableName } from "./schema-pg";

/**
 * Property key shared by the SQLite (`schema`) and Postgres (`pgSchemaTables`)
 * namespaces for each snapshot table. Resolving tables by key lets the store
 * look them up LAZILY (inside each operation) rather than dereferencing
 * `schema.X` at module load — which would crash any test that `vi.mock`s the db.
 */
export type SnapshotTableKey =
  | "playersSnapshots"
  | "rankingsSnapshots"
  | "ktcSnapshots"
  | "projectionsSnapshots"
  | "newsSnapshots"
  | "opportunitySnapshots";

/**
 * Generic snapshot-table store. Consolidates the get-latest / insert / prune /
 * parse / self-heal logic that the five snapshot modules (players, rankings,
 * ktc, projections, news) previously reimplemented byte-for-byte. Each module
 * now constructs one of these and exposes thin domain wrappers.
 *
 * Dual-driver: SELECTs use the SQLite-typed table (postgres-js parses the wire
 * format directly); INSERT/DELETE route through the driver-appropriate table so
 * Drizzle's column encoder is correct (the SQLite ms-timestamp encoder corrupts
 * Postgres TIMESTAMP). The self-heal DDL comes from schema-pg's single source.
 */

/** Representative SQLite snapshot table — all five share this exact column shape. */
type RepTable = typeof schema.playersSnapshots;

export interface SnapshotRecord<T> {
  id: string;
  fetchedAt: Date;
  sizeBytes: number;
  payload: T;
}

export interface SnapshotStore<T> {
  /** Idempotent self-heal (Postgres only) so cold-started functions don't 500. */
  ensureTable(): Promise<void>;
  /** Freshest row for `source`, or null if none / payload fails validation. */
  getLatest(source: string): Promise<SnapshotRecord<T> | null>;
  /** Validate (Zod) and persist a payload under `source`. */
  insert(source: string, payload: T): Promise<SnapshotRecord<T>>;
  /** Delete rows for `source` older than `keepLastMs`; returns rows removed. */
  pruneOlderThan(source: string, keepLastMs: number): Promise<number>;
}

export interface SnapshotStoreConfig<T> {
  /** SQL table name (drives the self-heal DDL), e.g. "players_snapshots". */
  table: SnapshotTableName;
  /** Property key in `schema` / `pgSchemaTables` (resolved lazily per call). */
  tableKey: SnapshotTableKey;
  /** Zod schema validating the payload on read and write. */
  schema: ZodType<T>;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as number);
}

export function makeSnapshotStore<T>(config: SnapshotStoreConfig<T>): SnapshotStore<T> {
  // Resolve tables lazily so importing a snapshot module never touches the db
  // at load time (keeps vi.mock("../../db") tests working).
  const selectTableOf = (): RepTable => schema[config.tableKey] as unknown as RepTable;
  let ensured = false;

  async function ensureTable(): Promise<void> {
    if (ensured) return;
    if (getDriver() !== "postgres") {
      // SQLite tables are created by applySqliteSchemaIfNeeded.
      ensured = true;
      return;
    }
    const db = getDb() as unknown as { execute: (q: unknown) => Promise<unknown> };
    await db.execute(sql.raw(snapshotTableSql(config.table)));
    await db.execute(sql.raw(snapshotIndexSql(config.table)));
    ensured = true;
  }

  function parsePayload(value: unknown): T | null {
    if (value == null) return null;
    let raw: unknown = value;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    const parsed = config.schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  function writeTable(): RepTable {
    return (getDriver() === "postgres" ? pgSchemaTables[config.tableKey] : schema[config.tableKey]) as unknown as RepTable;
  }

  async function getLatest(source: string): Promise<SnapshotRecord<T> | null> {
    await ensureTable();
    const db = getDb();
    const selectTable = selectTableOf();
    const rows = await db
      .select()
      .from(selectTable)
      .where(eq(selectTable.source, source))
      .orderBy(desc(selectTable.fetchedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const payload = parsePayload(row.payload);
    if (payload === null) return null;
    return { id: row.id, fetchedAt: toDate(row.fetchedAt), sizeBytes: row.sizeBytes, payload };
  }

  async function insert(source: string, payload: T): Promise<SnapshotRecord<T>> {
    // Validate on the write path so schema drift is caught before persisting
    // (symmetric with the read-path validation in parsePayload).
    const validated = config.schema.parse(payload);
    await ensureTable();
    const db = getDb();
    const isPostgres = getDriver() === "postgres";
    const sizeBytes = Buffer.byteLength(JSON.stringify(validated));
    const fetchedAt = new Date();
    const inserted = await db
      .insert(writeTable())
      .values({
        source,
        sizeBytes,
        // Postgres JSONB takes the object; SQLite TEXT needs a JSON string.
        payload: (isPostgres ? validated : JSON.stringify(validated)) as string,
        fetchedAt
      })
      .returning();
    const row = inserted[0]!;
    return { id: row.id, fetchedAt: toDate(row.fetchedAt), sizeBytes: row.sizeBytes, payload: validated };
  }

  async function pruneOlderThan(source: string, keepLastMs: number): Promise<number> {
    await ensureTable();
    const db = getDb();
    const cutoff = new Date(Date.now() - keepLastMs);
    const table = writeTable();
    const result = await db
      .delete(table)
      .where(and(eq(table.source, source), lt(table.fetchedAt, cutoff)))
      .returning({ id: table.id });
    return result.length;
  }

  return { ensureTable, getLatest, insert, pruneOlderThan };
}
