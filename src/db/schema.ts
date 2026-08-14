import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  uniqueIndex,
  index
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  passwordHash: text("passwordHash"),
  /**
   * Monotonic session generation (audit 2026-08-06 F-004). Stamped into every
   * issued token; a mismatch on the server invalidates the token. Bumping this
   * revokes EVERY outstanding session for the user, on every device, which
   * clearing one browser cookie cannot do.
   */
  sessionVersion: integer("sessionVersion").notNull().default(1)
});

export const accounts = sqliteTable(
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

export const sessions = sqliteTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull()
});

export const verificationTokens = sqliteTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

export const leagues = sqliteTable("leagues", {
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
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const leagueCredentials = sqliteTable("leagueCredentials", {
  leagueId: text("leagueId")
    .primaryKey()
    .references(() => leagues.id, { onDelete: "cascade" }),
  iv: blob("iv").notNull(),
  authTag: blob("authTag").notNull(),
  ciphertext: blob("ciphertext").notNull(),
  rotatedAt: integer("rotatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

/**
 * Lifecycle states for a notification (audit 2026-08-06 F-003).
 *   new      — just created, never listed to the user
 *   active   — surfaced and still true
 *   dismissed— user dismissed it; the same condition must NOT nag again
 *   resolved — the condition stopped being true
 *   expired  — aged out (e.g. the week it referred to has passed)
 *   reopened — a previously resolved condition recurred (a genuinely new event)
 */
export const NOTIFICATION_STATUSES = [
  "new",
  "active",
  "dismissed",
  "resolved",
  "expired",
  "reopened"
] as const;

export const notifications = sqliteTable(
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
    /**
     * Deterministic identity for the underlying condition. F-003: this was
     * computed by the rules engine and then silently DROPPED by
     * insertNotification, so the daily cron re-inserted an identical row every
     * run forever. It is now persisted and uniquely indexed with userId.
     */
    dedupKey: text("dedupKey").notNull(),
    status: text("status", { enum: NOTIFICATION_STATUSES }).notNull().default("new"),
    /** How many times the condition has been observed. */
    occurrences: integer("occurrences").notNull().default(1),
    /** Season/week the condition refers to, when it is time-bound. */
    season: integer("season"),
    week: integer("week"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    resolvedAt: integer("resolvedAt", { mode: "timestamp_ms" }),
    dismissedAt: integer("dismissedAt", { mode: "timestamp_ms" })
  },
  (table) => [
    // The uniqueness gate that makes the cron idempotent. Scoped by user so two
    // users in the same league each keep their own copy.
    uniqueIndex("notifications_user_dedup").on(table.userId, table.dedupKey),
    index("notifications_user_created").on(table.userId, table.createdAt)
  ]
);

export const playersSnapshots = sqliteTable("players_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(), // e.g. "sleeper-nfl"
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull() // JSON-encoded map; SQLite has no native JSON
});

// FantasyPros consensus rankings snapshot. Mirror of players_snapshots —
// same shape, different source domain. source is the scoring code:
// "STD" | "PPR" | "HALF".
export const rankingsSnapshots = sqliteTable("rankings_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull()
});

// KeepTradeCut trade-value snapshot. Mirror of rankings_snapshots — same
// shape, different source domain. source is the KTC variant code:
// "dynasty" | "redraft".
export const ktcSnapshots = sqliteTable("ktc_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull()
});

// Sleeper per-week projections snapshot. source is keyed by "{season}-{week}"
// (e.g. "2025-1") so a single table holds the full season's worth of weekly
// snapshots without conflict. Payload is the flattened per-player map (see
// src/lib/sleeper/projections.ts ProjectionsSnapshotPayloadSchema).
export const projectionsSnapshots = sqliteTable("projections_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull()
});

// Daily ESPN NFL news snapshot. source is a fixed key "espn-nfl" so the
// most-recent row is always the active snapshot. Payload is a JSON array of
// EspnNewsArticle objects (id, headline, lastModified, categories[]).
export const newsSnapshots = sqliteTable("news_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull()
});

export const opportunitySnapshots = sqliteTable("opportunity_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull(),
  fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  sizeBytes: integer("sizeBytes").notNull(),
  payload: text("payload").notNull()
});

export type DbUser = typeof users.$inferSelect;
export type DbLeague = typeof leagues.$inferSelect;
export type DbLeagueCredential = typeof leagueCredentials.$inferSelect;
export type DbPlayersSnapshot = typeof playersSnapshots.$inferSelect;
export type DbNotification = typeof notifications.$inferSelect;
export type DbRankingsSnapshot = typeof rankingsSnapshots.$inferSelect;
export type DbKtcSnapshot = typeof ktcSnapshots.$inferSelect;
export type DbProjectionsSnapshot = typeof projectionsSnapshots.$inferSelect;
export type DbNewsSnapshot = typeof newsSnapshots.$inferSelect;
export type DbOpportunitySnapshot = typeof opportunitySnapshots.$inferSelect;
