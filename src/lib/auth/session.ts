import { eq, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "../../db";

/**
 * Server-enforced session revocation (audit 2026-08-06 F-004).
 *
 * The problem: sessions are stateless JWTs. `changeUserPassword()` updated only
 * the hash — its own docblock said "Caller is responsible for invalidating
 * sessions if needed" and no caller ever did. Deleting an account cleared only
 * the requesting browser's cookie. A stolen token therefore stayed valid after
 * the victim changed their password, which is the single thing a password
 * change is expected to accomplish.
 *
 * Why not database sessions, which were the preferred design? Auth.js refuses
 * them for this app. Verified in the installed source,
 * `@auth/core/lib/utils/assert.js:114-119`:
 *
 *     if (hasCredentials) {
 *       const dbStrategy = options.session?.strategy === "database";
 *       const onlyCredentials = !options.providers.some(p => p.type !== "credentials");
 *       if (dbStrategy && onlyCredentials)
 *         return new UnsupportedStrategy("Signing in with credentials only supported if JWT strategy is enabled");
 *     }
 *
 * RAE ships exactly one provider (Credentials), so `onlyCredentials` is true and
 * setting `strategy: "database"` makes Auth.js refuse to start. Reaching database
 * sessions would require adding a non-credentials provider or overriding
 * jwt.encode/decode to smuggle opaque tokens into the sessions table — a larger,
 * unsupported change.
 *
 * What this does instead delivers the actual security property: every token
 * carries the user's `sessionVersion`, and the server compares it against the
 * database on each protected read. Bumping the column invalidates every
 * outstanding token for that user, on every device, immediately. Revocation is
 * enforced server-side — never by asking the client to drop a cookie.
 */

export interface VerifiedUser {
  id: string;
  email: string | null;
  name: string | null;
  sessionVersion: number;
}

/**
 * Resolve the user behind a session, or null when the token must be rejected.
 *
 * Returns null when: there is no session, the user row is gone (deleted account
 * — a stateless token would otherwise outlive its owner), or the token's
 * `sessionVersion` does not match the stored one (revoked).
 *
 * A token issued BEFORE this feature shipped carries no version claim. Those are
 * rejected rather than grandfathered: the cutover must not leave a window in
 * which an old token is unrevokable. Users sign in once more; that is intended
 * and documented.
 */
export async function verifySessionUser(
  session: { user?: { id?: string | null } | null } | null,
  tokenVersion: number | null | undefined,
  db: Db = getDb()
): Promise<VerifiedUser | null> {
  const userId = session?.user?.id;
  if (!userId) return null;
  if (typeof tokenVersion !== "number") return null;

  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      sessionVersion: schema.users.sessionVersion
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null; // deleted user — token must not outlive the account
  if (row.sessionVersion !== tokenVersion) return null; // revoked

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    sessionVersion: row.sessionVersion
  };
}

/**
 * Invalidate every outstanding session for a user by advancing the generation.
 *
 * Uses a SQL increment rather than read-then-write so two concurrent revocations
 * (e.g. a password change racing an admin action) cannot both read the same
 * value and leave one of them ineffective.
 */
export async function revokeAllSessions(userId: string, db: Db = getDb()): Promise<number> {
  const updated = await db
    .update(schema.users)
    .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, userId))
    .returning({ sessionVersion: schema.users.sessionVersion });
  return updated[0]?.sessionVersion ?? 0;
}

/** The current generation for a user, or null when the user does not exist. */
export async function getSessionVersion(userId: string, db: Db = getDb()): Promise<number | null> {
  const rows = await db
    .select({ sessionVersion: schema.users.sessionVersion })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.sessionVersion ?? null;
}
