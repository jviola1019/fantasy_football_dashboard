import { describe, expect, it } from "vitest";
import { evaluateKeepers, snakePickOverall } from "./keepers";
import { DEFAULT_FORMAT, type LeagueFormat } from "../trade/format";
import type { PlayerMarketRecord } from "../governance";

function p(id: string, trueValue: number, over: Partial<PlayerMarketRecord> = {}): PlayerMarketRecord {
  return {
    id,
    name: id,
    position: "RB",
    team: "KC",
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 50,
    confidence: 0.5,
    sources: [],
    rosterSlot: "RB",
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test",
    ...over
  };
}

/** A descending board: pick N is worth 100 - N. */
const board = Array.from({ length: 200 }, (_, i) => p(`board${i + 1}`, Math.max(1, 100 - i)));

const keeperFormat = (over: Partial<LeagueFormat> = {}): LeagueFormat => ({
  ...DEFAULT_FORMAT,
  leagueType: "keeper",
  keeperCount: 1,
  keeperCostRule: "fixed-round",
  keeperCostRound: 1,
  numTeams: 10,
  ...over
});

describe("snakePickOverall", () => {
  it("counts forward in odd rounds and back in even rounds", () => {
    expect(snakePickOverall(1, 3, 10)).toBe(3);
    expect(snakePickOverall(2, 3, 10)).toBe(18); // 10 + (10-3+1)
    expect(snakePickOverall(3, 1, 10)).toBe(21);
  });
});

describe("fails closed rather than guessing", () => {
  it("refuses when the cost rule is unconfirmed", () => {
    // The core safety property: neither platform publishes the cost rule, and a
    // wrong guess is irreversible for the season.
    const r = evaluateKeepers({
      roster: [p("star", 95)],
      board,
      format: keeperFormat({ keeperCostRule: "unknown", keeperCostRound: null })
    });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") return;
    expect(r.reason).toBe("cost-rule-unconfirmed");
    expect(r.detail).toMatch(/league rule|not published/i);
  });

  it("says there is no decision to make in a redraft league", () => {
    const r = evaluateKeepers({
      roster: [p("a", 90)],
      board,
      format: { ...DEFAULT_FORMAT, leagueType: "redraft", keeperCount: 0 }
    });
    expect(r.status).toBe("unavailable");
    if (r.status !== "unavailable") return;
    expect(r.reason).toBe("not-a-keeper-league");
  });

  it("explains that dynasty keeps everyone", () => {
    const r = evaluateKeepers({
      roster: [p("a", 90)],
      board,
      format: { ...DEFAULT_FORMAT, leagueType: "dynasty", keeperCount: 0 }
    });
    if (r.status !== "unavailable") throw new Error("expected unavailable");
    expect(r.detail).toMatch(/whole roster carries over/i);
  });

  it("refuses with no roster or no board", () => {
    expect(evaluateKeepers({ roster: [], board, format: keeperFormat() }).status).toBe("unavailable");
    expect(evaluateKeepers({ roster: [p("a", 90)], board: [], format: keeperFormat() }).status).toBe("unavailable");
  });
});

describe("surplus pricing", () => {
  it("recommends a player worth MORE than the pick he costs", () => {
    // Slot 3 of 10, round 1 => overall pick 3 => board value 98.
    const r = evaluateKeepers({
      roster: [p("elite", 99)],
      board,
      format: keeperFormat(),
      draftSlot: 3
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.candidates[0]!.costPickOverall).toBe(3);
    expect(r.candidates[0]!.surplus).toBeGreaterThan(0);
    expect(r.recommended).toHaveLength(1);
    expect(r.keepNobody).toBe(false);
  });

  it("says KEEP NOBODY when every candidate costs more than it returns", () => {
    // The decision managers get wrong: a good player at a first-round cost is a
    // loss, and filling the keeper slot anyway hands back value.
    const r = evaluateKeepers({
      roster: [p("okay", 40), p("meh", 30)],
      board,
      format: keeperFormat(),
      draftSlot: 1
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.keepNobody).toBe(true);
    expect(r.recommended).toEqual([]);
    expect(r.candidates.every((c) => c.verdict === "pass")).toBe(true);
  });

  it("never recommends more players than keeperCount allows", () => {
    const r = evaluateKeepers({
      roster: [p("a", 99), p("b", 98), p("c", 97)],
      board,
      format: keeperFormat({ keeperCount: 2 }),
      draftSlot: 10
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.recommended.length).toBeLessThanOrEqual(2);
  });

  it("ranks by surplus, not by raw player value", () => {
    // A cheap good player beats an expensive great one. This is the whole point.
    const r = evaluateKeepers({
      roster: [p("great", 95), p("cheap", 70)],
      board,
      format: keeperFormat({ keeperCount: 1, keeperCostRule: "draft-round" }),
      draftSlot: 5,
      costRoundByPlayerId: { great: 1, cheap: 12 }
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.candidates[0]!.player.id).toBe("cheap");
    expect(r.recommended[0]!.player.id).toBe("cheap");
  });

  it("treats a free keeper as pure surplus", () => {
    const r = evaluateKeepers({
      roster: [p("anyone", 55)],
      board,
      format: keeperFormat({ keeperCostRule: "free" }),
      draftSlot: 4
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.candidates[0]!.pickValue).toBe(0);
    expect(r.candidates[0]!.surplus).toBe(55);
    expect(r.candidates[0]!.reasons.join(" ")).toMatch(/no pick forfeited/i);
  });

  it("declares an assumed draft slot instead of hiding it", () => {
    const r = evaluateKeepers({ roster: [p("a", 90)], board, format: keeperFormat() });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.assumptions.join(" ")).toMatch(/Draft slot unknown/i);
  });

  it("flags fragility on a locked-in keeper slot", () => {
    const r = evaluateKeepers({
      roster: [p("brittle", 95, { fragility: 80 })],
      board,
      format: keeperFormat(),
      draftSlot: 8
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.candidates[0]!.reasons.join(" ")).toMatch(/Fragility 80/);
  });
});
