import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPostgresDb, type Db } from "../../db";
import { INIT_SQL } from "../../db/schema-pg";
import { CORE_TABLES, probeCoreTables } from "./schemaProbe";

/**
 * `probeCoreTables` against the REAL production driver.
 *
 * This test exists because its absence cost a production outage. The probe was
 * written with `db.run(...)` — a better-sqlite3 method that does not exist on
 * postgres-js — and shipped in PR #46. Every unit test passed, because
 * `resetDbForTests()` returns SQLite. CI was 14/14 green. `/api/health` returned
 * 500 in production: the endpoint added specifically so the manual schema init
 * could be verified was itself the thing that broke.
 *
 * The repository already had a job for exactly this class of bug. The
 * `postgres integration` workflow's own comment says it covers "the PRODUCTION
 * database driver" and lists the three files it runs. This was not one of them,
 * so the Postgres path was never executed. **This file must stay in that list**
 * — see `.github/workflows/ci.yml`.
 *
 * Gated on RAE_PG_TEST_URL so offline runs skip cleanly. THROWAWAY database
 * only: this creates and drops its own schema (see SCHEMA below).
 *   RAE_PG_TEST_URL=postgres://user:pw@127.0.0.1:55432/rae_test \
 *     npx vitest run src/lib/ops/schemaProbe.pg.integration.test.ts
 */
const PG_URL = process.env.RAE_PG_TEST_URL;
const pg = PG_URL ? describe : describe.skip;

async function raw(db: Db, query: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).execute(sql.raw(query));
}

async function applyInitSql(db: Db): Promise<void> {
  for (const statement of INIT_SQL.split(";")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await raw(db, trimmed);
  }
}

pg("probeCoreTables against real Postgres", () => {
  let db: Db;

  /**
   * A DEDICATED schema, not `public` — the convention `throttle.pg` and
   * `reconcile.pg` already established and explained.
   *
   * The first version of this file copied `postgres.integration.test.ts`, which
   * is the one suite that still owns `public`. Two files dropping and recreating
   * `public` in parallel `beforeAll`s destroy each other's tables: they pass
   * individually and fail together, which is the most misleading failure mode
   * available, and it is exactly what happened. `createPostgresDb` uses
   * `max: 1`, so one `SET search_path` pins every later query on that
   * connection.
   */
  const SCHEMA = "rae_test_schemaprobe";

  beforeAll(async () => {
    db = createPostgresDb(PG_URL!);
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await raw(db, `CREATE SCHEMA ${SCHEMA}`);
    await raw(db, `SET search_path TO ${SCHEMA}`);
    await applyInitSql(db);
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await raw(db, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  }, 60_000);

  it("RUNS AT ALL on the production driver — the regression", async () => {
    // The whole point. Against `db.run` this throws
    // `TypeError: db.run is not a function` before it can assert anything,
    // which is precisely what production did.
    await expect(probeCoreTables(db)).resolves.toBeDefined();
  });

  it("reports nothing missing on a fully initialised Postgres schema", async () => {
    await expect(probeCoreTables(db)).resolves.toEqual([]);
  });

  it("names a dropped core table, with Postgres's own error shape", async () => {
    // SQLite says "no such table"; Postgres says `relation "x" does not exist`
    // and carries code 42P01, wrapped by drizzle. `isMissingRelation` has to
    // recognise the Postgres shape through that wrapper, and only this test
    // exercises that path.
    await raw(db, 'DROP TABLE "accountCredentials"');
    try {
      await expect(probeCoreTables(db)).resolves.toEqual(["accountCredentials"]);
    } finally {
      await applyInitSql(db);
    }
  });

  it("finds several at once rather than stopping at the first", async () => {
    await raw(db, 'DROP TABLE "accountCredentials"');
    await raw(db, 'DROP TABLE "leagueCredentials"');
    try {
      const missing = await probeCoreTables(db);
      expect(missing).toEqual(
        expect.arrayContaining(["accountCredentials", "leagueCredentials"])
      );
      expect(missing.length).toBe(2);
    } finally {
      await applyInitSql(db);
    }
  });

  it("probes the same table list the app compiles", async () => {
    // Guards against the probe silently narrowing to a subset on this driver.
    expect(CORE_TABLES).toContain("accountCredentials");
    expect(CORE_TABLES).toContain("users");
    expect(CORE_TABLES.length).toBeGreaterThan(4);
  });
});
