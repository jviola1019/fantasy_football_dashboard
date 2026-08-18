import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresDb, type Db } from "../../db";
import { INIT_SQL } from "../../db/schema-pg";
import {
  checkThrottle,
  readThrottleState,
  recordFailure,
  THROTTLE_RULES,
  throttleKey
} from "./throttle";

/**
 * Auth-throttle atomicity against REAL Postgres (audit P1 §5).
 *
 * The SQLite concurrency suite proves the SQL is correct, but its parallelism
 * is microtask interleaving over a synchronous driver. postgres.js is genuinely
 * asynchronous over a connection pool, so `Promise.all` here dispatches
 * statements that are in flight on separate backends at the same instant —
 * true row-level contention, which is the condition the fix actually has to
 * survive in production.
 *
 * It also proves the SQL is dialect-portable. The transition relies on
 * table-qualified column references inside `ON CONFLICT DO UPDATE` resolving to
 * the PRE-UPDATE row, and on quoted camelCase identifiers; both differ enough
 * between engines that SQLite passing is not evidence for Postgres.
 *
 * Gated on RAE_PG_TEST_URL. THROWAWAY database only — this drops the schema.
 *   RAE_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/rae_test \
 *     npx vitest run src/lib/auth/throttle.pg.integration.test.ts
 */
const PG_URL = process.env.RAE_PG_TEST_URL;
const pg = PG_URL ? describe : describe.skip;

async function raw(db: Db, query: string): Promise<unknown[]> {
  const { sql } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any).execute(sql.raw(query));
  return Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []);
}

pg("Postgres auth-throttle concurrency", () => {
  let db: Db;
  const T0 = new Date("2026-08-16T12:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  const account = "pg-victim@example.com";
  const ip = "203.0.113.44";
  const accountKey = throttleKey("account", account);
  const ipKey = throttleKey("ip", ip);

  /**
   * A DEDICATED schema, not `public`.
   *
   * Vitest runs test files in parallel. Three PG suites each doing
   * `DROP SCHEMA public CASCADE` in beforeAll destroy each other's tables
   * mid-run — they pass individually and fail together, which is the most
   * misleading failure mode available. `createPostgresDb` uses `max: 1`, so a
   * single `SET search_path` pins every subsequent query on that connection.
   */
  const SCHEMA = "rae_test_throttle";

  beforeAll(async () => {
    db = createPostgresDb(PG_URL!);
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await raw(db, `CREATE SCHEMA ${SCHEMA}`);
    await raw(db, `SET search_path TO ${SCHEMA}`);
    for (const statement of INIT_SQL.split(";")) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await raw(db, trimmed);
    }
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    await raw(db, "TRUNCATE TABLE auth_attempts");
  });

  const parallelFailures = (n: number, ids: { account?: string; ip?: string }, when = T0) =>
    Promise.all(Array.from({ length: n }, () => recordFailure(ids, when, db)));

  it("stores auth_attempts as epoch-ms integer columns, not timestamps", async () => {
    // The counter deliberately avoids native timestamp columns (audit F-011);
    // if the PG DDL drifted to `timestamp` the arithmetic below would break.
    const rows = (await raw(
      db,
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'auth_attempts' ORDER BY column_name`
    )) as Array<{ column_name: string; data_type: string }>;
    const byName = new Map(rows.map((r) => [String(r.column_name), String(r.data_type)]));

    expect(byName.get("attempts")).toContain("integer");
    expect(byName.get("windowStart")).toContain("bigint");
    expect(byName.get("lockedUntil")).toContain("bigint");
  });

  it("counts 2 truly simultaneous failures as 2", async () => {
    await parallelFailures(2, { account });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(2);
  });

  it("counts 10 truly simultaneous failures as 10", async () => {
    await parallelFailures(10, { account });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(10);
  });

  it("counts account, IP and global dimensions independently in one burst", async () => {
    await parallelFailures(7, { account, ip });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(7);
    expect((await readThrottleState(ipKey, db))!.attempts).toBe(7);
    expect((await readThrottleState("global", db))!.attempts).toBe(7);
  });

  it("crosses the threshold exactly at the limit under contention", async () => {
    await parallelFailures(THROTTLE_RULES.account.max, { account });

    const state = (await readThrottleState(accountKey, db))!;
    expect(state.attempts).toBe(THROTTLE_RULES.account.max);
    expect(state.lockedUntil).toBe(T0.getTime() + THROTTLE_RULES.account.lockMs);
    expect((await checkThrottle({ account }, T0, db)).blockedBy).toBe("account");
  });

  it("locks the IP dimension across a parallel walk of many accounts", async () => {
    await Promise.all(
      Array.from({ length: THROTTLE_RULES.ip.max }, (_, i) =>
        recordFailure({ account: `pg-user${i}@example.com`, ip }, T0, db)
      )
    );
    expect((await readThrottleState(ipKey, db))!.attempts).toBe(THROTTLE_RULES.ip.max);
    expect((await checkThrottle({ ip }, T0, db)).blockedBy).toBe("ip");
  });

  it("holds the global ceiling under a parallel distributed attempt", async () => {
    await Promise.all(
      Array.from({ length: THROTTLE_RULES.global.max }, (_, i) =>
        recordFailure({ account: `pg-d${i}@example.com`, ip: `198.51.100.${i % 250}` }, T0, db)
      )
    );
    expect((await readThrottleState("global", db))!.attempts).toBe(THROTTLE_RULES.global.max);
    expect((await checkThrottle({ account: "pg-fresh@example.com" }, T0, db)).blockedBy).toBe("global");
  });

  it("restarts the window exactly once when a burst straddles expiry", async () => {
    await parallelFailures(3, { account }, T0);
    const afterWindow = at(THROTTLE_RULES.account.windowMs + 1);
    await parallelFailures(4, { account }, afterWindow);

    const state = (await readThrottleState(accountKey, db))!;
    expect(state.attempts).toBe(4);
    expect(state.windowStart).toBe(afterWindow.getTime());
  });

  it("restarts counting once after the lock lapses", async () => {
    await parallelFailures(THROTTLE_RULES.account.max, { account }, T0);
    const afterLock = at(THROTTLE_RULES.account.lockMs + 1);
    await parallelFailures(3, { account }, afterLock);

    const state = (await readThrottleState(accountKey, db))!;
    expect(state.attempts).toBe(3);
    expect(state.lockedUntil).toBeNull();
  });

  it("does NOT slide an active lock forward on further failures", async () => {
    await parallelFailures(THROTTLE_RULES.account.max, { account }, T0);
    const lockedUntil = (await readThrottleState(accountKey, db))!.lockedUntil;

    await parallelFailures(5, { account }, at(60_000));

    expect((await readThrottleState(accountKey, db))!.lockedUntil).toBe(lockedUntil);
    expect((await checkThrottle({ account }, at(THROTTLE_RULES.account.lockMs + 1), db)).allowed).toBe(true);
  });

  it("rejects a duplicate key at the DB level, so only one row per key exists", async () => {
    await parallelFailures(12, { account, ip });
    const rows = (await raw(db, "SELECT count(*)::int AS n FROM auth_attempts")) as Array<{ n: number }>;
    // account + ip + global, and nothing duplicated by the concurrent upserts.
    expect(Number(rows[0]!.n)).toBe(3);
  });
});
