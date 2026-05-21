import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spearman, realizedVor, REPLACEMENT_RANKS } from "./backtest";
import { welchTTest, cohensD } from "@/lib/stats/distribution";
import { evaluateTrade } from "./evaluate";
import type { PlayerValue } from "./values";

interface BacktestRow {
  name: string;
  position: string;
  tradeValue: number;
  fantasyPoints: number;
}

describe("spearman", () => {
  it("returns 1 for a perfectly rank-correlated pair", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5);
  });
  it("returns -1 for a perfectly inversely ranked pair", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5);
  });
});

describe("realizedVor", () => {
  it("subtracts the positional replacement baseline", () => {
    const players = [
      { name: "RB1", position: "RB", fantasyPoints: 300 },
      { name: "RB2", position: "RB", fantasyPoints: 100 }
    ];
    const vor = realizedVor(players, { RB: 1 });
    expect(vor.get("RB1")).toBe(200);
  });
});

describe("Backtest A: trade value vs realized VOR", () => {
  it("preseason trade values rank-correlate with realized 2024 VOR (rho >= 0.7)", () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, "fixtures/backtest-2024.json"), "utf8")
    ) as BacktestRow[];
    const vor = realizedVor(rows, REPLACEMENT_RANKS);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of rows) {
      const v = vor.get(r.name);
      if (v === undefined) continue;
      xs.push(r.tradeValue);
      ys.push(v);
    }
    expect(xs.length).toBeGreaterThanOrEqual(60);
    expect(spearman(xs, ys)).toBeGreaterThanOrEqual(0.7);
  });
});

function toPlayerValue(r: BacktestRow): PlayerValue {
  return {
    sleeperId: r.name, espnId: null, name: r.name, position: r.position, team: null,
    value: r.tradeValue, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("Backtest B: verdict calibration", () => {
  it("balanced trades end closer in realized VOR than lopsided ones", () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, "fixtures/backtest-2024.json"), "utf8")
    ) as BacktestRow[];
    const vor = realizedVor(rows, REPLACEMENT_RANKS);
    const balancedGaps: number[] = [];
    const lopsidedGaps: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const { verdict } = evaluateTrade([toPlayerValue(a)], [toPlayerValue(b)]);
        const realizedGap = Math.abs((vor.get(a.name) ?? 0) - (vor.get(b.name) ?? 0));
        if (verdict === "balanced") balancedGaps.push(realizedGap);
        else if (verdict === "lopsided") lopsidedGaps.push(realizedGap);
      }
    }
    const result = welchTTest(balancedGaps, lopsidedGaps);
    expect(result.meanDelta).toBeLessThan(0);
    expect(result.pTwoSided).toBeLessThan(0.05);
    expect(Math.abs(cohensD(balancedGaps, lopsidedGaps))).toBeGreaterThanOrEqual(0.5);
  });
});
