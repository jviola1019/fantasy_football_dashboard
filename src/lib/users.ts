import { eq, sql } from "drizzle-orm";
import { schema } from "../db";
import { hashPassword, needsRehash, verifyPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./passwords";

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
  /** Session generation stamped into the issued token (audit F-004). */
  sessionVersion: number;
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
  return { id: row.id, email: row.email!, name: row.name, sessionVersion: row.sessionVersion };
}

// Timing equalizer (audit 2026-07-08 A-05): a valid-format scrypt hash of the
// arbitrary, NON-secret string "rae-timing-equalizer-not-a-secret". When the
// email has no row (or no password hash) we still burn one scrypt verification
// against this constant so "unknown email" costs the same as "wrong password" —
// otherwise the gap is a user-enumeration oracle on the login form.
// Nothing can ever authenticate against it: that branch always returns null.
//
// Audit 2026-08-06 F-005: this MUST track CURRENT_PROFILE. It was a scrypt1
// hash; once new hashes became scrypt2 (~574 ms vs ~124 ms) an unknown account
// would have returned ~450 ms faster than a real one, re-opening the very
// oracle the equalizer exists to close. Regenerated under scrypt2. A test
// asserts the version matches CURRENT_PROFILE so this cannot drift again.
const TIMING_EQUALIZER_HASH =
  "scrypt2$twHJaThBUefI3oQBQVoAoQ==$iT0mTi20jaAgC8iEA4bwCFdsust8WTWjOVUqYpxEdEzYK68C1b+TxxPRQSoJ75VFx5tijUyFBnQLI8u+wcoBiw==";

/** Exported for the equalizer-parity test only. */
export const TIMING_EQUALIZER_HASH_FOR_TESTS = TIMING_EQUALIZER_HASH;

export async function authenticateUser(db: Db, email: string, password: string): Promise<AuthenticatedUser | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) {
    await verifyPassword(password, TIMING_EQUALIZER_HASH);
    return null;
  }
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;

  // Migrate legacy hashes opportunistically, and ONLY after a correct password:
  // rehashing on failure would let an attacker drive expensive work with wrong
  // guesses. A failure here must not break a valid login, so it is swallowed —
  // the user simply stays on the old profile until next time.
  if (needsRehash(row.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      await db.update(schema.users).set({ passwordHash: upgraded }).where(eq(schema.users.id, row.id));
    } catch {
      // keep the successful login
    }
  }

  return { id: row.id, email: row.email!, name: row.name, sessionVersion: row.sessionVersion };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: "user-not-found" | "wrong-current-password" | "invalid-new-password" };

/**
 * Verify the user's current password, then replace passwordHash AND revoke every
 * outstanding session.
 *
 * Audit 2026-08-06 F-004: this previously updated only the hash, and its own
 * docblock delegated session invalidation to "the caller" — which no caller ever
 * did. A stolen token stayed valid after the victim changed their password.
 * Revocation now happens in the SAME UPDATE as the hash, so the two can never
 * diverge and there is no window where the password is new but old tokens still
 * work.
 */
export async function changeUserPassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  if (
    typeof newPassword !== "string" ||
    newPassword.length < MIN_PASSWORD_LENGTH ||
    newPassword.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "invalid-new-password" };
  }
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) return { ok: false, error: "user-not-found" };
  const ok = await verifyPassword(currentPassword, row.passwordHash);
  if (!ok) return { ok: false, error: "wrong-current-password" };
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, userId));
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
