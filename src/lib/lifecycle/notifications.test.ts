import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, schema } from "../../db";
import {
  dismissNotificationForUser,
  evaluateLifecycleRules,
  insertNotification,
  listNotificationsForUser
} from "./notifications";
import type { PlayerMarketRecord } from "../governance";

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
      const roster = [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")]; // both ATL/GB bye wk5
      const out = evaluateLifecycleRules({ userId: "user-a", leagueId: "L1", roster });
      expect(out).toHaveLength(1);
      expect(out[0]!.rule).toBe("stacked-bye-week");
      expect(out[0]!.severity).toBe("warn");
      expect(out[0]!.dedupKey).toBe("bye:L1:RB:5");
    });

    it("emits a faab-depleted alert when ratio < 0.1", () => {
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [],
        faabRemainingRatio: 0.05
      });
      expect(out.some((n) => n.rule === "faab-depleted" && n.severity === "alert")).toBe(true);
    });

    it("does not emit faab alert when budget is healthy", () => {
      const out = evaluateLifecycleRules({
        userId: "user-a",
        leagueId: "L1",
        roster: [],
        faabRemainingRatio: 0.5
      });
      expect(out.some((n) => n.rule === "faab-depleted")).toBe(false);
    });

    it("emits an injured-starter alert per injured player", () => {
      const injured = [p("rb1", "RB", "ATL", { status: "ir" }), p("wr1", "WR", "BUF", { status: "out" })];
      const out = evaluateLifecycleRules({ userId: "user-a", leagueId: "L1", roster: [], injuredStarters: injured });
      expect(out.filter((n) => n.rule === "injured-starter")).toHaveLength(2);
    });
  });

  describe("DB persistence + user isolation", () => {
    it("a notification written for user-a is not visible to user-b", async () => {
      await insertNotification(
        { userId: "user-a", severity: "info", rule: "test", message: "hello" },
        db
      );
      const aList = await listNotificationsForUser("user-a", {}, db);
      const bList = await listNotificationsForUser("user-b", {}, db);
      expect(aList).toHaveLength(1);
      expect(bList).toHaveLength(0);
    });

    it("dismissed notifications are excluded from default list", async () => {
      const n = await insertNotification(
        { userId: "user-a", severity: "info", rule: "test", message: "hello" },
        db
      );
      const dismissed = await dismissNotificationForUser("user-a", n.id, db);
      expect(dismissed).toBe(true);

      const aListDefault = await listNotificationsForUser("user-a", {}, db);
      const aListAll = await listNotificationsForUser("user-a", { includeDismissed: true }, db);
      expect(aListDefault).toHaveLength(0);
      expect(aListAll).toHaveLength(1);
    });

    it("user-b cannot dismiss user-a's notification", async () => {
      const n = await insertNotification(
        { userId: "user-a", severity: "info", rule: "test", message: "hello" },
        db
      );
      const result = await dismissNotificationForUser("user-b", n.id, db);
      expect(result).toBe(false);

      const aListDefault = await listNotificationsForUser("user-a", {}, db);
      expect(aListDefault).toHaveLength(1);
    });
  });
});
