/**
 * Is this error "that table does not exist"?
 *
 * WHY THIS IS A NAMED CONCEPT AND NOT AN INLINE `catch {}`.
 *
 * Core tables in this app are created by ONE token-gated operator action,
 * `POST /api/admin/init-db`, which applies `INIT_SQL`. Nothing applies that DDL
 * automatically on Postgres — only the snapshot tables self-heal at runtime
 * (`ensure*Table`). So a deployment can legitimately be running a build whose
 * schema declares a table the database has not been told about yet, in the
 * window between merging and the operator running init.
 *
 * `accountCredentials` shipped in that state: PR #43 added it to all five schema
 * homes, and nothing read it, so the gap was invisible. The moment a rendered
 * page reads it, that same gap becomes a 500 on `/settings/account` — taking
 * change-password and delete-account down with a feature neither depends on.
 *
 * The rule this enables is narrow on purpose: a MISSING TABLE is a deployment
 * state a page may describe honestly ("storage is not initialised"), and every
 * other database error is still a fault that must propagate. Swallowing the
 * rest would turn a broken connection into a serene "nothing saved yet", which
 * is the kind of lie the guardrails exist to prevent.
 */

/** Postgres `undefined_table`. */
const PG_UNDEFINED_TABLE = "42P01";

export function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === PG_UNDEFINED_TABLE) return true;
  const message = err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? "");
  // postgres.js surfaces the code; better-sqlite3 and some drizzle wrappers only
  // give a message. Both dialects are matched, and neither pattern can match a
  // connection, permission or constraint failure.
  return /relation ".*" does not exist/i.test(message) || /no such table/i.test(message);
}

/**
 * Run a read that is allowed to find its table missing.
 *
 * Returns `fallback` only for a missing relation; every other error is rethrown
 * untouched, with its stack intact.
 */
export async function readOrUninitialised<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isMissingRelation(err)) return fallback;
    throw err;
  }
}
