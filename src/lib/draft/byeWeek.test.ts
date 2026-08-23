import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import { parseByeWeek } from "../fantasypros/enrich";
import { fixturePlayers } from "../fixtures";
import type { PlayerMarketRecord } from "../governance";

/**
 * Bye week on the draft board (audit 2026-08-23).
 *
 * `status: "bye"` answered "is this player out THIS week". Nothing answered
 * "WHICH week are they off", which is the question a draft board exists to
 * help with — two starters at the same position sharing a bye is an empty slot
 * in a real week, and no value column can show it.
 *
 * FantasyPros has shipped `player_bye_week` in every rankings snapshot the
 * whole time, and `enrich.ts` dropped it at the record boundary. Same shape as
 * P0-5, where `fetchedAt` was dropped and a stale snapshot became "current":
 * the data was there, and the boundary threw it away.
 */
const p = (over: Partial<PlayerMarketRecord> & { name: string }): PlayerMarketRecord =>
  ({
    id: `p-${over.name}`,
    position: "RB",
    team: "AAA",
    perceivedValue: 50,
    trueValue: 50,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    rosterSlot: "RB",
    status: "active",
    byeWeek: null,
    sources: [],
    ...over
  }) as unknown as PlayerMarketRecord;

describe("parseByeWeek", () => {
  it("accepts the string form FantasyPros actually ships", () => {
    expect(parseByeWeek("7")).toBe(7);
    expect(parseByeWeek(" 12 ")).toBe(12);
  });

  it("accepts a number when one arrives", () => {
    expect(parseByeWeek(9)).toBe(9);
  });

  it("rejects ZERO, which upstream uses as a placeholder", () => {
    // The decisive case. A pass-through would print "BYE 0" beside a real draft
    // decision — a fabricated week, which is the thing CLAUDE.md forbids.
    expect(parseByeWeek("0")).toBeNull();
    expect(parseByeWeek(0)).toBeNull();
  });

  it("rejects anything that is not a plausible NFL week", () => {
    expect(parseByeWeek("")).toBeNull();
    expect(parseByeWeek(null)).toBeNull();
    expect(parseByeWeek(undefined)).toBeNull();
    expect(parseByeWeek("bye")).toBeNull();
    expect(parseByeWeek("99")).toBeNull();
    expect(parseByeWeek(-3)).toBeNull();
    expect(parseByeWeek(7.5)).toBeNull();
    expect(parseByeWeek({})).toBeNull();
  });
});

describe("the recommender flags a stacked bye, and only a real one", () => {
  const candidate = p({ name: "Candidate", position: "RB", byeWeek: 6, trueValue: 80 });
  const byeReason = (roster: PlayerMarketRecord[]) =>
    recommend({ available: [candidate], myRoster: roster }, 5)[0]?.reasons.find((r) =>
      r.includes("bye week")
    );

  it("flags a same-position, same-week clash", () => {
    const reason = byeReason([p({ name: "Held", position: "RB", byeWeek: 6 })]);
    expect(reason).toMatch(/bye week 6 clashes with 1 RB/);
  });

  it("counts every clashing player, so a second one is visible", () => {
    const reason = byeReason([
      p({ name: "Held1", position: "RB", byeWeek: 6 }),
      p({ name: "Held2", position: "RB", byeWeek: 6 })
    ]);
    expect(reason).toMatch(/clashes with 2 RB/);
  });

  it("does NOT flag the same week at a DIFFERENT position", () => {
    // A tight end and a running back off in week 6 is two different empty
    // slots, not a doubled-up one. Flagging it would make the warning noise.
    expect(byeReason([p({ name: "TE", position: "TE", byeWeek: 6 })])).toBeUndefined();
  });

  it("does NOT flag a different week at the same position", () => {
    expect(byeReason([p({ name: "Held", position: "RB", byeWeek: 9 })])).toBeUndefined();
  });

  it("treats UNKNOWN as unknown — two nulls never clash", () => {
    // The failure that would follow from defaulting a missing bye to 0 or to
    // any sentinel: every player with no bye data would clash with every other.
    const unknown = p({ name: "Unknown", position: "RB", byeWeek: null, trueValue: 80 });
    const recs = recommend({ available: [unknown], myRoster: [p({ name: "AlsoUnknown", position: "RB", byeWeek: null })] }, 5);
    expect(recs[0]?.reasons.some((r) => r.includes("bye week"))).toBe(false);
  });

  it("penalises gently — a stacked bye is one bad week, not a bad player", () => {
    // A clash must not be able to bury a clearly better player. If the penalty
    // ever grows enough to reorder a large value gap, the model has started
    // overruling the drafter on a judgement that is theirs.
    const strongWithClash = p({ name: "Strong", position: "RB", byeWeek: 6, trueValue: 95, perceivedValue: 50 });
    const weakNoClash = p({ name: "Weak", position: "RB", byeWeek: 12, trueValue: 55, perceivedValue: 50 });
    const ranked = recommend(
      { available: [strongWithClash, weakNoClash], myRoster: [p({ name: "Held", position: "RB", byeWeek: 6 })] },
      5
    );
    expect(ranked[0]?.player.name).toBe("Strong");
  });
});

describe("the fixture catalog exercises the invariants it claims", () => {
  const byTeam = new Map<string, Set<number>>();
  for (const f of fixturePlayers) {
    if (f.byeWeek == null || !f.team) continue;
    const set = byTeam.get(f.team) ?? new Set<number>();
    set.add(f.byeWeek);
    byTeam.set(f.team, set);
  }

  it("gives every fixture player a bye week", () => {
    // If any were null the demo would silently show em dashes and nobody would
    // learn the column exists.
    expect(fixturePlayers.filter((f) => f.byeWeek == null)).toEqual([]);
  });

  it("gives teammates the SAME bye, as the real schedule does", () => {
    for (const [team, weeks] of byTeam) {
      expect(weeks.size, `${team} must have one bye week, saw ${[...weeks].join(",")}`).toBe(1);
    }
  });

  it("contains a reachable same-position clash, so the warning is not dead code", () => {
    // A guard nobody can trigger is indistinguishable from a guard that does
    // not work — this audit has found nine of those.
    const seen = new Map<string, number>();
    let clash = false;
    for (const f of fixturePlayers) {
      if (f.byeWeek == null) continue;
      const key = `${f.position}:${f.byeWeek}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) clash = true;
    }
    expect(clash).toBe(true);
  });
});
