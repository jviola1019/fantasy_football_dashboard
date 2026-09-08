/**
 * Create any missing CORE table automatically, so a deploy can never again ship
 * code that reads a table the database has not been told about.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Core tables were created by exactly one manual, token-gated action:
 * `POST /api/admin/init-db`. Snapshot tables already self-heal at runtime
 * (`snapshotStore.ts::ensureTable`), so the asymmetry was never principled —
 * just unfinished.
 *
 * The cost of that gap, measured on 2026-09-07: production was missing BOTH
 * `accountCredentials` (added in PR #43) and `auth_attempts`. The first meant
 * the ESPN account sign-in could store nothing, so a user's ESPN leagues could
 * not reach the app at all. The second is the login throttle table, and
 * `checkThrottle` reads it with no error handling from a `login/actions.ts` call
 * site that has no try/catch — so sign-in itself was failing. Nobody knew,
 * because the only signal was an endpoint that returned 500.
 *
 * A manual step that must be remembered after every schema change will be
 * forgotten. This removes it.
 *
 * ── DDL ONLY. THIS IS THE LOAD-BEARING PART. ──────────────────────────────
 *
 * `INIT_SQL` is not purely idempotent and must NOT be replayed wholesale. It
 * ends with two one-time backfills, and the second one is actively destructive
 * on a live database:
 *
 *   UPDATE notifications SET status = CASE ... END
 *    WHERE status IS NULL OR status = 'new'
 *
 * `'new'` is a LIVE state — `schema.ts` defines it as "just created, never
 * listed to the user" — not a legacy null to be cleaned up. Replaying that on
 * every cold start would silently promote every unseen notification to
 * `'active'` and destroy the distinction the lifecycle depends on.
 *
 * So this applies only statements that CREATE or ALTER structure, every one of
 * which carries `IF NOT EXISTS`. The backfills stay where they belong: in the
 * manual init route, which runs once against a database being upgraded.
 * `ensureCoreSchema.test.ts` asserts the filter excludes them.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *
 * Postgres only — SQLite is already handled by `applySqliteSchemaIfNeeded`.
 * Memoised per process, so a warm serverless instance pays nothing. Concurrent
 * cold starts racing each other is benign: every statement is `IF NOT EXISTS`.
 * Failures are reported and rethrown by the caller's choice rather than
 * swallowed — a database that cannot accept DDL is not a condition to hide,
 * and `/api/health` will name whatever is still missing either way.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./index";
import { INIT_SQL } from "./schema-pg";
import { execRaw, isPostgresDb } from "./execRaw";

/** Statements that create or alter structure. Deliberately excludes DML. */
export function coreSchemaDdl(): string[] {
  return INIT_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => /^(CREATE|ALTER)\b/i.test(s));
}

/** Statements in INIT_SQL this deliberately does NOT run. Exposed for the test. */
export function coreSchemaSkipped(): string[] {
  return INIT_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^(CREATE|ALTER)\b/i.test(s));
}

let inFlight: Promise<EnsureResult> | null = null;

export interface EnsureResult {
  driver: "postgres" | "sqlite";
  applied: number;
  skipped: number;
}

/**
 * Apply the core DDL once per process. Safe to call from anywhere, any number
 * of times.
 */
export function ensureCoreSchema(db: unknown = getDb()): Promise<EnsureResult> {
  inFlight ??= run(db);
  return inFlight;
}

async function run(db: unknown): Promise<EnsureResult> {
  const skipped = coreSchemaSkipped().length;
  if (!isPostgresDb(db)) {
    // SQLite creates everything in `applySqliteSchemaIfNeeded` at connect time.
    return { driver: "sqlite", applied: 0, skipped };
  }
  const ddl = coreSchemaDdl();
  for (const statement of ddl) {
    await execRaw(db, sql.raw(statement));
  }
  return { driver: "postgres", applied: ddl.length, skipped };
}

/** Test seam only — lets a suite re-run the ensure against a fresh schema. */
export function resetEnsureCoreSchemaForTests(): void {
  inFlight = null;
}
