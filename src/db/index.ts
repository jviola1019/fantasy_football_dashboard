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
  return drizzle(sqlite, { schema: sqliteSchema }) as Db;
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

function applyTestSchema(sqlite: MinimalSqliteHandle) {
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
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE leagueCredentials (
      leagueId TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
      iv BLOB NOT NULL,
      authTag BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      rotatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);
}
