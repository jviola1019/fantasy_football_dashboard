import { describe, expect, it } from "vitest";
import { gaussian, runSeasonSimulation, type FieldModel, type SeasonSimConfig } from "./seasonSim";
import { mulberry32 } from "./simulation";

describe("gaussian", () => {
  it("produces an approximately standard-normal stream (mean≈0, sd≈1)", () => {
    const rng = mulberry32(7);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const g = gaussian(rng);
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(Math.sqrt(variance) - 1)).toBeLessThan(0.05);
  });

  it("is deterministic for a given seed stream", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([gaussian(a), gaussian(a), gaussian(a)]).toEqual([gaussian(b), gaussian(b), gaussian(b)]);
  });
});

// Standard 12-team / 6-playoff league field used across the calibration tests.
const FIELD: FieldModel = { meanWeekly: 105, betweenTeamSigma: 14, withinTeamSigma: 28 };
const CONFIG: SeasonSimConfig = {
  seed: 20260601,
  iterations: 4000,
  numTeams: 12,
  regularSeasonWeeks: 14,
  playoffTeams: 6
};

describe("runSeasonSimulation", () => {
  it("is deterministic for the same inputs", () => {
    const team = { meanWeekly: 105, sigmaWeekly: 28 };
    const a = runSeasonSimulation(team, FIELD, CONFIG);
    const b = runSeasonSimulation(team, FIELD, CONFIG);
    expect(a).toEqual(b);
  });

  it("CALIBRATION: a league-average team makes the playoffs ≈ playoffTeams/numTeams of the time", () => {
    // Team identical to the field (mean = field mean, sigma = within-team sigma).
    const team = { meanWeekly: FIELD.meanWeekly, sigmaWeekly: FIELD.withinTeamSigma };
    const r = runSeasonSimulation(team, FIELD, CONFIG);
    // 6 of 12 teams make the playoffs → an average team should be ~50%.
    expect(r.playoffProbability).toBeGreaterThan(0.42);
    expect(r.playoffProbability).toBeLessThan(0.58);
    // And win ≈ half its regular-season games.
    expect(r.expectedWins).toBeGreaterThan(6.3);
    expect(r.expectedWins).toBeLessThan(7.7);
  });

  it("CALIBRATION: an average team wins the title at roughly the fair 1/numTeams rate", () => {
    const team = { meanWeekly: FIELD.meanWeekly, sigmaWeekly: FIELD.withinTeamSigma };
    const r = runSeasonSimulation(team, FIELD, CONFIG);
    // Fair share is 1/12 ≈ 8.3%; allow a generous band (seeding + variance shift it).
    expect(r.championshipProbability).toBeGreaterThan(0.03);
    expect(r.championshipProbability).toBeLessThan(0.16);
  });

  it("a clearly stronger team makes the playoffs far more often than a clearly weaker one", () => {
    const strong = runSeasonSimulation({ meanWeekly: 130, sigmaWeekly: 28 }, FIELD, CONFIG);
    const weak = runSeasonSimulation({ meanWeekly: 80, sigmaWeekly: 28 }, FIELD, CONFIG);
    expect(strong.playoffProbability).toBeGreaterThan(0.85);
    expect(weak.playoffProbability).toBeLessThan(0.15);
    expect(strong.championshipProbability).toBeGreaterThan(weak.championshipProbability);
  });

  it("playoff probability is monotonic in team strength", () => {
    const probs = [85, 95, 105, 115, 125].map(
      (m) => runSeasonSimulation({ meanWeekly: m, sigmaWeekly: 28 }, FIELD, CONFIG).playoffProbability
    );
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]!).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it("championship ⊆ playoffs and both stay in [0,1]; expectedWins in [0, weeks]", () => {
    for (const m of [70, 105, 140]) {
      const r = runSeasonSimulation({ meanWeekly: m, sigmaWeekly: 28 }, FIELD, CONFIG);
      expect(r.championshipProbability).toBeLessThanOrEqual(r.playoffProbability);
      for (const p of [r.playoffProbability, r.championshipProbability, r.byeProbability, r.bottomProbability]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(r.expectedWins).toBeGreaterThanOrEqual(0);
      expect(r.expectedWins).toBeLessThanOrEqual(CONFIG.regularSeasonWeeks);
    }
  });
});
