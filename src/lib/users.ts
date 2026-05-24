import { eq } from "drizzle-orm";
import { schema } from "../db";
import { hashPassword, verifyPassword } from "./passwords";

type Db = ReturnType<typeof import("../db").getDb>;

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

export async function createUserWithPassword(db: Db, input: CreateUserInput): Promise<AuthenticatedUser> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("invalid email");
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing[0]) throw new Error("user already exists");
  const passwordHash = await hashPassword(input.password);
  const inserted = await db
    .insert(schema.users)
    .values({ email, name: input.name ?? null, passwordHash })
    .returning();
  const row = inserted[0]!;
  return { id: row.id, email: row.email!, name: row.name };
}

export async function authenticateUser(db: Db, email: string, password: string): Promise<AuthenticatedUser | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;
  return { id: row.id, email: row.email!, name: row.name };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: "user-not-found" | "wrong-current-password" | "invalid-new-password" };

/**
 * Verify the user's current password, then replace passwordHash. Re-uses the
 * scrypt verifier + hasher in lib/passwords so the storage format stays
 * consistent. Caller is responsible for invalidating sessions if needed —
 * we don't touch the sessions table because the Credentials provider issues
 * JWT sessions that aren't DB-backed.
 */
export async function changeUserPassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return { ok: false, error: "invalid-new-password" };
  }
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) return { ok: false, error: "user-not-found" };
  const ok = await verifyPassword(currentPassword, row.passwordHash);
  if (!ok) return { ok: false, error: "wrong-current-password" };
  const passwordHash = await hashPassword(newPassword);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  return { ok: true };
}

export type DeleteUserResult = { ok: true } | { ok: false; error: "user-not-found" | "wrong-password" };

/**
 * Delete the user row. Foreign keys with ON DELETE CASCADE in the schema
 * remove their leagues, leagueCredentials, accounts, sessions, and
 * notifications automatically — same data-loss semantics they'd get if
 * they manually deleted the row in the database.
 *
 * Requires the current password as confirmation so an attacker who hijacks
 * a session can't drop the account in a single click.
 */
export async function deleteUserWithPassword(
  db: Db,
  userId: string,
  currentPassword: string
): Promise<DeleteUserResult> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) return { ok: false, error: "user-not-found" };
  const ok = await verifyPassword(currentPassword, row.passwordHash);
  if (!ok) return { ok: false, error: "wrong-password" };
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return { ok: true };
}
