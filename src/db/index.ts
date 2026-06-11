import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema";
import * as pgSchema from "./schema-pg";

export type Db = BetterSQLite3Database<typeof sqliteSchema>;

let cached: Db | undefined;
let activeDriver: "sqlite" | "postgres" = "sqlite";

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
  return drizzle(sqlite, { schema: sqliteSchema }) as Db;
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
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      dismissedAt INTEGER
    );
    ${sqliteSnapshotDdl()}
  `);
  // Additive column migrations for DBs created before these columns existed.
  // SQLite ADD COLUMN throws if the column is already present (the common case
  // on a fresh DB where the CREATE above already includes them) — swallow that.
  for (const stmt of [
    "ALTER TABLE leagues ADD COLUMN settings TEXT",
    "ALTER TABLE leagues ADD COLUMN sleeperUsername TEXT"
  ]) {
    try {
      sqlite.exec(stmt);
    } catch {
      // column already present
    }
  }
}

function createPostgresDb(connectionUrl: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const postgres = require("postgres");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/postgres-js");
  const client = postgres(connectionUrl, { prepare: false, max: 1 });
  return drizzle(client, { schema: pgSchema }) as unknown as Db;
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
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      dismissedAt INTEGER
    );
    ${sqliteSnapshotDdl()}
  `);
}
