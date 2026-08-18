import { describe, expect, it } from "vitest";
import { runNexusSimulation } from "./simulation";
import { fixturePlayers } from "./fixtures";
import { bootstrapCI } from "./stats/distribution";
import { averageStartableTrueValue } from "./fantasypros/enrich";
import type { PlayerMarketRecord } from "./governance";

/**
 * Calibration tests for the season Monte Carlo (runNexusSimulation → real
 * simulated season; see seasonSim.ts and docs/season-sim.md). These assert the
 * engine produces genuinely calibrated, structurally-correct probabilities:
 * a league-average roster makes the playoffs at the fair rate, strength is
 * monotonic, variance helps underdogs / hurts favorites, and real projections
 * drive the odds.
 */
const ROSTER_SLOTS = 9;
/** trueValue of the average STARTABLE player — the real league-average roster. */
const AVG_STARTABLE = averageStartableTrueValue();
function withStrength(tv: number, volatility = 35): PlayerMarketRecord[] {
  return fixturePlayers.map((p) => ({ ...p, trueValue: tv, volatility }));
}

describe("season simulation — calibration properties", () => {
  it("deterministic given the same seed (replayability)", () => {
    const params = { seed: 20260513, iterations: 1000, rosterSlots: ROSTER_SLOTS, riskTolerance: 0.58 };
    const a = runNexusSimulation(fixturePlayers, params);
    const b = runNexusSimulation(fixturePlayers, params);
    expect(a.championshipProbability).toBe(b.championshipProbability);
    expect(a.playoffProbability).toBe(b.playoffProbability);
    expect(a.catastrophicRisk).toBe(b.catastrophicRisk);
  });

  it("CALIBRATION: a league-average roster makes the playoffs ≈ playoffTeams/numTeams", () => {
    // CORRECTED 2026-08-17. This used trueValue 50 as "the median roster", but
    // 50 is REPLACEMENT LEVEL, not league-average — and the simulation used to
    // agree with the mistake, mapping 50 onto an average starter's points. The
    // out-of-sample backtest exposed it: every real roster then sat ~42% above
    // its own field and drew ~100% playoff odds.
    //
    // The league-average roster is one made of AVERAGE STARTABLE players, whose
    // trueValue is derived from the depth cushion (79.2 at 1.2). The property
    // being asserted is unchanged; only the input that represents "average" is.
    const r = runNexusSimulation(withStrength(AVG_STARTABLE), {
      seed: 20260601,
      iterations: 3000,
      rosterSlots: ROSTER_SLOTS,
      riskTolerance: 0.5
    });
    expect(r.playoffProbability).toBeGreaterThan(42);
    expect(r.playoffProbability).toBeLessThan(58);
  });

  it("playoff probability is monotonic in roster strength", () => {
    // Ladder straddles the average-startable anchor so the comparison spans
    // below-average / average / above-average rather than three flavours of
    // below-replacement.
    const params = { seed: 20260601, iterations: 2500, rosterSlots: ROSTER_SLOTS, riskTolerance: 0.5 };
    const weak = runNexusSimulation(withStrength(AVG_STARTABLE - 20), params).playoffProbability;
    const avg = runNexusSimulation(withStrength(AVG_STARTABLE), params).playoffProbability;
    const strong = runNexusSimulation(withStrength(AVG_STARTABLE + 15), params).playoffProbability;
    expect(weak).toBeLessThan(avg);
    expect(avg).toBeLessThan(strong);
  });

  it("a REPLACEMENT-level roster is below average, as the name implies", () => {
    // The distinction the old test conflated: trueValue 50 must now come out
    // clearly worse than the fair rate.
    const r = runNexusSimulation(withStrength(50), {
      seed: 20260601,
      iterations: 3000,
      rosterSlots: ROSTER_SLOTS,
      riskTolerance: 0.5
    });
    expect(r.playoffProbability).toBeLessThan(42);
  });

  it("for a strong favorite, more variance lowers title odds (variance helps underdogs, hurts favorites)", () => {
    // The demo fixture is a stacked roster (heavy favorite). Higher risk
    // tolerance widens its week-to-week variance, raising single-elimination
    // upset risk, so its championship probability falls.
    const params = { seed: 20260601, iterations: 4000, rosterSlots: ROSTER_SLOTS };
    const low = runNexusSimulation(fixturePlayers, { ...params, riskTolerance: 0.1 }).championshipProbability;
    const high = runNexusSimulation(fixturePlayers, { ...params, riskTolerance: 0.95 }).championshipProbability;
    expect(low).toBeGreaterThan(high);
  });

  it("real weekly projections drive the odds (stronger projections → better odds)", () => {
    const params = { seed: 20260601, iterations: 2500, rosterSlots: ROSTER_SLOTS, riskTolerance: 0.5 };
    const goodProj = new Map(fixturePlayers.map((p) => [p.id, 18])); // ~18 pts/starter (well above avg)
    const badProj = new Map(fixturePlayers.map((p) => [p.id, 7])); // ~7 pts/starter (well below avg)
    const good = runNexusSimulation(fixturePlayers, { ...params, weeklyProjections: goodProj }).playoffProbability;
    const bad = runNexusSimulation(fixturePlayers, { ...params, weeklyProjections: badProj }).playoffProbability;
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThan(70);
    expect(bad).toBeLessThan(30);
  });

  it("probabilities are valid percentages and championship ⊆ playoffs", () => {
    const r = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: ROSTER_SLOTS,
      riskTolerance: 0.58
    });
    for (const p of [r.championshipProbability, r.playoffProbability, r.catastrophicRisk, r.regretIndex]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    // You cannot win the title without making the playoffs.
    expect(r.championshipProbability).toBeLessThanOrEqual(r.playoffProbability);
  });

  it("bootstrap 95% CI for championship probability is tight across seeds", () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      runNexusSimulation(fixturePlayers, {
        seed: 2000 + i,
        iterations: 800,
        rosterSlots: ROSTER_SLOTS,
        riskTolerance: 0.58
      }).championshipProbability
    );
    const ci = bootstrapCI(samples, 0.95, 1000, 99);
    // Seed-to-seed variance on a fixed roster is small; a ~5-point width band
    // catches a regression that loosens the simulation.
    expect(ci.width).toBeLessThan(5);
    expect(ci.lower).toBeLessThanOrEqual(ci.estimate);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.estimate);
  }, 60_000);

  it("keyDrivers is non-empty and contributions are finite and sorted descending", () => {
    const r = runNexusSimulation(fixturePlayers, {
      seed: 20260513,
      iterations: 1000,
      rosterSlots: ROSTER_SLOTS,
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
 * must always be valid percentages across the full parameter space, including
 * adversarial inputs.
 */
describe("season simulation — percentage sanity", () => {
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
          expect(r.championshipProbability).toBeLessThanOrEqual(r.playoffProbability);
        }
      }
    }
  });

  it("stays bounded even for an all-fragile, zero-tolerance roster", () => {
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
