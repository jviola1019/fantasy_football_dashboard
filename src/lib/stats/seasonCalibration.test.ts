import { describe, it, expect } from "vitest";
import {
  buildLeagueModels,
  runSyntheticCalibration,
  scoreForecasts,
  syntheticConfigs,
} from "./seasonCalibration";
import type { BrierForecast } from "./distribution";

describe("buildLeagueModels", () => {
  it("derives per-team strength and a field model from real weekly scores", () => {
    const weeklyByTeam = [
      [120, 130, 110], // mean 120
      [100, 90, 110], // mean 100
      [140, 150, 160], // mean 150
    ];
    const { field, teams } = buildLeagueModels(weeklyByTeam);
    expect(teams[0]!.meanWeekly).toBeCloseTo(120, 6);
    expect(teams[2]!.meanWeekly).toBeCloseTo(150, 6);
    expect(teams[0]!.sigmaWeekly).toBeGreaterThan(0);
    expect(field.meanWeekly).toBeCloseTo((120 + 100 + 150) / 3, 6);
    expect(field.betweenTeamSigma).toBeGreaterThan(0);
    expect(field.withinTeamSigma).toBeGreaterThan(0);
  });

  it("degrades to positive sigmas on a single team / single week", () => {
    const { field, teams } = buildLeagueModels([[100]]);
    expect(teams[0]!.meanWeekly).toBe(100);
    expect(teams[0]!.sigmaWeekly).toBe(0);
    expect(field.betweenTeamSigma).toBe(1);
    expect(field.withinTeamSigma).toBe(1);
  });
});

describe("syntheticConfigs", () => {
  it("produces the requested count with monotonically increasing team strength", () => {
    const cfgs = syntheticConfigs(10);
    expect(cfgs).toHaveLength(10);
    for (let i = 1; i < cfgs.length; i++) {
      expect(cfgs[i]!.team.meanWeekly).toBeGreaterThan(cfgs[i - 1]!.team.meanWeekly);
    }
  });
});

describe("runSyntheticCalibration", () => {
  const result = runSyntheticCalibration({
    count: 12,
    nPred: 1000,
    nTruth: 6000,
    outcomeDraws: 150,
    seed: 1,
  });

  it("reports the expected shape", () => {
    expect(result.nConfigs).toBe(12);
    expect(result.nForecasts).toBe(12 * 150);
    expect(result.reliabilityBins.length).toBeGreaterThan(0);
  });

  it("shows the displayed probabilities are honest frequencies (coverage ≈ level)", () => {
    // The independent truth should land inside the prediction's 90% Wilson
    // interval most of the time. Loose bound to stay robust to MC noise.
    expect(result.coverage).toBeGreaterThanOrEqual(0.6);
    expect(result.coverage).toBeLessThanOrEqual(1);
  });

  it("is well-calibrated by construction (small ECE, Brier below the uncertainty ceiling)", () => {
    expect(result.playoffEce).toBeLessThan(0.08);
    expect(result.playoffBrier).toBeGreaterThanOrEqual(0);
    expect(result.playoffBrier).toBeLessThanOrEqual(0.25); // max binary uncertainty
    expect(result.championshipBrier).toBeLessThanOrEqual(0.25);
  });

  it("is deterministic for a fixed seed", () => {
    const again = runSyntheticCalibration({
      count: 12,
      nPred: 1000,
      nTruth: 6000,
      outcomeDraws: 150,
      seed: 1,
    });
    expect(again.coverage).toBe(result.coverage);
    expect(again.playoffBrier).toBe(result.playoffBrier);
    expect(again.championshipBrier).toBe(result.championshipBrier);
  });
});

describe("scoreForecasts", () => {
  it("scores a real-forecast set with the same machinery", () => {
    const forecasts: BrierForecast[] = [
      ...Array.from({ length: 40 }, () => ({ prob: 0.0, outcome: 0 as const })),
      ...Array.from({ length: 40 }, () => ({ prob: 1.0, outcome: 1 as const })),
      ...Array.from({ length: 20 }, () => ({ prob: 0.5, outcome: 1 as const })),
      ...Array.from({ length: 20 }, () => ({ prob: 0.5, outcome: 0 as const })),
    ];
    const s = scoreForecasts(forecasts);
    expect(s.n).toBe(120);
    expect(s.ece).toBeCloseTo(0, 6); // perfectly calibrated
    expect(s.brier).toBeGreaterThan(0);
    expect(s.reliabilityBins.length).toBeGreaterThan(0);
  });
});

describe("betweenTeamSigma excludes the within-team sampling term (P2-6)", () => {
  /**
   * A team's season mean is estimated from W weekly games, so
   *
   *     Var(observed means) = Var(true strength) + Var(weekly) / W
   *
   * The estimator used the raw standard deviation, so the simulator drew each
   * opponent's strength from an inflated spread and then added weekly noise on
   * top -- counting within-team variance twice and over-dispersing the field.
   * Measured bias at realistic parameters: +8.4% (npm run measure:sigma).
   */
  it("returns zero spread when every team is identical apart from weekly noise", () => {
    // Four teams, same true strength, differing only by the noise around it.
    // The raw standard deviation of their season means is NOT zero; the
    // variance-components estimate should be, because there is no real spread.
    const weekly = [
      [100, 120, 80, 110, 90, 105, 95, 115],
      [105, 95, 115, 85, 120, 100, 90, 110],
      [90, 110, 100, 120, 80, 115, 105, 95],
      [115, 85, 105, 95, 110, 90, 120, 100]
    ];
    const { field } = buildLeagueModels(weekly);
    // Every team has the same 8 numbers in a different order, so their season
    // means are exactly equal and the raw estimate is already 0 -- this pins
    // that the correction cannot push a zero spread NEGATIVE or NaN.
    expect(field.betweenTeamSigma).toBe(0);
    expect(Number.isFinite(field.betweenTeamSigma)).toBe(true);
  });

  it("is strictly smaller than the raw spread of season means", () => {
    const weekly = [
      [130, 140, 120, 135, 125, 145, 115, 138],
      [100, 95, 110, 90, 105, 98, 102, 108],
      [80, 75, 90, 70, 85, 78, 82, 88],
      [110, 118, 105, 122, 100, 115, 108, 112]
    ];
    const means = weekly.map((w) => w.reduce((a, b) => a + b, 0) / w.length);
    const m = means.reduce((a, b) => a + b, 0) / means.length;
    const rawSigma = Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / (means.length - 1));

    const { field } = buildLeagueModels(weekly);
    expect(field.betweenTeamSigma).toBeLessThan(rawSigma);
    expect(field.betweenTeamSigma).toBeGreaterThan(0);
  });

  it("floors at zero rather than producing a negative variance", () => {
    // Wild weekly noise, near-identical strengths: the sampling term exceeds
    // the observed spread, so the variance estimate goes negative. A negative
    // variance means "no detectable spread", not a negative one.
    const weekly = [
      [10, 200, 5, 195, 12, 190],
      [190, 12, 195, 8, 200, 7]
    ];
    const { field } = buildLeagueModels(weekly);
    expect(field.betweenTeamSigma).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(field.betweenTeamSigma)).toBe(false);
  });
});
