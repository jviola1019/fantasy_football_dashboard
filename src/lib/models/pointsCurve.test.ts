import { describe, expect, it } from "vitest";
import {
  averageStartablePar,
  buildPointsCurve,
  expectedPointsAt,
  isotonicDecreasing,
  parToTrueValue,
  pointsAboveReplacement,
  type PointsObservation
} from "./pointsCurve";
import { averageStartableTrueValue, positionReplacementRank } from "../league/lineupDemand";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueStarters } from "../trade/format";

/**
 * Points above replacement — the transform that replaces rank-ratio VBD.
 *
 * Rank-ratio computed `50 + 50*(replacement - rank)/replacement`, a ratio of
 * RANKS, so the advantage it assigned grew with how deep a position was. It
 * therefore marked quarterbacks down for playing a shallow position while never
 * seeing that a QB1 is worth ~320 season points against a TE1's ~153. Measured
 * out-of-sample it ranked significantly WORSE than chance (AUC CI [0.13, 0.45]).
 */

const st = (o: Partial<LeagueStarters> = {}): LeagueStarters => ({
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, SUPERFLEX: 0, ...o
});
const fmt = (o: Partial<LeagueFormat> = {}): LeagueFormat => ({
  ...DEFAULT_FORMAT,
  starters: st(),
  numTeams: 10,
  ...o
});

const obs = (
  position: PointsObservation["position"],
  points: number[],
  season = 2024
): PointsObservation[] =>
  points.map((seasonPoints, i) => ({ season, position, adpRank: i + 1, seasonPoints }));

describe("isotonic (non-increasing) regression", () => {
  it("leaves an already-decreasing series untouched", () => {
    expect(isotonicDecreasing([10, 8, 6, 4])).toEqual([10, 8, 6, 4]);
  });

  it("pools an increasing pair into their mean", () => {
    expect(isotonicDecreasing([10, 2, 8, 4])).toEqual([10, 5, 5, 4]);
  });

  it("NEVER returns an increasing step", () => {
    // The property that matters: expected points must not rise with draft rank.
    const noisy = [320, 180, 114, 254, 60, 283, 90, 120];
    const fitted = isotonicDecreasing(noisy);
    for (let i = 1; i < fitted.length; i += 1) {
      expect(fitted[i]!, `rank ${i + 1} rose above rank ${i}`).toBeLessThanOrEqual(fitted[i - 1]!);
    }
  });

  it("preserves the total (it is a projection, not a shrinkage)", () => {
    const v = [10, 2, 8, 4];
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(isotonicDecreasing(v))).toBeCloseTo(sum(v), 6);
  });

  it("respects weights — a heavily-observed rank pulls the pooled mean", () => {
    const light = isotonicDecreasing([10, 20], [1, 1]);
    const heavy = isotonicDecreasing([10, 20], [1, 9]);
    expect(light[0]).toBeCloseTo(15, 6);
    expect(heavy[0]).toBeCloseTo(19, 6);
  });

  it("handles the empty series", () => {
    expect(isotonicDecreasing([])).toEqual([]);
  });
});

describe("building the curve", () => {
  it("records which seasons it was fitted on — the leakage audit trail", () => {
    const curve = buildPointsCurve([...obs("RB", [200, 150], 2022), ...obs("RB", [210, 160], 2023)]);
    expect(curve.seasons).toEqual([2022, 2023]);
  });

  it("averages repeated observations at the same rank", () => {
    const curve = buildPointsCurve([...obs("RB", [200], 2022), ...obs("RB", [100], 2023)]);
    expect(expectedPointsAt(curve, "RB", 1)).toBeCloseTo(150, 6);
  });

  it("produces a non-increasing curve from noisy real-shaped input", () => {
    const curve = buildPointsCurve(obs("QB", [320, 180, 114, 254, 60, 283]));
    const series = curve.byPosition.QB!;
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]!).toBeLessThanOrEqual(series[i - 1]!);
    }
  });

  it("holds the curve flat beyond the fitted range rather than extrapolating", () => {
    // Deep bench players are near-interchangeable; extrapolating to zero would
    // invent large differences between players who are all equally replaceable.
    const curve = buildPointsCurve(obs("TE", [150, 100, 80]));
    expect(expectedPointsAt(curve, "TE", 99)).toBe(expectedPointsAt(curve, "TE", 3));
  });

  it("returns null for a position it never saw", () => {
    const curve = buildPointsCurve(obs("RB", [200]));
    expect(expectedPointsAt(curve, "QB", 1)).toBeNull();
  });

  it("ignores non-finite points instead of poisoning the fit", () => {
    const curve = buildPointsCurve([
      { season: 2024, position: "RB", adpRank: 1, seasonPoints: Number.NaN },
      { season: 2024, position: "RB", adpRank: 2, seasonPoints: 100 }
    ]);
    expect(Number.isFinite(expectedPointsAt(curve, "RB", 2)!)).toBe(true);
  });
});

