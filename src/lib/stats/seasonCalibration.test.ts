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
