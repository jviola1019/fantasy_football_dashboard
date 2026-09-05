/**
 * Which core tables does this deployment actually have?
 *
 * WHY THIS IS NEEDED AT ALL.
 *
 * `/api/health` decided "the schema is initialized" from ONE probe against
 * `users` — a table that has existed since the first migration and therefore
 * can never be absent when a newer one is. `accountCredentials` shipped in PR
 * #43, is created only by the manual `POST /api/admin/init-db`, and nothing
 * applies that DDL automatically on Postgres. So a deployment could be missing
 * the table a rendered page reads while health reported `ok`.
 *
 * That is the same defect this repository keeps finding, sitting in the health
 * endpoint itself: a check drawing its conclusion from an input that cannot
 * exhibit the failure it is meant to detect.
 *
 * ── WHAT COUNTS AS "CORE", AND WHY SNAPSHOTS DO NOT ───────────────────────
 *
 * Core tables are the ones that exist ONLY if a human ran the init. Snapshot
 * tables (`players_snapshots`, `rankings_snapshots`, …) self-heal at runtime
 * through `ensure*Table`, so their absence is a normal pre-first-cron state, not
 * a deployment fault. Reporting those as missing would make a fresh deployment
 * permanently `degraded` for a condition that fixes itself on the next cron —
 * an alarm that is always on is an alarm nobody reads.
 *
 * ── THE LIST IS DERIVED, NOT MAINTAINED ───────────────────────────────────
 *
 * `CORE_TABLES` is computed from the Drizzle schema by subtracting the
 * self-healing snapshot tables, so a table added to the schema is covered here
 * without anyone remembering to add it. A hand-kept list is exactly what went
 * stale in `reencrypt-credentials.ts`.
 */
import { getTableName, is, sql, Table } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { SNAPSHOT_TABLES } from "../../db/schema-pg";
import { isMissingRelation } from "../../db/missingRelation";

/** Tables created only by `POST /api/admin/init-db`, derived from the schema. */
export const CORE_TABLES: readonly string[] = (Object.values(schema) as unknown[])
  .filter((v): v is Table => is(v, Table))
  .map((t) => getTableName(t))
  .filter((name, i, all) => all.indexOf(name) === i)
  .filter((name) => !(SNAPSHOT_TABLES as readonly string[]).includes(name))
  .sort();

/**
 * Probe each core table with a bounded read, returning the names that are
 * missing.
 *
 * A MISSING RELATION is the only failure treated as "missing". Anything else —
 * a permission error, a dropped connection mid-probe — is rethrown, because
 * reporting "your schema is incomplete" when the truth is "the database went
 * away" would send an operator to fix the wrong thing.
 */
export async function probeCoreTables(): Promise<string[]> {
  const db = getDb();
  const missing: string[] = [];
  for (const table of CORE_TABLES) {
    try {
      // `sql.identifier` quotes the name, and every name here comes from the
      // compiled schema rather than from a request, so this is not a user-input
      // path. LIMIT 0 asks the planner to resolve the relation without reading
      // rows — the cheapest possible existence check.
      await db.run(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 0`);
    } catch (err) {
      if (isMissingRelation(err)) {
        missing.push(table);
        continue;
      }
      throw err;
    }
  }
  return missing;
}
