import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, schema, type Db } from "./index";
import { INIT_SQL } from "./schema-pg";
import {
  dismissNotificationForUser,
  listNotificationsForUser,
  resolveNotification,
  upsertNotification
} from "../lib/lifecycle/notifications";

/**
 * Real-Postgres integration for the F-003 migration.
 *
 * The audit makes "a migration cannot be tested against both supported database
 * modes" a hard stop condition, and the notifications change touches five
 * hand-maintained DDL copies. SQLite coverage alone would not prove the
 * production driver works — notably the ON CONFLICT upsert, the quoted
 * camelCase identifiers, and the timestamp mapping all differ between drivers.
 *
 * Gated on RAE_PG_TEST_URL so CI and offline runs skip cleanly. Point it at a
 * THROWAWAY database only; the suite drops and recreates its tables.
 *   RAE_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/rae_test \
 *     npx vitest run src/db/postgres.integration.test.ts
 */
const PG_URL = process.env.RAE_PG_TEST_URL;
const pg = PG_URL ? describe : describe.skip;

/** Mirrors /api/admin/init-db: postgres.js allows one command per query. */
async function applyInitSql(db: Db): Promise<void> {
  for (const statement of INIT_SQL.split(";")) {
    const trimmed = statement.trim();
    if (trimmed.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute((await import("drizzle-orm")).sql.raw(trimmed));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function raw(db: Db, query: string): Promise<any[]> {
  const { sql } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any).execute(sql.raw(query));
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

pg("Postgres integration (F-003 notifications migration)", () => {
  let db: Db;

  beforeAll(async () => {
    db = createPostgresDb(PG_URL!);
    // Start from a known-empty schema so the run is reproducible.
    await raw(db, "DROP SCHEMA public CASCADE");
    await raw(db, "CREATE SCHEMA public");
    await applyInitSql(db);
    await db.insert(schema.users).values([
      { id: "pg-user-a", email: "pg-a@example.com" },
      { id: "pg-user-b", email: "pg-b@example.com" }
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await raw(db, "DROP SCHEMA public CASCADE").catch(() => undefined);
    await raw(db, "CREATE SCHEMA public").catch(() => undefined);
  }, 60_000);

  it("creates every new column with the right type", async () => {
    const rows = await raw(
      db,
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'notifications'
        ORDER BY column_name`
    );
    const byName = new Map(rows.map((r) => [String(r.column_name), r]));
    for (const col of ["dedupKey", "status", "occurrences", "season", "week", "updatedAt", "resolvedAt"]) {
      expect(byName.has(col), `missing column ${col}`).toBe(true);
    }
    expect(byName.get("dedupKey")!.is_nullable).toBe("NO");
    expect(byName.get("status")!.is_nullable).toBe("NO");
    expect(String(byName.get("occurrences")!.data_type)).toContain("integer");
    expect(String(byName.get("updatedAt")!.data_type)).toContain("timestamp");
  });

  it("creates the unique dedup index", async () => {
    const rows = await raw(
      db,
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'notifications' AND indexname = 'notifications_user_dedup'`
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.indexdef)).toContain("UNIQUE");
  });

  it("is idempotent — re-running INIT_SQL changes nothing and does not throw", async () => {
    await applyInitSql(db);
    await applyInitSql(db);
    const rows = await raw(
      db,
      `SELECT count(*)::int AS n FROM pg_indexes
        WHERE tablename='notifications' AND indexname='notifications_user_dedup'`
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("the DB itself rejects a duplicate (userId, dedupKey)", async () => {
    // Proves the guarantee is enforced by Postgres, not merely by app code.
    await raw(
      db,
      `INSERT INTO notifications (id,"userId",severity,rule,message,"dedupKey")
       VALUES ('n-raw-1','pg-user-a','info','test','m','dup-key')`
    );
    await expect(
      raw(
        db,
        `INSERT INTO notifications (id,"userId",severity,rule,message,"dedupKey")
         VALUES ('n-raw-2','pg-user-a','info','test','m','dup-key')`
      )
    ).rejects.toThrow();
    await raw(db, `DELETE FROM notifications WHERE "dedupKey" = 'dup-key'`);
  });

  it("upsert is idempotent across repeated runs on the real driver", async () => {
    const input = {
      userId: "pg-user-a",
      severity: "warn" as const,
      rule: "stacked-bye-week",
      message: "two RBs on bye",
      dedupKey: "pg:bye:L1:RB:2026:5",
      season: 2026,
      week: 5
    };
    for (let i = 0; i < 5; i += 1) await upsertNotification(input, db);
    const rows = await raw(
      db,
      `SELECT occurrences, season, week, status FROM notifications WHERE "dedupKey"='pg:bye:L1:RB:2026:5'`
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.occurrences)).toBe(5);
    expect(Number(rows[0]!.season)).toBe(2026);
    expect(rows[0]!.status).toBe("active");
  });

  it("concurrent upserts collapse to one row on the real driver", async () => {
    const input = {
      userId: "pg-user-b",
      severity: "warn" as const,
      rule: "stacked-bye-week",
      message: "concurrent",
      dedupKey: "pg:concurrent",
      season: 2026,
      week: 9
    };
    await Promise.all(Array.from({ length: 8 }, () => upsertNotification(input, db)));
    const rows = await raw(db, `SELECT occurrences FROM notifications WHERE "dedupKey"='pg:concurrent'`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.occurrences)).toBe(8);
  });

  it("round-trips timestamps as Dates through the shared toRow mapper", async () => {
    // The app deliberately uses the SQLite schema objects even on Postgres, so
    // timestamp handling across that seam needs explicit proof.
    const row = await upsertNotification(
      {
        userId: "pg-user-a",
        severity: "info",
        rule: "ts",
        message: "timestamps",
        dedupKey: "pg:timestamps"
      },
      db
    );
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row.createdAt.getTime())).toBe(false);
    expect(row.resolvedAt).toBeNull();
  });

  it("preserves dismissed state and reopens resolved conditions", async () => {
    const dismissedInput = {
      userId: "pg-user-a",
      severity: "info" as const,
      rule: "d",
      message: "d",
      dedupKey: "pg:dismissed"
    };
    const created = await upsertNotification(dismissedInput, db);
    await dismissNotificationForUser("pg-user-a", created.id, db);
    const afterRefire = await upsertNotification(dismissedInput, db);
    expect(afterRefire.status).toBe("dismissed");

    const resolvedInput = { ...dismissedInput, dedupKey: "pg:resolved" };
    await upsertNotification(resolvedInput, db);
    expect(await resolveNotification("pg-user-a", "pg:resolved", db)).toBe(true);
    const reopened = await upsertNotification(resolvedInput, db);
    expect(reopened.status).toBe("reopened");
    expect(reopened.resolvedAt).toBeNull();
  });

  it("keeps users isolated and honours the list cap", async () => {
    const a = await listNotificationsForUser("pg-user-a", { includeDismissed: true }, db);
    const b = await listNotificationsForUser("pg-user-b", { includeDismissed: true }, db);
    expect(a.every((r) => r.userId === "pg-user-a")).toBe(true);
    expect(b.every((r) => r.userId === "pg-user-b")).toBe(true);
    expect(await listNotificationsForUser("pg-user-a", { includeDismissed: true, limit: 1 }, db)).toHaveLength(1);
  });

  it("backfills legacy rows and then accepts the unique index (upgrade path)", async () => {
    // Simulate a pre-migration table: no new columns at all.
    await raw(db, "DROP TABLE IF EXISTS notifications CASCADE");
    await raw(
      db,
      `CREATE TABLE notifications (
         id TEXT PRIMARY KEY,
         "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         "leagueId" TEXT,
         severity TEXT NOT NULL,
         rule TEXT NOT NULL,
         message TEXT NOT NULL,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "dismissedAt" TIMESTAMP
       )`
    );
    await raw(
      db,
      `INSERT INTO notifications (id,"userId",severity,rule,message,"dismissedAt") VALUES
         ('old-1','pg-user-a','info','legacy','first',NULL),
         ('old-2','pg-user-a','info','legacy','second',NULL),
         ('old-3','pg-user-a','warn','legacy','dismissed one', now())`
    );

    await applyInitSql(db); // the migration

    const rows = await raw(
      db,
      `SELECT id, "dedupKey", status FROM notifications WHERE id LIKE 'old-%' ORDER BY id`
    );
    expect(rows).toHaveLength(3); // history preserved, nothing dropped
    expect(rows.map((r) => r.dedupKey)).toEqual(["legacy:old-1", "legacy:old-2", "legacy:old-3"]);
    expect(rows.map((r) => r.status)).toEqual(["active", "active", "dismissed"]);

    const idx = await raw(
      db,
      `SELECT count(*)::int AS n FROM pg_indexes
        WHERE tablename='notifications' AND indexname='notifications_user_dedup'`
    );
    expect(Number(idx[0]!.n)).toBe(1);
  }, 60_000);

  it("rollback removes the new objects without losing rows", async () => {
    const before = await raw(db, "SELECT count(*)::int AS n FROM notifications");
    await raw(db, "DROP INDEX IF EXISTS notifications_user_dedup");
    for (const col of ["dedupKey", "status", "occurrences", "season", "week", "updatedAt", "resolvedAt"]) {
      await raw(db, `ALTER TABLE notifications DROP COLUMN IF EXISTS "${col}"`);
    }
    const after = await raw(db, "SELECT count(*)::int AS n FROM notifications");
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));

    const cols = await raw(
      db,
      `SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`
    );
    expect(cols.map((c) => String(c.column_name))).not.toContain("dedupKey");

    // Re-apply so the migration proves it is re-runnable after a rollback.
    await applyInitSql(db);
    const restored = await raw(
      db,
      `SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`
    );
    expect(restored.map((c) => String(c.column_name))).toContain("dedupKey");
  }, 60_000);
});
