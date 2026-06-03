import { describe, expect, it } from "vitest";
import { buildOutcomeHeat } from "./outcomeHeat";
import type { SimulationResult } from "./simulation";

const TIERS = ["Missed", "Playoffs", "Finalist", "Champion"] as const;

/** Hand-built joint so the conditional math is checkable without MC noise. */
function dist(): SimulationResult["distribution"] {
  const wins = new Array<number>(15).fill(0);
  const joint = Array.from({ length: 15 }, () => [0, 0, 0, 0]);
  // [missed, playoffs, finalist, champion] per win total. Champion CONDITIONAL
  // share (champion/marginal) rises with wins: .01, .013, .067, .25, .40.
  const rows: Record<number, [number, number, number, number]> = {
    6: [0.085, 0.012, 0.002, 0.001], // marginal .10
    7: [0.10, 0.04, 0.008, 0.002], //   marginal .15
    8: [0.13, 0.10, 0.05, 0.02], //     marginal .30
    9: [0.04, 0.06, 0.05, 0.05], //     marginal .20
    10: [0.01, 0.02, 0.03, 0.04] //     marginal .10
  };
  for (const [w, r] of Object.entries(rows)) {
    const wi = Number(w);
    joint[wi] = r.slice();
    wins[wi] = r.reduce((a, b) => a + b, 0);
  }
  return { wins, joint, tiers: TIERS, weeks: 14 };
}

describe("buildOutcomeHeat (conditional P(outcome | wins))", () => {
  it("returns null with no mass", () => {
    expect(buildOutcomeHeat({ wins: new Array(15).fill(0), joint: [], tiers: TIERS, weeks: 14 })).toBeNull();
  });

  it("normalises each column to ~1 (a conditional distribution per win total)", () => {
    const heat = buildOutcomeHeat(dist())!;
    expect(heat).not.toBeNull();
    for (let c = 0; c < heat.xLabels.length; c++) {
      const colSum = heat.data.reduce((s, row) => s + row[c]!, 0);
      expect(colSum).toBeGreaterThan(0.999);
      expect(colSum).toBeLessThan(1.001);
    }
    // Cells are probabilities, so the colour-ramp max never exceeds 1.
    expect(heat.maxCell).toBeLessThanOrEqual(1);
  });

  it("puts Champion on the top row and makes its share rise with wins (no '14-0 dip')", () => {
    const heat = buildOutcomeHeat(dist())!;
    expect(heat.yLabels[0]).toBe("Champion");
    expect(heat.xLabels).toEqual(["6 W", "7 W", "8 W", "9 W", "10 W"]);
    const champRow = heat.data[0]!;
    for (let i = 1; i < champRow.length; i++) {
      expect(champRow[i]!).toBeGreaterThanOrEqual(champRow[i - 1]!);
    }
    // Strictly higher at the most wins than the fewest — a real, not flat, signal.
    expect(champRow[champRow.length - 1]!).toBeGreaterThan(champRow[0]!);
    expect(heat.caption).toMatch(/P\(playoff outcome \| regular-season wins\)/);
  });
});
