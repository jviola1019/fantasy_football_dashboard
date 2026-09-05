import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resetDbForTests } from "../../db";
import { SNAPSHOT_TABLES } from "../../db/schema-pg";
import { CORE_TABLES, probeCoreTables } from "./schemaProbe";

/**
 * `/api/health` must be able to SEE a missing core table.
 *
 * It reported `database: "ok"` from ONE probe against `users` — a table that has
 * existed since the first migration, so it can never be absent when a newer one
 * is. `accountCredentials` shipped in PR #43 and is created only by the manual
 * `POST /api/admin/init-db`; nothing applies that DDL automatically on Postgres.
 * A deployment could therefore be missing the table a rendered page reads while
 * health said everything was fine — the health check drawing its conclusion from
 * an input that cannot exhibit the failure it exists to detect.
 */
describe("CORE_TABLES is derived, not maintained by hand", () => {
  it("includes every table only the manual init creates", () => {
    // A hand-kept list is what went stale in `reencrypt-credentials.ts`.
    for (const t of ["users", "sessions", "leagues", "accountCredentials", "leagueCredentials"]) {
      expect(CORE_TABLES, `${t} must be probed`).toContain(t);
    }
  });

  it("excludes the snapshot tables, which self-heal at runtime", () => {
    // Reporting these would make a fresh deployment permanently `degraded` for
    // a condition that fixes itself on the next cron. An alarm that is always
    // on is an alarm nobody reads.
    for (const t of SNAPSHOT_TABLES) {
      expect(CORE_TABLES, `${t} self-heals and must not be probed`).not.toContain(t);
    }
  });

  it("is non-empty and unique, so the probe cannot pass vacuously", () => {
    expect(CORE_TABLES.length).toBeGreaterThan(4);
    expect(new Set(CORE_TABLES).size).toBe(CORE_TABLES.length);
  });
});

describe("probeCoreTables", () => {
  beforeEach(() => {
    resetDbForTests();
  });

  it("reports nothing missing on a fully initialised database", async () => {
    await expect(probeCoreTables()).resolves.toEqual([]);
  });

  it("NAMES the table that PR #43 added when it is absent — the defect", async () => {
    // The exact production state this exists for: every older table present,
    // the new one not. The old single-probe check called this "ok".
    const db = resetDbForTests();
    await db.run(sql`DROP TABLE "accountCredentials"`);
    await expect(probeCoreTables()).resolves.toEqual(["accountCredentials"]);
  });

  it("still finds `users`, so the original check is not weakened", async () => {
    const db = resetDbForTests();
    await db.run(sql`DROP TABLE sessions`);
    const missing = await probeCoreTables();
    expect(missing).toContain("sessions");
    expect(missing).not.toContain("users");
  });

  it("reports several at once rather than stopping at the first", async () => {
    // An operator running one init should learn everything it will fix, not
    // discover the next gap on the following deploy.
    const db = resetDbForTests();
    await db.run(sql`DROP TABLE "accountCredentials"`);
    await db.run(sql`DROP TABLE "leagueCredentials"`);
    const missing = await probeCoreTables();
    expect(missing).toEqual(expect.arrayContaining(["accountCredentials", "leagueCredentials"]));
    expect(missing.length).toBe(2);
  });

  it("does NOT swallow a non-missing-relation failure", async () => {
    // The guard on the guard. If a permission error or a dropped connection
    // read as "your schema is incomplete", an operator would be sent to fix
    // entirely the wrong thing.
    const db = resetDbForTests();
    // Close the underlying handle so the next read fails for a reason that is
    // emphatically not "the table does not exist".
    const handle = (db as unknown as { $client?: { close?: () => void } }).$client;
    if (handle?.close) {
      handle.close();
      await expect(probeCoreTables()).rejects.toThrow();
    }
  });
});