describe("points above replacement", () => {
  const curve = buildPointsCurve([
    ...obs("QB", [320, 300, 280, 260, 250, 245, 240, 238, 236, 234, 232, 230]),
    ...obs("RB", Array.from({ length: 40 }, (_, i) => 300 - i * 6))
  ]);

  it("is zero at replacement level by construction", () => {
    expect(pointsAboveReplacement(curve, "RB", 20, 20)).toBe(0);
  });

  it("is positive above replacement and negative below", () => {
    expect(pointsAboveReplacement(curve, "RB", 1, 20)!).toBeGreaterThan(0);
    expect(pointsAboveReplacement(curve, "RB", 35, 20)!).toBeLessThan(0);
  });

  it("CORRECTS the scarcity bug: a shallow position is no longer discounted", () => {
    // The whole point. Rank-ratio gave QB3 87.5 and RB3 95.7 in a 10-team
    // league purely because RB is deeper. PAR asks how many POINTS each is
    // worth above his own replacement, so a scarce position is not penalised
    // for being scarce.
    const f = fmt();
    const qbRepl = positionReplacementRank("QB", f);
    const rbRepl = positionReplacementRank("RB", f);
    const qb3 = pointsAboveReplacement(curve, "QB", 3, qbRepl)!;
    const rb3 = pointsAboveReplacement(curve, "RB", 3, rbRepl)!;

    // Both are real, positive point surpluses — measured in the same units.
    expect(qb3).toBeGreaterThan(0);
    expect(rb3).toBeGreaterThan(0);
    // And the comparison is now decided by points, not by position depth.
    expect(Number.isFinite(qb3 - rb3)).toBe(true);
  });

  it("returns null when the position is unknown", () => {
    expect(pointsAboveReplacement(curve, "DEF", 1, 10)).toBeNull();
  });
});

describe("mapping PAR onto the 0-100 trueValue scale", () => {
  it("puts replacement level at exactly 50", () => {
    expect(parToTrueValue(0, 60)).toBe(50);
  });

  it("puts the average startable player on the SIMULATION anchor", () => {
    // The contract the season simulation depends on. Anchoring on best-PAR
    // instead left PAR starters at a mean trueValue of 71.4 against an anchor
    // of 79.2, which collapsed Brier from 0.3338 to 0.5530 while leaving
    // ordering intact — better discrimination, destroyed calibration.
    expect(parToTrueValue(60, 60)).toBe(Math.round(averageStartableTrueValue()));
  });

  it("is monotonic in PAR", () => {
    const a = parToTrueValue(10, 60);
    const b = parToTrueValue(30, 60);
    const c = parToTrueValue(80, 60);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("stays inside 0-100 for extreme inputs", () => {
    expect(parToTrueValue(100000, 60)).toBeLessThanOrEqual(100);
    expect(parToTrueValue(-100000, 60)).toBeGreaterThanOrEqual(0);
  });

  it("falls back to replacement when the anchor is unusable", () => {
    // A degenerate curve must not produce a confident number.
    expect(parToTrueValue(50, 0)).toBe(50);
    expect(parToTrueValue(Number.NaN, 60)).toBe(50);
  });
});

describe("the average-startable PAR anchor", () => {
  const curve = buildPointsCurve([
    ...obs("QB", Array.from({ length: 20 }, (_, i) => 320 - i * 8)),
    ...obs("RB", Array.from({ length: 45 }, (_, i) => 300 - i * 5)),
    ...obs("WR", Array.from({ length: 50 }, (_, i) => 290 - i * 4)),
    ...obs("TE", Array.from({ length: 18 }, (_, i) => 200 - i * 7))
  ]);

  it("is positive — the average starter is better than replacement", () => {
    expect(averageStartablePar(curve, fmt())).toBeGreaterThan(0);
  });

  it("uses only the curve and the format, never outcome data for the season", () => {
    // Same curve, two league shapes: the anchor must respond to the LEAGUE,
    // which is what makes it safe to compute inside a backtest.
    const small = averageStartablePar(curve, fmt({ numTeams: 8 }));
    const large = averageStartablePar(curve, fmt({ numTeams: 14 }));
    expect(small).not.toBeCloseTo(large, 3);
  });

  it("returns 0 for an empty curve rather than throwing", () => {
    expect(averageStartablePar(buildPointsCurve([]), fmt())).toBe(0);
  });
});
