import { and, eq } from "drizzle-orm";
import { decrypt, encrypt, getCredentialKey } from "./crypto";
import { schema } from "../db";
import type { LeagueFormat } from "./trade/format";

export type LeaguePlatform = "sleeper" | "espn";

export interface CreateLeagueInput {
  userId: string;
  platform: LeaguePlatform;
  externalLeagueId: string;
  season: number;
  label: string;
  /** ESPN private leagues; required for espn, optional/ignored otherwise. */
  credentials?: { espnS2: string; swid: string };
  /** Detected league format from verification; persisted as JSON. */
  settings?: LeagueFormat;
  /** Sleeper-only: the user's Sleeper username used to identify their roster. */
  sleeperUsername?: string;
}

export interface DecryptedCredentials {
  espnS2: string;
  swid: string;
}

export interface LeagueRecord {
  id: string;
  userId: string;
  platform: LeaguePlatform;
  externalLeagueId: string;
  season: number;
  label: string;
  settings: LeagueFormat | null;
  /** Sleeper-only: stored so we can resolve the user's roster_id at query time. */
  sleeperUsername: string | null;
  createdAt: Date;
}

type Db = ReturnType<typeof import("../db").getDb>;

/**
 * Find a user's existing league by its external identity (platform +
 * externalLeagueId + season). Scoped to the user so the same Sleeper/ESPN id
 * under two accounts is never treated as the same league. Returns null if none.
 */
export async function findUserLeagueByExternal(
  db: Db,
  userId: string,
  platform: LeaguePlatform,
  externalLeagueId: string,
  season: number
): Promise<LeagueRecord | null> {
  const rows = await db
    .select()
    .from(schema.leagues)
    .where(
      and(
        eq(schema.leagues.userId, userId),
        eq(schema.leagues.platform, platform),
        eq(schema.leagues.externalLeagueId, externalLeagueId),
        eq(schema.leagues.season, season)
      )
    )
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function createLeague(db: Db, input: CreateLeagueInput): Promise<LeagueRecord> {
  if (input.platform === "espn" && !input.credentials) {
    throw new Error("ESPN private leagues require espn_s2 + SWID cookies");
  }
  // Duplicate guard: a user re-adding the same league for the same season must
  // not create a second (often hollow) row. Per-user + per-season so the same
  // league id under another account, or the same id for a new season, is fine.
  const existing = await findUserLeagueByExternal(
    db,
    input.userId,
    input.platform,
    input.externalLeagueId,
    input.season
  );
  if (existing) {
    throw new Error("duplicate league: already added for this user and season");
  }
  const inserted = await db
    .insert(schema.leagues)
    .values({
      userId: input.userId,
      platform: input.platform,
      externalLeagueId: input.externalLeagueId,
      season: input.season,
      label: input.label,
      settings: input.settings ? JSON.stringify(input.settings) : null,
      sleeperUsername: input.sleeperUsername ?? null
    })
    .returning();
  const row = inserted[0]!;
  if (input.credentials) {
    const key = getCredentialKey();
    const sealed = encrypt(JSON.stringify(input.credentials), key);
    await db.insert(schema.leagueCredentials).values({
      leagueId: row.id,
      iv: sealed.iv,
      authTag: sealed.authTag,
      ciphertext: sealed.ciphertext
    });
  }
  return toRecord(row);
}

export async function listLeagues(db: Db, userId: string): Promise<LeagueRecord[]> {
  const rows = await db.select().from(schema.leagues).where(eq(schema.leagues.userId, userId));
  return rows.map(toRecord);
}

export async function getLeagueForUser(db: Db, userId: string, leagueId: string): Promise<LeagueRecord | null> {
  const rows = await db
    .select()
    .from(schema.leagues)
    .where(and(eq(schema.leagues.userId, userId), eq(schema.leagues.id, leagueId)))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function deleteLeagueForUser(db: Db, userId: string, leagueId: string): Promise<boolean> {
  const result = await db
    .delete(schema.leagues)
    .where(and(eq(schema.leagues.userId, userId), eq(schema.leagues.id, leagueId)))
    .returning({ id: schema.leagues.id });
  return result.length > 0;
}

export async function getLeagueCredentials(db: Db, leagueId: string): Promise<DecryptedCredentials | null> {
  const rows = await db
    .select()
    .from(schema.leagueCredentials)
    .where(eq(schema.leagueCredentials.leagueId, leagueId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const key = getCredentialKey();
  const plaintext = decrypt(
    {
      iv: toBuffer(row.iv),
      authTag: toBuffer(row.authTag),
      ciphertext: toBuffer(row.ciphertext)
    },
    key
  );
  return JSON.parse(plaintext) as DecryptedCredentials;
}

function toRecord(row: typeof schema.leagues.$inferSelect): LeagueRecord {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform as LeaguePlatform,
    externalLeagueId: row.externalLeagueId,
    season: row.season,
    label: row.label,
    settings: parseSettings(row.settings),
    sleeperUsername: row.sleeperUsername ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
  };
}

// `settings` is stored as TEXT on SQLite (a JSON-encoded string) and as JSONB
// on Postgres (postgres-js auto-decodes JSONB into a JS object). Calling
// JSON.parse on an already-decoded object would coerce it to "[object Object]"
// and throw, which is the production crash this branch fixes.
function parseSettings(raw: unknown): LeagueFormat | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    if (raw.length === 0) return null;
    return JSON.parse(raw) as LeagueFormat;
  }
  if (typeof raw === "object") return raw as LeagueFormat;
  return null;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw new Error("invalid encrypted column type");
}
