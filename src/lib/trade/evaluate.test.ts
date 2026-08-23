import { describe, it, expect } from "vitest";
import { evaluateTrade } from "./evaluate";
import type { PlayerValue } from "./values";

function pv(name: string, value: number): PlayerValue {
  return {
    sleeperId: name, espnId: null, name, position: "RB", team: null,
    value, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("evaluateTrade", () => {
  it("rates an equal trade as balanced", () => {
    const v = evaluateTrade([pv("a", 5000)], [pv("b", 5000)]);
    expect(v.verdict).toBe("balanced");
    expect(v.winner).toBe("even");
    expect(v.pctDelta).toBe(0);
  });

  it("rates a 40% gap as lopsided and names the winner", () => {
    const v = evaluateTrade([pv("a", 10000)], [pv("b", 6000)]);
    expect(v.verdict).toBe("lopsided");
    expect(v.winner).toBe("A");
    expect(v.pctDelta).toBeCloseTo(0.4, 5);
  });

  it("rates a 15% gap as a slight edge", () => {
    const v = evaluateTrade([pv("a", 10000)], [pv("b", 8500)]);
    expect(v.verdict).toBe("slight-edge");
    expect(v.winner).toBe("A");
  });

  // CHANGED 2026-08-22. This test previously asserted `.toBe("balanced")` and
  // passed — it encoded the data-fabrication bug as intended behaviour, which is
  // why nothing caught it. Two empty sides mean there is nothing to compare, not
  // that the comparison came out even.
  it("treats two empty sides as UNGRADEABLE, not balanced", () => {
    expect(evaluateTrade([], []).verdict).toBe("unpriced");
  });
});

describe("a trade that cannot be priced is not graded (audit 2026-08-22)", () => {
  it("refuses to call an empty trade 'balanced'", () => {
    // This returned { fairness: 1, verdict: "balanced", winner: "even" } — the
    // strongest possible claim, computed from zero data, because
    // pctDelta = 0 / Math.max(0, 0, 1) = 0.
    const v = evaluateTrade([], []);
    expect(v.verdict).toBe("unpriced");
    expect(v.unpriced).toBe(true);
    expect(v.fairness).toBeNaN();
  });

  it("refuses to call a half-priced trade 'lopsided'", () => {
    // Previously pctDelta = 1 => "lopsided", inventing a blowout from a side
    // whose players simply had no available value.
    const v = evaluateTrade([{ value: 100 } as never], []);
    expect(v.verdict).toBe("unpriced");
    expect(v.unpriced).toBe(true);
  });

  it("still grades normally when both sides are priced", () => {
    const v = evaluateTrade([{ value: 100 } as never], [{ value: 100 } as never]);
    expect(v.unpriced).toBe(false);
    expect(v.verdict).toBe("balanced");
    expect(v.fairness).toBe(1);
    expect(v.pricedA).toBe(1);
    expect(v.pricedB).toBe(1);
  });

  it("returns NaN rather than 0 for an ungradeable trade", () => {
    // NaN so a caller that ignores `unpriced` cannot silently render a
    // plausible-looking number.
    const v = evaluateTrade([], [{ value: 50 } as never]);
    expect(v.delta).toBeNaN();
    expect(v.pctDelta).toBeNaN();
  });
});
