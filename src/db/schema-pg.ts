import { pgTable, text, integer, timestamp, primaryKey, customType, jsonb } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  }
});

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("passwordHash")
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state")
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull()
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull()
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

export const leagues = pgTable("leagues", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["sleeper", "espn"] }).notNull(),
  externalLeagueId: text("externalLeagueId").notNull(),
  season: integer("season").notNull(),
  label: text("label").notNull(),
  settings: text("settings"),
  /** Sleeper-only: the user's Sleeper username so we can resolve their roster_id. */
  sleeperUsername: text("sleeperUsername"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow()
});

export const leagueCredentials = pgTable("leagueCredentials", {
  leagueId: text("leagueId")
    .primaryKey()
    .references(() => leagues.id, { onDelete: "cascade" }),
  iv: bytea("iv").notNull(),
  authTag: bytea("authTag").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  rotatedAt: timestamp("rotatedAt", { mode: "date" }).notNull().defaultNow()
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  leagueId: text("leagueId").references(() => leagues.id, { onDelete: "cascade" }),
  severity: text("severity", { enum: ["info", "warn", "alert"] }).notNull(),
  rule: text("rule").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  dismissedAt: timestamp("dismissedAt", { mode: "date" })
});

export const playersSnapshots = pgTable("players_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

// Daily snapshot of a FantasyPros consensus-rankings page (one row per
// scoring variant per fetch). Source string is the scoring code:
// "STD" | "PPR" | "HALF". The cron upserts roughly one row/day per scoring
// and prunes anything older than 7 days, identically to players_snapshots.
export const rankingsSnapshots = pgTable("rankings_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

// KeepTradeCut trade-value snapshot. Mirror of rankings_snapshots — one
// row per variant per fetch. source is the KTC variant code: "dynasty" |
// "redraft". Same 7-day retention pruned by the cron.
export const ktcSnapshots = pgTable("ktc_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

// Multi-statement DDL kept as a plain string. The bootstrap route splits it on
// `;` and applies each statement individually — postgres.js sends one command
// per query, so a single multi-statement call would be rejected.
export const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    "emailVerified" TIMESTAMP,
    image TEXT,
    "passwordHash" TEXT
  );
  CREATE TABLE IF NOT EXISTS accounts (
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    PRIMARY KEY (provider, "providerAccountId")
  );
  CREATE TABLE IF NOT EXISTS sessions (
    "sessionToken" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires TIMESTAMP NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "verificationTokens" (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TIMESTAMP NOT NULL,
    PRIMARY KEY (identifier, token)
  );
  CREATE TABLE IF NOT EXISTS leagues (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    "externalLeagueId" TEXT NOT NULL,
    season INTEGER NOT NULL,
    label TEXT NOT NULL,
    settings JSONB,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now()
  );
  ALTER TABLE leagues ADD COLUMN IF NOT EXISTS settings JSONB;
  ALTER TABLE leagues ADD COLUMN IF NOT EXISTS "sleeperUsername" TEXT;
  CREATE TABLE IF NOT EXISTS "leagueCredentials" (
    "leagueId" TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
    iv BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    "rotatedAt" TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "leagueId" TEXT REFERENCES leagues(id) ON DELETE CASCADE,
    severity TEXT NOT NULL,
    rule TEXT NOT NULL,
    message TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    "dismissedAt" TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS notifications_user_created
    ON notifications ("userId", "createdAt" DESC);
  CREATE TABLE IF NOT EXISTS players_snapshots (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
    "sizeBytes" INTEGER NOT NULL,
    payload JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS players_snapshots_source_fetched
    ON players_snapshots (source, "fetchedAt" DESC);
  CREATE TABLE IF NOT EXISTS rankings_snapshots (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
    "sizeBytes" INTEGER NOT NULL,
    payload JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rankings_snapshots_source_fetched
    ON rankings_snapshots (source, "fetchedAt" DESC);
  CREATE TABLE IF NOT EXISTS ktc_snapshots (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
    "sizeBytes" INTEGER NOT NULL,
    payload JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ktc_snapshots_source_fetched
    ON ktc_snapshots (source, "fetchedAt" DESC);
`;
