/**
 * Server startup hook. Runs once per Next.js server instance, before any
 * request is handled.
 *
 * Its only job is to make the database schema current. Core tables used to be
 * created by one manual, token-gated action, and on 2026-09-07 production was
 * found missing `accountCredentials` (so the ESPN sign-in could store nothing)
 * and `auth_attempts` (the login throttle table, read with no error handling —
 * so sign-in itself was failing). Both had been added by deploys that shipped
 * without anyone running the init.
 *
 * A step that must be remembered after every schema change will eventually not
 * be. `ensureCoreSchema` is idempotent, DDL-only, Postgres-only and memoised,
 * so this costs a warm instance nothing.
 *
 * A FAILURE HERE MUST NOT TAKE THE SERVER DOWN. If the database is unreachable
 * at boot, refusing to start would turn a recoverable outage into a total one —
 * and the pages that do not need a database would stop serving too. It is
 * logged as structured JSON and left to `/api/health`, which names whatever is
 * still missing on every request.
 */
export async function register(): Promise<void> {
  // Edge runtime has no database driver; only the Node.js server should try.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureCoreSchema } = await import("./db/ensureCoreSchema");
    const result = await ensureCoreSchema();
    console.log(
      JSON.stringify({ event: "core-schema-ensured", ...result })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "core-schema-ensure-failed",
        reason: err instanceof Error ? err.message : String(err)
      })
    );
  }
}
