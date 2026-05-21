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

  it("treats two empty sides as balanced", () => {
    expect(evaluateTrade([], []).verdict).toBe("balanced");
  });
});
