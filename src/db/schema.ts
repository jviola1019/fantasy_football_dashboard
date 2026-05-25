import { sqliteTable, text, integer, blob, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  passwordHash: text("passwordHash")
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

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  leagueId: text("leagueId").references(() => leagues.id, { onDelete: "cascade" }),
  severity: text("severity", { enum: ["info", "warn", "alert"] }).notNull(),
  rule: text("rule").notNull(),
  message: text("message").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  dismissedAt: integer("dismissedAt", { mode: "timestamp_ms" })
});

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

export type DbUser = typeof users.$inferSelect;
export type DbLeague = typeof leagues.$inferSelect;
export type DbLeagueCredential = typeof leagueCredentials.$inferSelect;
export type DbPlayersSnapshot = typeof playersSnapshots.$inferSelect;
export type DbNotification = typeof notifications.$inferSelect;
