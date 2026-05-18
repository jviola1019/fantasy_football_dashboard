import { and, eq } from "drizzle-orm";
import { decrypt, encrypt, getCredentialKey } from "./crypto";
import { schema } from "../db";

export type LeaguePlatform = "sleeper" | "espn";

export interface CreateLeagueInput {
  userId: string;
  platform: LeaguePlatform;
  externalLeagueId: string;
  season: number;
  label: string;
  /** ESPN private leagues; required for espn, optional/ignored otherwise. */
  credentials?: { espnS2: string; swid: string };
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
  createdAt: Date;
}

type Db = ReturnType<typeof import("../db").getDb>;

export async function createLeague(db: Db, input: CreateLeagueInput): Promise<LeagueRecord> {
  if (input.platform === "espn" && !input.credentials) {
    throw new Error("ESPN private leagues require espn_s2 + SWID cookies");
  }
  const inserted = await db
    .insert(schema.leagues)
    .values({
      userId: input.userId,
      platform: input.platform,
      externalLeagueId: input.externalLeagueId,
      season: input.season,
      label: input.label
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
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
  };
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw new Error("invalid encrypted column type");
}
