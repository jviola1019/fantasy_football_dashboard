import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresDb, schema, type Db } from "../../db";
import { INIT_SQL } from "../../db/schema-pg";
import {
  dismissNotificationForUser,
  evaluateLifecycleRules,
  listNotificationsForUser,
  reconcileLifecycleNotifications
} from "./notifications";
import type { PlayerMarketRecord } from "../governance";
import type { ByeSchedule, VerifiedByeSchedule } from "../schedule/byeSchedule";

/**
 * Lifecycle reconciliation against REAL Postgres (audit P1 §6, §16).
 *
 * SQLite coverage does not carry here. Reconciliation leans on three things
 * that differ by driver: `NOT IN` over a bound array, `UPDATE … RETURNING`
 * (which SQLite only gained recently and Drizzle emits differently), and the
 * quoted camelCase identifiers in the status/dismissedAt CASE expressions.
 * The migration story is also only half-proved without the production driver.
 *
 * Gated on RAE_PG_TEST_URL. THROWAWAY database only — this drops the schema.
 */
const PG_URL = process.env.RAE_PG_TEST_URL;
const pg = PG_URL ? describe : describe.skip;

async function raw(db: Db, query: string): Promise<unknown[]> {
  const { sql } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any).execute(sql.raw(query));
  return Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []);
}

const VERIFIED_BYES: VerifiedByeSchedule = {
  status: "verified",
  season: 2026,
  byes: { ATL: 5, GB: 5, BUF: 7, DAL: 10 },
  regularSeasonWeeks: 18,
  provenance: {
    source: "test fixture",
    sourceUrl: "https://example.invalid/games.csv",
    retrievedAt: "2026-08-13T00:00:00.000Z",
    derivation: "test"
  }
};

const UNAVAILABLE_BYES: ByeSchedule = {
  status: "unavailable",
  season: 2026,
  reason: "source-unavailable",
  detail: "nflverse unreachable",
  provenance: {}
};

function p(id: string, position: PlayerMarketRecord["position"], team: string): PlayerMarketRecord {
  return {
    id,
    name: id,
    position,
    team,
    perceivedValue: 60,
    trueValue: 70,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: position,
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test"
  };
}

