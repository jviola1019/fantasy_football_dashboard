import { describe, expect, it } from "vitest";
import { runNexusSimulation } from "./simulation";
import { fixturePlayers } from "./fixtures";
import { bootstrapCI, cohensD, welchTTest } from "./stats/distribution";

/**
 * Calibration tests for the Monte Carlo simulation engine.
 *
 * Purpose: prove the simulation reacts to its parameters in the way the README
 * claims, and quantify the effect sizes so future regressions are loud. None of
 * these tests assert *production* calibration — that needs real projections,
 * injury, schedule and scoring inputs (see docs/calibration.md). They assert
 * the structural behavior the deterministic engine guarantees today.
 */
describe("simulation — calibration properties", () => {
  it("deterministic given the same seed (replayability)", () => {
    const a = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: 6,
      riskTolerance: 0.58
    });
    const b = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: 6,
      riskTolerance: 0.58
    });
    expect(a.championshipProbability).toBe(b.championshipProbability);
    expect(a.playoffProbability).toBe(b.playoffProbability);
    expect(a.catastrophicRisk).toBe(b.catastrophicRisk);
  });

  it("higher risk tolerance produces statistically distinct championship outcomes (Welch p < 0.001)", () => {
    // Sample N=80 replicates with different seeds at each risk tolerance, then
    // compare the two distributions. Effect size should be large (|d| >= 0.5).
    const N = 80;
    const conservative: number[] = [];
    const aggressive: number[] = [];
    for (let i = 0; i < N; i++) {
      conservative.push(
        runNexusSimulation(fixturePlayers, {
          seed: 1000 + i,
          iterations: 800,
          rosterSlots: 6,
          riskTolerance: 0.15
        }).championshipProbability
      );
      aggressive.push(
        runNexusSimulation(fixturePlayers, {
          seed: 1000 + i,
          iterations: 800,
          rosterSlots: 6,
          riskTolerance: 0.95
        }).championshipProbability
      );
    }
    const test = welchTTest(aggressive, conservative);
    const d = cohensD(aggressive, conservative);
    // riskTolerance dampens chaos penalty, so high tolerance should yield strictly
    // higher championship rates. p must be vanishingly small and d must be large.
    expect(test.meanDelta).toBeGreaterThan(0);
    expect(test.pTwoSided).toBeLessThan(0.001);
    expect(Math.abs(d)).toBeGreaterThanOrEqual(0.5);
  }, 60_000);

  it("probabilities are valid percentages and outcomes do not over-sum impossibly", () => {
    const r = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: 6,
      riskTolerance: 0.58
    });
    for (const p of [r.championshipProbability, r.playoffProbability, r.catastrophicRisk, r.regretIndex]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    // championshipProbability is a subset of playoffProbability by construction
    // (rosterScore > 83 implies rosterScore > 73).
    expect(r.championshipProbability).toBeLessThanOrEqual(r.playoffProbability);
  });

  it("bootstrap 95% CI for championship probability has documented width bound", () => {
    // Sample 30 replicates with varying seeds, then bootstrap the CI for the mean.
    const samples = Array.from({ length: 30 }, (_, i) =>
      runNexusSimulation(fixturePlayers, {
        seed: 2000 + i,
        iterations: 800,
        rosterSlots: 6,
        riskTolerance: 0.58
      }).championshipProbability
    );
    const ci = bootstrapCI(samples, 0.95, 1000, 99);
    // The CI for the mean should be tight — on identical fixtures the seed-to-seed
    // variance is small. Width of ~5 percentage-points is generous and will catch
    // a regression that loosens the simulation.
    expect(ci.width).toBeLessThan(5);
    expect(ci.lower).toBeLessThanOrEqual(ci.estimate);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.estimate);
  }, 60_000);

  it("keyDrivers is non-empty and contributions are finite and sorted descending", () => {
    const r = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: 6,
      riskTolerance: 0.58
    });
    expect(r.keyDrivers.length).toBeGreaterThan(0);
    for (const d of r.keyDrivers) expect(Number.isFinite(d.contribution)).toBe(true);
    for (let i = 0; i < r.keyDrivers.length - 1; i++) {
      expect(r.keyDrivers[i]!.contribution).toBeGreaterThanOrEqual(r.keyDrivers[i + 1]!.contribution);
    }
  });
});

/**
 * Percentage-sanity gate. Probabilities and risk indices the dashboard renders
 * must always be valid percentages — no impossible >100% or negative values —
 * across the full parameter space, including adversarial inputs.
 */
describe("simulation — percentage sanity", () => {
  // Sweep risk tolerance, roster size, and seeds to probe the corners.
  const riskTolerances = [0, 0.15, 0.5, 0.85, 1];
  const rosterSlots = [1, 6, 14];

  it("every probability + the regret index stays within [0, 100] across the parameter sweep", () => {
    for (const riskTolerance of riskTolerances) {
      for (const slots of rosterSlots) {
        for (let seed = 0; seed < 6; seed++) {
          const r = runNexusSimulation(fixturePlayers, {
            seed: 7000 + seed,
            iterations: 600,
            rosterSlots: slots,
            riskTolerance
          });
          for (const [name, value] of Object.entries({
            championshipProbability: r.championshipProbability,
            playoffProbability: r.playoffProbability,
            catastrophicRisk: r.catastrophicRisk,
            regretIndex: r.regretIndex
          })) {
            expect(value, `${name} @ risk=${riskTolerance} slots=${slots}`).toBeGreaterThanOrEqual(0);
            expect(value, `${name} @ risk=${riskTolerance} slots=${slots}`).toBeLessThanOrEqual(100);
          }
          // A title run is always also a playoff run.
          expect(r.championshipProbability).toBeLessThanOrEqual(r.playoffProbability);
        }
      }
    }
  });

  it("regret index stays bounded even for an all-fragile, zero-tolerance roster", () => {
    // Adversarial: every player maximally fragile + volatile, risk tolerance 0.
    const fragile = fixturePlayers.map((p) => ({
      ...p,
      fragility: 100,
      volatility: 100,
      trueValue: 5,
      perceivedValue: 5
    }));
    const r = runNexusSimulation(fragile, {
      seed: 99,
      iterations: 1000,
      rosterSlots: 6,
      riskTolerance: 0
    });
    expect(r.regretIndex).toBeGreaterThanOrEqual(0);
    expect(r.regretIndex).toBeLessThanOrEqual(100);
  });
});
