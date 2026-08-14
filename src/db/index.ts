import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema";
import * as pgSchema from "./schema-pg";

export type Db = BetterSQLite3Database<typeof sqliteSchema>;

let cached: Db | undefined;
let activeDriver: "sqlite" | "postgres" = "sqlite";

/**
 * Which driver each Db instance was built with.
 *
 * Tracked per instance rather than only in `activeDriver` because tests (and the
 * Postgres integration suite) construct a Db directly without going through
 * getDb(), and a timestamp written with the wrong dialect's expression is a
 * runtime failure — see nowSql().
 */
const driverByDb = new WeakMap<object, "sqlite" | "postgres">();

export function driverFor(db: Db): "sqlite" | "postgres" {
  return driverByDb.get(db as unknown as object) ?? activeDriver;
}

/**
 * A "current timestamp" expression valid for the driver behind `db`.
 *
 * Audit 2026-08-06 F-003: the app deliberately uses the SQLite schema objects
 * for every query, even on Postgres (see the note on `schema` below). That works
 * for text and integer columns, but NOT for timestamps: the SQLite column is
 * `timestamp_ms`, so Drizzle maps a JS `Date` to epoch-milliseconds, and
 * postgres.js then rejects that number for a `TIMESTAMP` parameter with
 * "The string argument must be of type string ... Received type number".
 *
 * Verified against a real PostgreSQL 17 instance. Passing a Date is therefore
 * unsafe on the production driver; emit dialect-appropriate SQL instead. There
 * is no portable literal — SQLite's CURRENT_TIMESTAMP yields TEXT, which would
 * not round-trip through an INTEGER ms column.
 */
export function nowSql(db: Db) {
  return driverFor(db) === "postgres" ? sql`now()` : sql`(unixepoch() * 1000)`;
}

const url = process.env.DATABASE_URL ?? "file:.data/rae.sqlite";
const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

// Re-export the SQLite schema as the canonical shape. The Postgres schema is
// column-compatible (same column names, same JS types); Drizzle's query builder
// happily accepts either at runtime, and our query call sites only depend on
// the shared subset.
export const schema = sqliteSchema;
export const pgSchemaTables = pgSchema;

export function getDb(): Db {
  if (cached) return cached;
  if (isPostgres) {
    activeDriver = "postgres";
    cached = createPostgresDb(url);
  } else {
    activeDriver = "sqlite";
    cached = createSqliteDb(url.replace(/^file:/, ""));
  }
  return cached;
}

