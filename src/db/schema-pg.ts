import { pgTable, text, integer, timestamp, primaryKey, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

export const INIT_SQL = sql`
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
    "createdAt" TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS "leagueCredentials" (
    "leagueId" TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
    iv BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    "rotatedAt" TIMESTAMP NOT NULL DEFAULT now()
  );
`;
