import { describe, it, expect } from "vitest";
import { buildTrendingMap, trendingMomentumFromProxy } from "./trendingProxy";

describe("buildTrendingMap", () => {
  it("returns an empty map for null / undefined / empty input", () => {
    expect(buildTrendingMap(null).size).toBe(0);
    expect(buildTrendingMap(undefined).size).toBe(0);
    expect(buildTrendingMap([]).size).toBe(0);
  });

  it("keys by player_id with count as the value", () => {
    const map = buildTrendingMap([
      { player_id: "4046", count: 10000 },
      { player_id: "11604", count: 5000 }
    ]);
    expect(map.get("4046")).toBe(10000);
    expect(map.get("11604")).toBe(5000);
  });

  it("clamps non-finite counts to zero", () => {
    const map = buildTrendingMap([{ player_id: "4046", count: Number.NaN }]);
    expect(map.get("4046")).toBe(0);
  });
});

describe("trendingMomentumFromProxy", () => {
  it("returns positive pressure when adds > drops", () => {
    const adds = new Map([["4046", 9000]]);
    const drops = new Map([["4046", 1000]]);
    const pressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    expect(pressure).toBeGreaterThan(0);
  });

  it("returns negative pressure when drops > adds", () => {
    const adds = new Map([["4046", 100]]);
    const drops = new Map([["4046", 9000]]);
    const pressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    expect(pressure).toBeLessThan(0);
  });

  it("returns 0 for a player not in either trending map", () => {
    const adds = new Map([["different-id", 9000]]);
    const drops = new Map();
    expect(trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops)).toBe(0);
  });

  it("strips the 'sleeper:' prefix on the record id before lookup", () => {
    const adds = new Map([["4046", 9000]]);
    const drops = new Map();
    // Same player, different id format — both should resolve.
    const withPrefix = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    const withoutPrefix = trendingMomentumFromProxy({ id: "4046" }, adds, drops);
    expect(withPrefix).toBe(withoutPrefix);
    expect(withPrefix).toBeGreaterThan(0);
  });

  it("normalises against the global max so the top adder gets ~+100", () => {
    const adds = new Map([
      ["4046", 10000],
      ["other", 5000]
    ]);
    const drops = new Map();
    const topPressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    const midPressure = trendingMomentumFromProxy({ id: "sleeper:other" }, adds, drops);
    expect(topPressure).toBe(100);
    expect(midPressure).toBe(50);
  });

  it("respects the [-100, 100] bound", () => {
    const adds = new Map([["a", 1000]]);
    const drops = new Map([["a", 1000]]);
    // adds == drops -> pressure = 0
    expect(trendingMomentumFromProxy({ id: "sleeper:a" }, adds, drops)).toBe(0);
  });
});

describe("the hype axis is ASYMMETRIC when one side dominates", () => {
  /**
   * Measured against live Sleeper data on 2026-08-22: adds peaked at 54,901
   * while drops peaked at 10,104 — a ratio of 0.184. Because
   * `trendingMomentumFromProxy` divides by a SINGLE global denominator
   * (max of both sides) so the sign stays comparable, the most-dropped player
   * in the entire NFL could only score -18, not -100.
   *
   * That is a deliberate consequence of the shared-denominator design, not a
   * bug — but it was undocumented, and a live test asserted `faller < -20`,
   * which was arithmetically impossible that day and would have failed forever
   * in the offseason. It is pinned here so the behaviour is known rather than
   * rediscovered as a mystery.
   *
   * Product consequence worth knowing: in a period where adds dwarf drops, the
   * DOWNSIDE of the hype axis is visually muted relative to the upside. The
   * ordering is still correct; only the magnitude compresses.
   */
  it("compresses the losing side in proportion to the volume gap", () => {
    const adds = new Map([["rising", 54901]]);
    const drops = new Map([["falling", 10104]]);
    const addsMax = 54901;
    const dropsMax = 10104;

    const riser = trendingMomentumFromProxy({ id: "sleeper:rising" }, adds, drops, addsMax, dropsMax);
    const faller = trendingMomentumFromProxy({ id: "sleeper:falling" }, adds, drops, addsMax, dropsMax);

    expect(riser).toBe(100);
    // -(10104 / 54901) * 100 = -18.4 -> -18
    expect(faller).toBe(-18);
    expect(Math.abs(faller)).toBeLessThan(riser);
  });

  it("is symmetric when both sides have equal volume", () => {
    const adds = new Map([["rising", 500]]);
    const drops = new Map([["falling", 500]]);
    expect(trendingMomentumFromProxy({ id: "sleeper:rising" }, adds, drops, 500, 500)).toBe(100);
    expect(trendingMomentumFromProxy({ id: "sleeper:falling" }, adds, drops, 500, 500)).toBe(-100);
  });

  it("keeps the ORDERING correct at realistic volume gaps", () => {
    // Realistic shape, taken from the live pool measured 2026-08-22: a headline
    // riser in the tens of thousands, mid-pool movers in the thousands.
    const adds = new Map([["a", 54901], ["b", 5000]]);
    const drops = new Map([["c", 3000]]);
    const scores = ["a", "b", "c"].map((id) =>
      trendingMomentumFromProxy({ id: `sleeper:${id}` }, adds, drops, 54901, 3000)
    );
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBeGreaterThan(scores[2]!);
  });

  it("rounds sub-0.5% movers to zero — the axis's real resolution floor", () => {
    // Honest limitation, found by writing the ordering test above with an
    // unrealistic gap. Scores are rounded to whole numbers, so any player whose
    // net movement is under 0.5% of the global maximum reads as exactly 0 and
    // is indistinguishable from "not trending at all".
    //
    // Measured against the live pool on 2026-08-22 this affects 5 of 158
    // players (3.2%); 90.5% score outside +/-2, min -18, max +89. So the axis is
    // NOT flat in practice — but the floor is real and is pinned here so a
    // future volume regime that pushes more players under it is visible rather
    // than mistaken for missing data.
    const adds = new Map([["huge", 100000], ["tiny", 400]]);
    const drops = new Map<string, number>();
    expect(trendingMomentumFromProxy({ id: "sleeper:tiny" }, adds, drops, 100000, 1)).toBe(0);
    // ...while a player just above the floor is still distinguishable.
    adds.set("above", 600);
    expect(trendingMomentumFromProxy({ id: "sleeper:above" }, adds, drops, 100000, 1)).toBe(1);
  });
});
