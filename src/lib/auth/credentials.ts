import { z } from "zod";
import { getDb, type Db } from "../../db";
import { authenticateUser } from "../users";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../passwords";

/**
 * The credentials login path, in a module that does NOT import next-auth.
 *
 * Audit 2026-08-22, P3. This logic lived inside `src/lib/auth.ts`, which pulls
 * in `next-auth` and therefore `next/server` — so it could not be imported by a
 * unit test at all. That is why the one function in the app that exchanges a
 * password for a session had zero coverage, while `auth.config.test.ts` sat
 * next to it testing a DIFFERENT file. Untestable and untested are not the same
 * problem, and the first causes the second.
 *
 * Splitting it out costs nothing at runtime (`auth.ts` imports it) and makes the
 * security-critical half loadable anywhere.
 */

// Mirrors the bounds in app/login/actions.ts. The provider is reachable
// directly via the Auth.js route, so it must enforce them independently rather
// than trusting that the server action ran first.
export const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
});

export interface AuthorizedCredentialUser {
  id: string;
  email: string;
  name?: string;
  sessionVersion: number;
}

/**
 * Validate credentials and return the user, or null.
 *
 * EVERY rejection returns null and looks identical from outside: a caller must
 * not be able to tell a malformed email from an unknown account from a wrong
 * password, because that distinction is an account-enumeration oracle
 * (F-005 / F-009).
 */
export async function authorizeCredentials(
  raw: unknown,
  db: Db = getDb()
): Promise<AuthorizedCredentialUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const user = await authenticateUser(db, parsed.data.email, parsed.data.password);
  if (!user) return null;
  // sessionVersion rides along so the jwt callback can stamp it without a
  // second query (audit F-004).
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    sessionVersion: user.sessionVersion
  };
}