const STACKED_ROSTER = [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB"), p("qb1", "QB", "BUF")];
const CLEAN_ROSTER = [p("rb1", "RB", "ATL"), p("rb2", "RB", "DAL"), p("qb1", "QB", "BUF")];

pg("Postgres lifecycle reconciliation", () => {
  let db: Db;
  const byeKey = (leagueId: string) => `bye:${leagueId}:RB:2026:5`;

  beforeAll(async () => {
    db = createPostgresDb(PG_URL!);
    await raw(db, "DROP SCHEMA public CASCADE");
    await raw(db, "CREATE SCHEMA public");
    for (const statement of INIT_SQL.split(";")) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await raw(db, trimmed);
    }
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await raw(db, "DROP SCHEMA public CASCADE").catch(() => undefined);
    await raw(db, "CREATE SCHEMA public").catch(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    await raw(db, "TRUNCATE TABLE notifications, leagues, users CASCADE");
    await db.insert(schema.users).values([
      { id: "pg-a", email: "pg-a@example.com" },
      { id: "pg-b", email: "pg-b@example.com" }
    ]);
    await db.insert(schema.leagues).values([
      { id: "PL1", userId: "pg-a", platform: "sleeper", externalLeagueId: "s1", season: 2026, label: "PL1" },
      { id: "PL2", userId: "pg-a", platform: "sleeper", externalLeagueId: "s2", season: 2026, label: "PL2" }
    ]);
  });

  const run = (
    userId: string,
    leagueId: string,
    input: {
      roster: PlayerMarketRecord[];
      byeSchedule: ByeSchedule;
      faabRemainingRatio?: number | null;
    }
  ) => {
    const evaluation = evaluateLifecycleRules({ userId, leagueId, ...input });
    return reconcileLifecycleNotifications({ userId, leagueId, evaluation }, db);
  };

  const statusOf = async (userId: string, dedupKey: string) => {
    const rows = await listNotificationsForUser(userId, { includeDismissed: true }, db);
    return rows.find((r) => r.dedupKey === dedupKey)?.status ?? null;
  };

  it("resolves a condition that stopped being true", async () => {
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
    expect(await statusOf("pg-a", byeKey("PL1"))).toBe("active");

    const out = await run("pg-a", "PL1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

    expect(out.resolved).toBe(1);
    expect(await statusOf("pg-a", byeKey("PL1"))).toBe("resolved");
  });

  it("reopens a resolved condition on recurrence", async () => {
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
    await run("pg-a", "PL1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

    expect(await statusOf("pg-a", byeKey("PL1"))).toBe("reopened");
  });

  it("clears the dismissal on reopen so a recurrence is visible", async () => {
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
    const [row] = await listNotificationsForUser("pg-a", {}, db);
    await dismissNotificationForUser("pg-a", row!.id, db);
    await run("pg-a", "PL1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

    const visible = await listNotificationsForUser("pg-a", {}, db);
    expect(visible.map((r) => r.dedupKey)).toContain(byeKey("PL1"));
  });

  it("does NOT resolve a family whose upstream failed", async () => {
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

    const out = await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: UNAVAILABLE_BYES });

    expect(out.resolved).toBe(0);
    expect(out.skipped).toContain("stacked-bye-week");
    expect(await statusOf("pg-a", byeKey("PL1"))).toBe("active");
  });

  it("keeps the NOT IN filter correct when several keys are live at once", async () => {
    // Exercises the bound-array path: three open injury keys, two still true.
    const injured = [p("i1", "RB", "ATL"), p("i2", "WR", "BUF"), p("i3", "TE", "DAL")];
    await reconcileLifecycleNotifications(
      {
        userId: "pg-a",
        leagueId: "PL1",
        evaluation: evaluateLifecycleRules({
          userId: "pg-a",
          leagueId: "PL1",
          roster: STACKED_ROSTER,
          byeSchedule: VERIFIED_BYES,
          injuredStarters: injured
        })
      },
      db
    );

    const out = await reconcileLifecycleNotifications(
      {
        userId: "pg-a",
        leagueId: "PL1",
        evaluation: evaluateLifecycleRules({
          userId: "pg-a",
          leagueId: "PL1",
          roster: STACKED_ROSTER,
          byeSchedule: VERIFIED_BYES,
          injuredStarters: [injured[0]!, injured[2]!]
        })
      },
      db
    );

    expect(out.resolved).toBe(1);
    expect(await statusOf("pg-a", "injury:PL1:i2")).toBe("resolved");
    expect(await statusOf("pg-a", "injury:PL1:i1")).toBe("active");
    expect(await statusOf("pg-a", "injury:PL1:i3")).toBe("active");
  });

  it("isolates users and leagues", async () => {
    await run("pg-a", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
    await run("pg-a", "PL2", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
    await run("pg-b", "PL1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

    await run("pg-a", "PL1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

    expect(await statusOf("pg-a", byeKey("PL1"))).toBe("resolved");
    expect(await statusOf("pg-a", byeKey("PL2"))).toBe("active");
    expect(await statusOf("pg-b", byeKey("PL1"))).toBe("active");
  });

  it("is idempotent under two concurrent runs", async () => {
    const evaluation = evaluateLifecycleRules({
      userId: "pg-a",
      leagueId: "PL1",
      roster: STACKED_ROSTER,
      byeSchedule: VERIFIED_BYES
    });

    await Promise.all([
      reconcileLifecycleNotifications({ userId: "pg-a", leagueId: "PL1", evaluation }, db),
      reconcileLifecycleNotifications({ userId: "pg-a", leagueId: "PL1", evaluation }, db)
    ]);

    const rows = await listNotificationsForUser("pg-a", { includeDismissed: true }, db);
    expect(rows.filter((r) => r.dedupKey === byeKey("PL1"))).toHaveLength(1);
  });
});
