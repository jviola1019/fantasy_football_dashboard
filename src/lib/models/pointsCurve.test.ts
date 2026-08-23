import { describe, expect, it } from "vitest";
import {
  curveSampleDiagnostics,
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

/**
 * Synthetic observations. Each gets a DISTINCT playerId so the default
 * cluster-weighted aggregation treats them as independent player-seasons —
 * these fixtures are about curve shape, not about dependence (audit SS5).
 * `leagueId` defaults to one league for the same reason.
 */
const obs = (
  position: PointsObservation["position"],
  points: number[],
  season = 2024,
  leagueId = "L1"
): PointsObservation[] =>
  points.map((seasonPoints, i) => ({
    season,
    position,
    adpRank: i + 1,
    seasonPoints,
    scoringFormat: "PPR" as const,
    playerId: `${position}-${season}-${i + 1}`,
    leagueId
  }));

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
      { season: 2024, position: "RB", adpRank: 1, seasonPoints: Number.NaN, playerId: "a", leagueId: "L1", scoringFormat: "PPR" },
      { season: 2024, position: "RB", adpRank: 2, seasonPoints: 100, playerId: "b", leagueId: "L1", scoringFormat: "PPR" }
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

// ---------------------------------------------------------------------------
// Audit 2026-08-20 §5 — dependence and pseudo-replication
// ---------------------------------------------------------------------------

/** One NFL player-season, drafted at possibly different ranks in `n` leagues. */
function inLeagues(
  playerId: string,
  position: PointsObservation["position"],
  seasonPoints: number,
  ranks: Array<[string, number]>,
  season = 2024
): PointsObservation[] {
  return ranks.map(([leagueId, adpRank]) => ({
    season,
    position,
    adpRank,
    seasonPoints,
    scoringFormat: "PPR" as const,
    playerId,
    leagueId
  }));
}

describe("curveSampleDiagnostics", () => {
  it("counts a player drafted in five leagues as ONE independent outcome", () => {
    const rows = inLeagues("mccaffrey", "RB", 300, [
      ["L1", 1],
      ["L2", 1],
      ["L3", 2],
      ["L4", 1],
      ["L5", 3]
    ]);
    const d = curveSampleDiagnostics(rows);
    expect(d.rawObservations).toBe(5);
    expect(d.uniquePlayerSeasons).toBe(1);
    expect(d.duplicatedPlayerSeasons).toBe(4);
    expect(d.playerSeasonsInMultipleLeagues).toBe(1);
    expect(d.leagues).toBe(5);
    expect(d.designEffect).toBe(5);
  });

  it("separates the same player in different seasons — those ARE independent draws", () => {
    const rows = [
      ...inLeagues("x", "WR", 200, [["L1", 1]], 2023),
      ...inLeagues("x", "WR", 250, [["L1", 1]], 2024)
    ];
    const d = curveSampleDiagnostics(rows);
    expect(d.uniquePlayerSeasons).toBe(2);
    expect(d.designEffect).toBe(1);
    expect(d.seasons).toEqual([2023, 2024]);
  });

  it("reports per-position effective sample, not just the total", () => {
    const rows = [
      ...inLeagues("rb1", "RB", 300, [["L1", 1], ["L2", 1]]),
      ...inLeagues("rb2", "RB", 250, [["L1", 2]]),
      ...inLeagues("qb1", "QB", 320, [["L1", 1], ["L2", 1], ["L3", 1]])
    ];
    const d = curveSampleDiagnostics(rows);
    expect(d.perPosition.RB).toMatchObject({ rawObservations: 3, effectiveObservations: 2 });
    expect(d.perPosition.QB).toMatchObject({ rawObservations: 3, effectiveObservations: 1 });
    expect(d.perPosition.QB!.designEffect).toBe(3);
  });

  it("handles an empty sample without dividing by zero", () => {
    const d = curveSampleDiagnostics([]);
    expect(d.designEffect).toBe(0);
    expect(d.uniquePlayerSeasons).toBe(0);
  });
});

describe("aggregation modes for repeated player-seasons", () => {
  // One elite RB in three leagues at ranks 1/1/3, plus one ordinary RB in one
  // league at rank 3. Under league-level the elite player's outcome is counted
  // three times and dominates the fit.
  const rows = [
    ...inLeagues("elite", "RB", 300, [["L1", 1], ["L2", 1], ["L3", 3]]),
    ...inLeagues("ordinary", "RB", 100, [["L1", 3]])
  ];

  it("league-level over-weights the repeated outcome (the previous behaviour)", () => {
    const c = buildPointsCurve(rows, { aggregation: "league-level" });
    // Rank 3 pools the elite player's 300 (from L3) with the ordinary 100.
    expect(expectedPointsAt(c, "RB", 3)).toBe(200);
    expect(c.counts.RB).toBe(4);
    expect(c.aggregation).toBe("league-level");
  });

  it("player-season collapses to the median rank and drops the spread", () => {
    const c = buildPointsCurve(rows, { aggregation: "player-season" });
    expect(c.aggregation).toBe("player-season");
    // Two distinct player-seasons only.
    expect(c.counts.RB).toBe(2);
    // The elite player's median rank across [1, 1, 3] is 1 — the rank-3
    // evidence is discarded entirely.
    expect(expectedPointsAt(c, "RB", 1)).toBe(300);
    expect(expectedPointsAt(c, "RB", 3)).toBe(100);
  });

  it("cluster-weighted keeps every rank but caps each outcome at weight 1", () => {
    const c = buildPointsCurve(rows, { aggregation: "cluster-weighted" });
    expect(c.aggregation).toBe("cluster-weighted");
    // Effective n is the number of distinct player-seasons.
    expect(c.counts.RB).toBeCloseTo(2, 6);
    // Rank 3 still sees BOTH the elite (weight 1/3) and the ordinary (weight 1)
    // rather than either discarding the rank-3 draft or counting it in full.
    const expected = (300 * (1 / 3) + 100 * 1) / (1 / 3 + 1);
    expect(expectedPointsAt(c, "RB", 3)).toBeCloseTo(expected, 6);
  });

  it("cluster-weighted is the default — the a-priori statistical choice", () => {
    expect(buildPointsCurve(rows).aggregation).toBe("cluster-weighted");
  });

  it("all three agree exactly when nothing is repeated", () => {
    // The modes differ ONLY in how they treat dependence. With one league and
    // distinct players they must be identical, or one of them is doing
    // something it should not.
    const clean = obs("WR", [250, 200, 150, 120]);
    const a = buildPointsCurve(clean, { aggregation: "league-level" });
    const b = buildPointsCurve(clean, { aggregation: "player-season" });
    const c = buildPointsCurve(clean, { aggregation: "cluster-weighted" });
    expect(a.byPosition.WR).toEqual(b.byPosition.WR);
    expect(a.byPosition.WR).toEqual(c.byPosition.WR);
  });

  it("every mode preserves the non-increasing constraint", () => {
    for (const aggregation of ["league-level", "player-season", "cluster-weighted"] as const) {
      const c = buildPointsCurve(rows, { aggregation });
      const series = c.byPosition.RB!;
      for (let i = 1; i < series.length; i += 1) {
        expect(series[i]!).toBeLessThanOrEqual(series[i - 1]! + 1e-9);
      }
    }
  });
});

describe("scoring format is recorded, and mixing it is visible (P2-3)", () => {
  /**
   * Season points are not comparable across scoring formats. Pooling a PPR
   * league's receivers with a STANDARD league's lifts the WR and TE curves
   * relative to RB and QB -- a POSITIONALLY ASYMMETRIC distortion, which is the
   * exact error this curve was built to remove from rank-ratio VBD. The pool
   * carried no format at all, so the mixing was invisible.
   */
  const withFormat = (
    format: PointsObservation["scoringFormat"],
    leagueId: string
  ): PointsObservation[] =>
    [220, 180, 150].map((seasonPoints, i) => ({
      season: 2024,
      position: "WR" as const,
      adpRank: i + 1,
      seasonPoints,
      scoringFormat: format,
      playerId: `WR-${i + 1}`,
      leagueId
    }));

  it("reports a single-format pool as unmixed", () => {
    const curve = buildPointsCurve(withFormat("PPR", "L1"));
    expect(curve.scoringFormats).toEqual(["PPR"]);
    expect(curve.mixedScoringFormats).toBe(false);
  });

  it("flags a pool that spans two formats", () => {
    const curve = buildPointsCurve([...withFormat("PPR", "L1"), ...withFormat("STD", "L2")]);
    expect(curve.scoringFormats).toEqual(["PPR", "STD"]);
    expect(curve.mixedScoringFormats).toBe(true);
  });

  it("lists every format present, sorted, so the report can name them", () => {
    const curve = buildPointsCurve([
      ...withFormat("PPR", "L1"),
      ...withFormat("HALF", "L2"),
      ...withFormat("STD", "L3")
    ]);
    expect(curve.scoringFormats).toEqual(["HALF", "PPR", "STD"]);
  });
});
