import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  customType,
  jsonb,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";

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
  passwordHash: text("passwordHash"),
  /** See schema.ts — session generation for server-side revocation (F-004). */
  sessionVersion: integer("sessionVersion").notNull().default(1)
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

/** Mirrors NOTIFICATION_STATUSES in schema.ts — keep the two in lockstep. */
export const NOTIFICATION_STATUSES = [
  "new",
  "active",
  "dismissed",
  "resolved",
  "expired",
  "reopened"
] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leagueId: text("leagueId").references(() => leagues.id, { onDelete: "cascade" }),
    severity: text("severity", { enum: ["info", "warn", "alert"] }).notNull(),
    rule: text("rule").notNull(),
    message: text("message").notNull(),
    /** See schema.ts — persisted dedup identity (audit F-003). */
    dedupKey: text("dedupKey").notNull(),
    status: text("status", { enum: NOTIFICATION_STATUSES }).notNull().default("new"),
    occurrences: integer("occurrences").notNull().default(1),
    season: integer("season"),
    week: integer("week"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolvedAt", { mode: "date" }),
    dismissedAt: timestamp("dismissedAt", { mode: "date" })
  },
  (table) => [
    uniqueIndex("notifications_user_dedup").on(table.userId, table.dedupKey),
    index("notifications_user_created").on(table.userId, table.createdAt)
  ]
);

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

// Sleeper per-week projections snapshot. source is keyed by "{season}-{week}"
// (e.g. "2025-1") so a single table holds every cached week. Payload is the
// flattened per-player map (sleeperPlayerId -> { pts_ppr, pts_half_ppr,
// pts_std, position, team, opponent }).
export const projectionsSnapshots = pgTable("projections_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

// Daily ESPN NFL news snapshot. source is a fixed key "espn-nfl" so the
// most-recent row is always the active snapshot. Payload is a JSON array of
// EspnNewsArticle objects (id, headline, lastModified, categories[]).
export const newsSnapshots = pgTable("news_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

export const opportunitySnapshots = pgTable("opportunity_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: jsonb("payload").notNull()
});

// ─── Snapshot-table DDL: single source of truth ──────────────────────────────
// All snapshot tables (SNAPSHOT_TABLES below) share an identical shape.
// Defining the DDL once here (and composing INIT_SQL + the runtime
// ensure*Table self-heal from it) removes the hand-kept copies that previously
// drifted. The snapshot store factory (src/db/snapshotStore.ts) and the SQLite
// bootstrap (src/db/index.ts sqliteSnapshotDdl) consume the same source list.

export const SNAPSHOT_TABLES = [
  "players_snapshots",
  "rankings_snapshots",
  "ktc_snapshots",
  "projections_snapshots",
  "news_snapshots",
  "opportunity_snapshots"
] as const;

export type SnapshotTableName = (typeof SNAPSHOT_TABLES)[number];

/** `CREATE TABLE IF NOT EXISTS` for a snapshot table (no trailing semicolon). */
export function snapshotTableSql(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
    "sizeBytes" INTEGER NOT NULL,
    payload JSONB NOT NULL
  )`;
}

/** `CREATE INDEX IF NOT EXISTS` on (source, fetchedAt DESC) (no trailing semicolon). */
export function snapshotIndexSql(table: string): string {
  return `CREATE INDEX IF NOT EXISTS ${table}_source_fetched
    ON ${table} (source, "fetchedAt" DESC)`;
}

const SNAPSHOT_DDL = SNAPSHOT_TABLES.map(
  (t) => `  ${snapshotTableSql(t)};\n  ${snapshotIndexSql(t)};`
).join("\n");

// Multi-statement DDL kept as a plain string. The bootstrap route splits it on
// `;` and applies each statement individually — postgres.js sends one command
// per query, so a single multi-statement call would be rejected. The snapshot
// tables are appended from SNAPSHOT_DDL above (single source of truth).
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
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 1;
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
    "dedupKey" TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    occurrences INTEGER NOT NULL DEFAULT 1,
    season INTEGER,
    week INTEGER,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
    "resolvedAt" TIMESTAMP,
    "dismissedAt" TIMESTAMP
  );
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "dedupKey" TEXT NOT NULL DEFAULT '';
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS occurrences INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS season INTEGER;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS week INTEGER;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now();
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP;
  UPDATE notifications SET "dedupKey" = 'legacy:' || id WHERE "dedupKey" IS NULL OR "dedupKey" = '';
  UPDATE notifications SET status = CASE WHEN "dismissedAt" IS NOT NULL THEN 'dismissed' ELSE 'active' END
    WHERE status IS NULL OR status = 'new';
  CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedup
    ON notifications ("userId", "dedupKey");
  CREATE INDEX IF NOT EXISTS notifications_user_created
    ON notifications ("userId", "createdAt" DESC);
${SNAPSHOT_DDL}
`;
