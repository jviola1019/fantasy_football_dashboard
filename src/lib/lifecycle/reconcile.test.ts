import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, schema } from "../../db";
import {
  dismissNotificationForUser,
  evaluateLifecycleRules,
  listNotificationsForUser,
  reconcileLifecycleNotifications,
  RULE_FAMILIES,
  upsertNotification,
  type LifecycleEvaluation
} from "./notifications";
import type { PlayerMarketRecord } from "../governance";
import type { ByeSchedule, VerifiedByeSchedule } from "../schedule/byeSchedule";

/**
 * Lifecycle reconciliation (audit P1 §6).
 *
 * The cron only ever upserted currently-true conditions, and
 * `resolveNotification` had ZERO production callers. So a bye alert for a week
 * that had already passed, or an injury alert for a player who had recovered or
 * been dropped, stayed `active` forever and the list only grew.
 *
 * The hard part is not closing stale rows — it is refusing to close rows whose
 * truth is UNKNOWN. "Absent from this run's results" means two utterly
 * different things: the condition ended, or we could not tell. Conflating them
 * marks a real, still-dangerous alert as handled, which is worse than never
 * having reconciled at all.
 */

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

function p(
  id: string,
  position: PlayerMarketRecord["position"],
  team: string,
  overrides: Partial<PlayerMarketRecord> = {}
): PlayerMarketRecord {
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
    imageSource: "test",
    ...overrides
  };
}

