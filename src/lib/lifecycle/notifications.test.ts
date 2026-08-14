import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, schema } from "../../db";
import {
  dismissNotificationForUser,
  evaluateLifecycleRules,
  listNotificationsForUser,
  resolveNotification,
  upsertNotification
} from "./notifications";
import type { PlayerMarketRecord } from "../governance";
import type { ByeSchedule, VerifiedByeSchedule } from "../schedule/byeSchedule";

/** Verified schedule fixture — never a real season table (audit F-002). */
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

function p(id: string, position: PlayerMarketRecord["position"], team: string, overrides: Partial<PlayerMarketRecord> = {}): PlayerMarketRecord {
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

describe("lifecycle notifications", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  });

  beforeEach(async () => {
    db = resetDbForTests();
    await db.insert(schema.users).values([
      { id: "user-a", email: "a@example.com" },
      { id: "user-b", email: "b@example.com" }
    ]);
  });

  describe("evaluateLifecycleRules (pure)", () => {
    it("emits a stacked-bye notification when 2+ starters share a bye week", () => {
      const roster = [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")]; // both bye wk5 in fixture
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster,
        byeSchedule: VERIFIED_BYES
      });
      expect(out).toHaveLength(1);
      expect(out[0]!.rule).toBe("stacked-bye-week");
      expect(out[0]!.severity).toBe("warn");
      // Season is in the key so next year's identical alert is not suppressed.
      expect(out[0]!.dedupKey).toBe("bye:L1:RB:2026:5");
    });

    it("records the schedule season and source in the message", () => {
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")],
        byeSchedule: VERIFIED_BYES
      });
      expect(out[0]!.message).toContain("2026 schedule");
      expect(out[0]!.message).toContain("test fixture");
    });

    it("FAILS CLOSED: emits no bye advice when the schedule is unverified", () => {
      // The core F-002 regression. Previously this produced confident advice
      // from a hardcoded 2025 table regardless of the real season.
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")],
        byeSchedule: UNAVAILABLE_BYES
      });
      expect(out.filter((n) => n.rule === "stacked-bye-week")).toHaveLength(0);
    });

    it("still evaluates the other rules when the bye schedule is unavailable", () => {
      // Fail-closed must be scoped to the bye rule, not silently disable the cron.
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")],
        byeSchedule: UNAVAILABLE_BYES,
        faabRemainingRatio: 0.05,
        injuredStarters: [p("wr1", "WR", "BUF", { status: "out" })]
      });
      expect(out.some((n) => n.rule === "faab-depleted")).toBe(true);
      expect(out.some((n) => n.rule === "injured-starter")).toBe(true);
    });

    it("emits a faab-depleted alert when ratio < 0.1", () => {
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [],
        byeSchedule: VERIFIED_BYES,
        faabRemainingRatio: 0.05
      });
      expect(out.some((n) => n.rule === "faab-depleted" && n.severity === "alert")).toBe(true);
    });

    it("does not emit faab alert when budget is healthy", () => {
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [],
        byeSchedule: VERIFIED_BYES,
        faabRemainingRatio: 0.5
      });
      expect(out.some((n) => n.rule === "faab-depleted")).toBe(false);
    });

    it("emits an injured-starter alert per injured player", () => {
      const injured = [p("rb1", "RB", "ATL", { status: "ir" }), p("wr1", "WR", "BUF", { status: "out" })];
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [],
        byeSchedule: VERIFIED_BYES,
        injuredStarters: injured
      });
      expect(out.filter((n) => n.rule === "injured-starter")).toHaveLength(2);
    });
  });

  describe("DB persistence + user isolation", () => {
    const base = (userId: string, dedupKey = "k1") => ({
      userId,
      severity: "info" as const,
      rule: "test",
      message: "hello",
      dedupKey
    });

    it("a notification written for user-a is not visible to user-b", async () => {
      await upsertNotification(base("user-a"), db);
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(1);
      expect(await listNotificationsForUser("user-b", {}, db)).toHaveLength(0);
    });

    it("dismissed notifications are excluded from default list", async () => {
      const n = await upsertNotification(base("user-a"), db);
      expect(await dismissNotificationForUser("user-a", n.id, db)).toBe(true);
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(0);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(1);
    });

    it("user-b cannot dismiss user-a's notification", async () => {
      const n = await upsertNotification(base("user-a"), db);
      expect(await dismissNotificationForUser("user-b", n.id, db)).toBe(false);
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(1);
    });
  });

  describe("F-003 deduplication", () => {
    const bye = (userId = "user-a", key = "bye:L1:RB:2026:5") => ({
      userId,
      leagueId: null,
      severity: "warn" as const,
      rule: "stacked-bye-week",
      message: "two RBs on bye",
      dedupKey: key,
      season: 2026,
      week: 5
    });

    it("repeated identical cron runs produce exactly ONE row", async () => {
      // The core regression: the daily cron used to append a duplicate forever.
      for (let day = 0; day < 30; day += 1) await upsertNotification(bye(), db);
      const list = await listNotificationsForUser("user-a", { includeDismissed: true }, db);
      expect(list).toHaveLength(1);
      expect(list[0]!.occurrences).toBe(30);
    });

    it("CONCURRENT runs do not create duplicates", async () => {
      // Atomic upsert, not read-then-write: parallel writes must collapse.
      await Promise.all(Array.from({ length: 12 }, () => upsertNotification(bye(), db)));
      const list = await listNotificationsForUser("user-a", { includeDismissed: true }, db);
      expect(list).toHaveLength(1);
      expect(list[0]!.occurrences).toBe(12);
    });

    it("a dismissed alert STAYS dismissed when the condition is still true", async () => {
      const n = await upsertNotification(bye(), db);
      await dismissNotificationForUser("user-a", n.id, db);
      await upsertNotification(bye(), db); // tomorrow's cron
      expect(await listNotificationsForUser("user-a", {}, db)).toHaveLength(0);
      const all = await listNotificationsForUser("user-a", { includeDismissed: true }, db);
      expect(all[0]!.status).toBe("dismissed");
    });

    it("a RESOLVED condition that recurs is reopened as a new event", async () => {
      await upsertNotification(bye(), db);
      expect(await resolveNotification("user-a", "bye:L1:RB:2026:5", db)).toBe(true);
      const reopened = await upsertNotification(bye(), db);
      expect(reopened.status).toBe("reopened");
      expect(reopened.resolvedAt).toBeNull();
    });

    it("keeps separate rows per user and per league", async () => {
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:5"), db);
      await upsertNotification(bye("user-b", "bye:L1:RB:2026:5"), db);
      await upsertNotification(bye("user-a", "bye:L2:RB:2026:5"), db);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(2);
      expect(await listNotificationsForUser("user-b", { includeDismissed: true }, db)).toHaveLength(1);
    });

    it("a changed bye week is a DIFFERENT alert, not a duplicate", async () => {
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:5"), db);
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:9"), db);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(2);
    });

    it("the same week in a NEW SEASON is a different alert", async () => {
      await upsertNotification(bye("user-a", "bye:L1:RB:2025:5"), db);
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:5"), db);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(2);
    });

    it("a changed injury status updates the row in place and refreshes the message", async () => {
      const key = "injury:L1:p99";
      await upsertNotification(
        { userId: "user-a", severity: "alert", rule: "injured-starter", message: "listed as questionable", dedupKey: key },
        db
      );
      const updated = await upsertNotification(
        { userId: "user-a", severity: "alert", rule: "injured-starter", message: "listed as out", dedupKey: key },
        db
      );
      expect(updated.message).toBe("listed as out");
      expect(updated.occurrences).toBe(2);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(1);
    });

    it("a partially failed run can be retried without duplicating what succeeded", async () => {
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:5"), db);
      // Retry writes the first key again and adds the one that failed last time.
      await upsertNotification(bye("user-a", "bye:L1:RB:2026:5"), db);
      await upsertNotification(bye("user-a", "bye:L1:WR:2026:5"), db);
      expect(await listNotificationsForUser("user-a", { includeDismissed: true }, db)).toHaveLength(2);
    });

    it("persists the dedup key, season and week that were dropped before", async () => {
      const row = await upsertNotification(bye(), db);
      expect(row.dedupKey).toBe("bye:L1:RB:2026:5");
      expect(row.season).toBe(2026);
      expect(row.week).toBe(5);
    });

    it("caps the returned history", async () => {
      for (let i = 0; i < 5; i += 1) await upsertNotification(bye("user-a", `k${i}`), db);
      expect(await listNotificationsForUser("user-a", { limit: 2, includeDismissed: true }, db)).toHaveLength(2);
    });
  });
});
