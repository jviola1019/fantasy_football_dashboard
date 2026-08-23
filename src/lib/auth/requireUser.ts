import { auth } from "../auth";
import { getDb, type Db } from "../../db";
import { verifySessionUser, type VerifiedUser } from "./session";

/**
 * The single authorization choke point for Node-runtime code (audit F-004).
 *
 * Before this there was none: ~16 sites called `auth()` directly and trusted
 * `session.user.id`, which is a stateless claim. Nothing consulted the database,
 * so a token kept working after a password change and even after the account was
 * deleted.
 *
 * `requireUser()` re-validates against the DB on every protected read: the user
 * must still exist AND the token's session generation must match the stored one.
 * It returns null instead of throwing so each caller keeps its own idiomatic
 * rejection (401 JSON for route handlers, redirect for pages, a result object
 * for server actions).
 *
 * The Edge proxy deliberately does NOT use this — it cannot reach the database
 * and remains defense-in-depth only. Enforcement lives here, at the point of
 * use, which is what `GHSA-6gpp-xcg3-4w24` (proxy-bypass) argues for.
 */
export async function requireUser(db: Db = getDb()): Promise<VerifiedUser | null> {
  const session = await auth().catch(() => null);
  const tokenVersion = (session?.user as { sessionVersion?: number } | undefined)?.sessionVersion;
  return verifySessionUser(session, tokenVersion, db);
}
