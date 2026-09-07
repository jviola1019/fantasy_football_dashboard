/**
 * Run a raw SQL statement against whichever driver is actually behind `db`.
 *
 * WHY THIS EXISTS, AND WHAT IT COST TO LEARN.
 *
 * The two drivers do not share a raw-query method. better-sqlite3's drizzle
 * adapter exposes `run` / `all` / `get`; postgres-js's exposes `execute`.
 * Neither has the other's. `Db` is typed for better-sqlite3, so TypeScript will
 * happily accept `db.run(...)` in code that only ever runs on Postgres and say
 * nothing.
 *
 * `src/lib/ops/schemaProbe.ts` did exactly that. It shipped in PR #46, every
 * test passed because `resetDbForTests()` hands back SQLite, and it turned
 * `/api/health` into a 500 in production — the endpoint added specifically to
 * make the manual schema init verifiable. CI was 14/14 green throughout.
 *
 * The knowledge already existed in the codebase, three times over and in three
 * different shapes: `api/admin/init-db/route.ts` casts to a local `PgExec`
 * interface, `db/snapshotStore.ts` branches on `getDriver()` then casts inline,
 * and the Postgres integration tests reach for `(db as any).execute`. A fact
 * that has to be rediscovered at every call site eventually is not, and this is
 * the call site where it was not.
 *
 * CAPABILITY DETECTION, NOT A DRIVER FLAG. This asks the object what it can do
 * rather than asking global state what driver is active, so it is correct for an
 * INJECTED database — which is what makes the Postgres regression test possible
 * at all. `getDriver()` calls `getDb()`, so a driver-flag version would report
 * on the ambient database while running against the passed one, which is its own
 * flavour of the same bug.
 */
import type { SQL } from "drizzle-orm";

interface SqliteLike {
  run: (query: SQL) => unknown;
}
interface PostgresLike {
  execute: (query: SQL) => Promise<unknown>;
}

/** True when `db` is the postgres-js adapter. */
export function isPostgresDb(db: unknown): db is PostgresLike {
  return typeof (db as Partial<PostgresLike> | null)?.execute === "function";
}

export async function execRaw(db: unknown, query: SQL): Promise<void> {
  if (isPostgresDb(db)) {
    await db.execute(query);
    return;
  }
  const sqlite = db as Partial<SqliteLike> | null;
  if (typeof sqlite?.run === "function") {
    await sqlite.run(query);
    return;
  }
  // Neither method present. Throwing beats silently doing nothing: a probe that
  // executes no query would report every table healthy.
  throw new Error("execRaw: database exposes neither `execute` (postgres) nor `run` (sqlite)");
}