/** Two ATL + two GB players all bye in week 5 -> a stacked-RB alert. */
const STACKED_ROSTER = [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB"), p("qb1", "QB", "BUF")];
/** Same shape, no stacking: only one RB is on bye in any week. */
const CLEAN_ROSTER = [p("rb1", "RB", "ATL"), p("rb2", "RB", "DAL"), p("qb1", "QB", "BUF")];

describe("lifecycle reconciliation", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(async () => {
    db = resetDbForTests();
    await db.insert(schema.users).values([
      { id: "user-a", email: "a@example.com" },
      { id: "user-b", email: "b@example.com" }
    ]);
    // notifications.leagueId is a real FK, and cross-league isolation is one of
    // the properties under test — so the leagues have to actually exist.
    await db.insert(schema.leagues).values([
      { id: "L1", userId: "user-a", platform: "sleeper", externalLeagueId: "s1", season: 2026, label: "L1" },
      { id: "L2", userId: "user-a", platform: "sleeper", externalLeagueId: "s2", season: 2026, label: "L2" }
    ]);
  });

  const run = (
    userId: string,
    leagueId: string,
    input: {
      roster: PlayerMarketRecord[];
      byeSchedule: ByeSchedule;
      faabRemainingRatio?: number | null;
      injuredStarters?: PlayerMarketRecord[];
    }
  ) => {
    const evaluation = evaluateLifecycleRules({ userId, leagueId, ...input });
    return reconcileLifecycleNotifications({ userId, leagueId, evaluation }, db);
  };

  const statusOf = async (userId: string, dedupKey: string) => {
    const rows = await listNotificationsForUser(userId, { includeDismissed: true }, db);
    return rows.find((r) => r.dedupKey === dedupKey)?.status ?? null;
  };

  const byeKey = (leagueId: string) => `bye:${leagueId}:RB:2026:5`;

  describe("state transitions", () => {
    it("active -> active: a still-true condition stays open and counts occurrences", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      const second = await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(second.resolved).toBe(0);
      expect(await statusOf("user-a", byeKey("L1"))).toBe("active");
      const rows = await listNotificationsForUser("user-a", {}, db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.occurrences).toBe(2);
    });

    it("active -> resolved: the condition stops being true", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      expect(await statusOf("user-a", byeKey("L1"))).toBe("active");

      const out = await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(out.resolved).toBe(1);
      expect(await statusOf("user-a", byeKey("L1"))).toBe("resolved");
    });

    it("resolved -> reopened: it comes back", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", byeKey("L1"))).toBe("reopened");
      // Still one row: a recurrence is the same condition, not a new record.
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(1);
    });

    it("dismissed while STILL TRUE stays dismissed and does not nag", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      const [row] = await listNotificationsForUser("user-a", {}, db);
      await dismissNotificationForUser("user-a", row!.id, db);

      const out = await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(out.resolved).toBe(0);
      expect(await statusOf("user-a", byeKey("L1"))).toBe("dismissed");
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(0);
    });

    it("dismissed -> resolved once the condition ends", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      const [row] = await listNotificationsForUser("user-a", {}, db);
      await dismissNotificationForUser("user-a", row!.id, db);

      const out = await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(out.resolved).toBe(1);
      expect(await statusOf("user-a", byeKey("L1"))).toBe("resolved");
    });

    it("dismissed -> resolved -> LATER RECURRENCE is visible again", async () => {
      // The subtle one. Dismissal sets dismissedAt, and the default list filters
      // on dismissedAt IS NULL — so without clearing it on reopen, a condition
      // the user dismissed months ago would silently never be shown again even
      // though it had gone away and genuinely come back.
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      const [row] = await listNotificationsForUser("user-a", {}, db);
      await dismissNotificationForUser("user-a", row!.id, db);
      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", byeKey("L1"))).toBe("reopened");
      const visible = await listNotificationsForUser("user-a", {}, db);
      expect(visible.map((r) => r.dedupKey)).toContain(byeKey("L1"));
    });
  });

  describe("upstream failure is UNKNOWN, never resolved", () => {
    it("an unavailable bye SCHEDULE does not resolve existing bye alerts", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      const out = await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: UNAVAILABLE_BYES });

      expect(out.resolved).toBe(0);
      expect(out.skipped).toContain("stacked-bye-week");
      expect(await statusOf("user-a", byeKey("L1"))).toBe("active");
    });

    it("an EMPTY roster does not resolve injury or bye alerts", async () => {
      // A platform returning 200 with an empty roster — an expired ESPN cookie,
      // a permissions change — is indistinguishable from a genuinely clean
      // team. Believing it would wipe every alert the user has in one run.
      const injured = p("rb1", "RB", "ATL", { status: "out" });
      await run("user-a", "L1", {
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES,
        injuredStarters: [injured]
      });
      expect(await statusOf("user-a", "injury:L1:rb1")).toBe("active");

      const out = await run("user-a", "L1", { roster: [], byeSchedule: VERIFIED_BYES });

      expect(out.resolved).toBe(0);
      expect(out.skipped).toEqual(expect.arrayContaining(["injured-starter", "stacked-bye-week"]));
      expect(await statusOf("user-a", "injury:L1:rb1")).toBe("active");
      expect(await statusOf("user-a", byeKey("L1"))).toBe("active");
    });

    it("a null FAAB ratio does not resolve a FAAB alert", async () => {
      await run("user-a", "L1", {
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES,
        faabRemainingRatio: 0.02
      });
      expect(await statusOf("user-a", "faab:L1:low")).toBe("active");

      const out = await run("user-a", "L1", {
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES,
        faabRemainingRatio: null
      });

      expect(out.skipped).toContain("faab-depleted");
      expect(await statusOf("user-a", "faab:L1:low")).toBe("active");
    });

    it("resolves ONLY the families it could judge, leaving the failed one open", async () => {
      // The partial-failure case: bye data is gone, but FAAB was read fine and
      // has recovered. One must close; the other must not.
      await run("user-a", "L1", {
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES,
        faabRemainingRatio: 0.02
      });

      const out = await run("user-a", "L1", {
        roster: STACKED_ROSTER,
        byeSchedule: UNAVAILABLE_BYES,
        faabRemainingRatio: 0.9
      });

      expect(out.resolved).toBe(1);
      expect(await statusOf("user-a", "faab:L1:low")).toBe("resolved");
      expect(await statusOf("user-a", byeKey("L1"))).toBe("active");
    });

    it("names every family it skipped, so a frozen upstream is visible", async () => {
      const out = await run("user-a", "L1", { roster: [], byeSchedule: UNAVAILABLE_BYES });
      expect([...out.skipped].sort()).toEqual([...RULE_FAMILIES].sort());
    });
  });

  describe("isolation", () => {
    it("never resolves another USER's notifications", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      await run("user-b", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", byeKey("L1"))).toBe("resolved");
      expect(await statusOf("user-b", byeKey("L1"))).toBe("active");
    });

    it("never resolves the same user's OTHER league", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      await run("user-a", "L2", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", byeKey("L1"))).toBe("resolved");
      expect(await statusOf("user-a", byeKey("L2"))).toBe("active");
    });

    it("a failed league does not resolve a healthy sibling league", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });
      await run("user-a", "L2", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      // L2's fetch came back empty; L1 is fine and genuinely cleared.
      await run("user-a", "L2", { roster: [], byeSchedule: VERIFIED_BYES });
      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", byeKey("L2"))).toBe("active");
      expect(await statusOf("user-a", byeKey("L1"))).toBe("resolved");
    });
  });

  describe("concurrent cron execution", () => {
    it("two simultaneous runs of the same evaluation are idempotent", async () => {
      const evaluation: LifecycleEvaluation = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES
      });

      await Promise.all([
        reconcileLifecycleNotifications({ userId: "user-a", leagueId: "L1", evaluation }, db),
        reconcileLifecycleNotifications({ userId: "user-a", leagueId: "L1", evaluation }, db)
      ]);

      const rows = await listNotificationsForUser("user-a", { includeDismissed: true }, db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("active");
    });

    it("a concurrent resolve and re-assert cannot leave the row wrongly closed", async () => {
      await run("user-a", "L1", { roster: STACKED_ROSTER, byeSchedule: VERIFIED_BYES });

      const stale = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: CLEAN_ROSTER,
        byeSchedule: VERIFIED_BYES
      });
      const current = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: STACKED_ROSTER,
        byeSchedule: VERIFIED_BYES
      });

      await Promise.all([
        reconcileLifecycleNotifications({ userId: "user-a", leagueId: "L1", evaluation: stale }, db),
        reconcileLifecycleNotifications({ userId: "user-a", leagueId: "L1", evaluation: current }, db)
      ]);

      // Resolve-then-upsert ordering means the run that still sees the condition
      // re-asserts it; the row must never be left resolved while true.
      const status = await statusOf("user-a", byeKey("L1"));
      expect(["active", "reopened"]).toContain(status);
    });
  });

  describe("does not disturb unrelated rows", () => {
    it("leaves a notification with a NULL leagueId alone", async () => {
      // Account-level notices are not league-scoped and must survive any
      // league's reconciliation pass.
      await upsertNotification(
        {
          userId: "user-a",
          leagueId: null,
          severity: "info",
          rule: "injured-starter",
          message: "account-level notice",
          dedupKey: "account:notice"
        },
        db
      );

      await run("user-a", "L1", { roster: CLEAN_ROSTER, byeSchedule: VERIFIED_BYES });

      expect(await statusOf("user-a", "account:notice")).toBe("active");
    });
  });
});