function createSqliteDb(filename: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  if (filename !== ":memory:") {
    try {
      mkdirSync(dirname(filename), { recursive: true });
    } catch {
      // ignore
    }
  }
  const sqlite = new BetterSqlite(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Idempotent schema init so file-backed dev DBs (and Playwright's SQLite
  // fixture) don't require a separate migration step. Postgres uses
  // /api/admin/init-db instead — see DEPLOY_TO_VERCEL.md.
  applySqliteSchemaIfNeeded(sqlite);
  const db = drizzle(sqlite, { schema: sqliteSchema }) as Db;
  driverByDb.set(db as unknown as object, "sqlite");
  return db;
}

// SQLite flavor of schema-pg's snapshotTableSql: same five-column shape, but
// ms-integer timestamps and TEXT payload. Generated from SNAPSHOT_TABLES so a
// snapshot table added to the canonical schema can never be silently missing
// here again (the opportunity_snapshots gap: both hand-written DDL copies
// omitted it while schema.ts declared it, and the drift guard only compared
// the two copies to each other).
function sqliteSnapshotDdl(): string {
  return pgSchema.SNAPSHOT_TABLES.map(
    (table) => `
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      fetchedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      sizeBytes INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${table}_source_fetched
      ON ${table} (source, fetchedAt DESC);`
  ).join("\n");
}

// Exported for the schema drift-guard test (db/schemaDrift.test.ts), which
// asserts this prod DDL and the in-memory test DDL stay structurally identical.
export function applySqliteSchemaIfNeeded(sqlite: { exec: (sql: string) => unknown }): void {
  // Idempotent and safe on BOTH fresh and pre-existing databases: every
  // statement is CREATE TABLE IF NOT EXISTS, so a DB created before the newer
  // snapshot tables (rankings/ktc/projections/news) still gets them on the next
  // boot — the SQLite mirror of the per-module ensure*Table() self-heal used on
  // Postgres. (Previously this early-returned on an existing DB and skipped the
  // CREATE block, leaving older DBs missing those tables → "no such table".)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      emailVerified INTEGER,
      image TEXT,
      passwordHash TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      providerAccountId TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      PRIMARY KEY (provider, providerAccountId)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sessionToken TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verificationTokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires INTEGER NOT NULL,
      PRIMARY KEY (identifier, token)
    );
    CREATE TABLE IF NOT EXISTS leagues (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      externalLeagueId TEXT NOT NULL,
      season INTEGER NOT NULL,
      label TEXT NOT NULL,
      settings TEXT,
      sleeperUsername TEXT,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS leagueCredentials (
      leagueId TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
      iv BLOB NOT NULL,
      authTag BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      rotatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leagueId TEXT REFERENCES leagues(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      rule TEXT NOT NULL,
      message TEXT NOT NULL,
      dedupKey TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      occurrences INTEGER NOT NULL DEFAULT 1,
      season INTEGER,
      week INTEGER,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      resolvedAt INTEGER,
      dismissedAt INTEGER
    );
    ${sqliteSnapshotDdl()}
  `);
  // Additive column migrations for DBs created before these columns existed.
  // SQLite ADD COLUMN throws "duplicate column name" if the column is already
  // present (the common case on a fresh DB where the CREATE above already
  // includes them) — swallow ONLY that; a locked/corrupt DB during ALTER must
  // surface here, not later as a baffling "no such column" at query time.
  for (const stmt of [
    "ALTER TABLE leagues ADD COLUMN settings TEXT",
    "ALTER TABLE leagues ADD COLUMN sleeperUsername TEXT",
    // audit 2026-08-06 F-003 — notification dedup + lifecycle state.
    "ALTER TABLE notifications ADD COLUMN dedupKey TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE notifications ADD COLUMN status TEXT NOT NULL DEFAULT 'new'",
    "ALTER TABLE notifications ADD COLUMN occurrences INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE notifications ADD COLUMN season INTEGER",
    "ALTER TABLE notifications ADD COLUMN week INTEGER",
    "ALTER TABLE notifications ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)",
    "ALTER TABLE notifications ADD COLUMN resolvedAt INTEGER"
  ]) {
    try {
      sqlite.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  }

  // Backfill BEFORE creating the unique index. Pre-migration rows all carry the
  // '' default, which would collide; keying them by their own id preserves the
  // existing history verbatim while guaranteeing uniqueness. Legacy rows are
  // marked so they can never be mistaken for a live dedup key.
  sqlite.exec(`
    UPDATE notifications
       SET dedupKey = 'legacy:' || id
     WHERE dedupKey IS NULL OR dedupKey = '';
    UPDATE notifications
       SET status = CASE WHEN dismissedAt IS NOT NULL THEN 'dismissed' ELSE 'active' END
     WHERE status IS NULL OR status = 'new';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedup
      ON notifications (userId, dedupKey);
    CREATE INDEX IF NOT EXISTS notifications_user_created
      ON notifications (userId, createdAt);
  `);
}

/**
 * Exported so the Postgres integration test can build a client against an
 * isolated throwaway database and exercise the REAL factory (same driver
 * options, same schema binding) rather than a lookalike.
 */
export function createPostgresDb(connectionUrl: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const postgres = require("postgres");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/postgres-js");
  const client = postgres(connectionUrl, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: pgSchema }) as unknown as Db;
  driverByDb.set(db as unknown as object, "postgres");
  return db;
}

export function getDriver(): "sqlite" | "postgres" {
  getDb();
  return activeDriver;
}

export function resetDbForTests(): Db {
  cached = undefined;
  activeDriver = "sqlite";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const sqlite = new BetterSqlite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  applyTestSchema(sqlite);
  const db = drizzle(sqlite, { schema: sqliteSchema }) as Db;
  driverByDb.set(db as unknown as object, "sqlite");
  cached = db;
  return db;
}

interface MinimalSqliteHandle {
  exec(sql: string): void;
}

export function applyTestSchema(sqlite: MinimalSqliteHandle) {
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      emailVerified INTEGER,
      image TEXT,
      passwordHash TEXT
    );
    CREATE TABLE accounts (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      providerAccountId TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      PRIMARY KEY (provider, providerAccountId)
    );
    CREATE TABLE sessions (
      sessionToken TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE verificationTokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires INTEGER NOT NULL,
      PRIMARY KEY (identifier, token)
    );
    CREATE TABLE leagues (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      externalLeagueId TEXT NOT NULL,
      season INTEGER NOT NULL,
      label TEXT NOT NULL,
      settings TEXT,
      sleeperUsername TEXT,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE leagueCredentials (
      leagueId TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
      iv BLOB NOT NULL,
      authTag BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      rotatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leagueId TEXT REFERENCES leagues(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      rule TEXT NOT NULL,
      message TEXT NOT NULL,
      dedupKey TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      occurrences INTEGER NOT NULL DEFAULT 1,
      season INTEGER,
      week INTEGER,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      resolvedAt INTEGER,
      dismissedAt INTEGER
    );
    CREATE UNIQUE INDEX notifications_user_dedup ON notifications (userId, dedupKey);
    CREATE INDEX notifications_user_created ON notifications (userId, createdAt);
    ${sqliteSnapshotDdl()}
  `);
}
