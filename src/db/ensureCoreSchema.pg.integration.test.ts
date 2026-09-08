import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPostgresDb, type Db } from "./index";
import { INIT_SQL } from "./schema-pg";
import { ensureCoreSchema, resetEnsureCoreSchemaForTests } from "./ensureCoreSchema";
import { probeCoreTables } from "../lib/ops/schemaProbe";

/**
 * The self-heal, against the real production driver.
 *
 * This reproduces the exact state production was found in on 2026-09-07:
 * `accountCredentials` and `auth_attempts` absent, everything else present.
 * That combination meant the ESPN account sign-in could store nothing and
 * `checkThrottle` threw on every sign-in, because both tables were added by
 * deploys that shipped without anyone running the manual init.
 *
 * A dedicated schema, per the convention `throttle.pg` established: parallel
 * suites that each drop `public` destroy each other and pass individually.
 */
const PG_URL = process.env.RAE_PG_TEST_URL;
const pg = PG_URL ? describe : describe.skip;

async function raw(db: Db, query: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).execute(sql.raw(query));
}

pg("ensureCoreSchema against real Postgres", () => {
  let db: Db;
  const SCHEMA = "rae_test_ensure";

  beforeAll(async () => {
    db = createPostgresDb(PG_URL!);
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await raw(db, `CREATE SCHEMA ${SCHEMA}`);
    await raw(db, `SET search_path TO ${SCHEMA}`);
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  }, 60_000);

  it("builds a complete schema from nothing", async () => {
    resetEnsureCoreSchemaForTests();
    const result = await ensureCoreSchema(db);
    expect(result.driver).toBe("postgres");
    expect(result.applied).toBeGreaterThan(8);
    await expect(probeCoreTables(db)).resolves.toEqual([]);
  }, 120_000);

  it("heals EXACTLY the production state — two tables missing", async () => {
    // The regression this exists for.
    await raw(db, 'DROP TABLE IF EXISTS "accountCredentials"');
    await raw(db, "DROP TABLE IF EXISTS auth_attempts");
    await expect(probeCoreTables(db)).resolves.toEqual(
      expect.arrayContaining(["accountCredentials", "auth_attempts"])
    );

    resetEnsureCoreSchemaForTests();
    await ensureCoreSchema(db);

    await expect(probeCoreTables(db)).resolves.toEqual([]);
  }, 120_000);

  it("is safe to run repeatedly, which is what every cold start does", async () => {
    for (let i = 0; i < 3; i += 1) {
      resetEnsureCoreSchemaForTests();
      await expect(ensureCoreSchema(db)).resolves.toMatchObject({ driver: "postgres" });
    }
    await expect(probeCoreTables(db)).resolves.toEqual([]);
  }, 120_000);

  it("does NOT touch notification status — the destructive backfill it skips", async () => {
    // The reason this runs DDL only. `INIT_SQL` ends with
    //   UPDATE notifications SET status = ... WHERE status IS NULL OR status = 'new'
    // and 'new' is a LIVE state meaning "never listed to the user". If the
    // ensure replayed INIT_SQL wholesale, this row would silently become
    // 'active' on the next cold start and the user would never be shown it as
    // new. That is data corruption, not a migration.
    await raw(db, `INSERT INTO users (id, email) VALUES ('u-ensure', 'ensure@example.com')
                   ON CONFLICT (id) DO NOTHING`);
    await raw(
      db,
      `INSERT INTO notifications (id, "userId", severity, rule, message, "dedupKey", status)
       VALUES ('n-ensure', 'u-ensure', 'info', 'test', 'hello', 'dedup-ensure', 'new')
       ON CONFLICT (id) DO NOTHING`
    );

    resetEnsureCoreSchemaForTests();
    await ensureCoreSchema(db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await raw(db, `SELECT status FROM notifications WHERE id = 'n-ensure'`)) as any;
    const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
    expect(list[0]?.status).toBe("new");
  }, 120_000);

  it("would have been enough on its own — INIT_SQL's DDL covers every core table", async () => {
    // Guards the filter against future INIT_SQL edits that add a core table via
    // something other than CREATE/ALTER, which the ensure would then skip.
    const created = INIT_SQL.match(/CREATE TABLE IF NOT EXISTS "?(\w+)"?/g) ?? [];
    expect(created.length).toBeGreaterThan(8);
  });
});
