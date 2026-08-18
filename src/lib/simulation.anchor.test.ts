import { describe, expect, it } from "vitest";
import { avgStarterPtsFor, deriveSeasonInputs, runNexusSimulation } from "./simulation";
import { averageStartableTrueValue } from "./fantasypros/enrich";
import type { PlayerMarketRecord } from "./governance";

/**
 * The team/field scale invariant (audit follow-up, 2026-08-17).
 *
 * `runNexusSimulation` has always DOCUMENTED that "a league-average roster makes
 * the playoffs ≈ playoffTeams/numTeams". It did not hold: `starterWeeklyMean`
 * mapped trueValue 50 onto an average starter's points, but trueValue 50 is
 * REPLACEMENT LEVEL. Replacement is worse than an average starter by definition,
 * so every real roster floated above its own opponent field.
 *
 * Found by scripts/backtest-valuation.ts on five completed leagues: every team
 * averaged 164 weekly points against a 115 field — every team 42% above average,
 * impossible for all of them at once. All 50 team-seasons predicted ~100%
 * playoff odds, giving Brier 0.4000 and AUC exactly 0.5000.
 *
 * simulation.calibration.test.ts asserts the resulting PROBABILITIES. This file
 * asserts the underlying SCALE INVARIANT, which is the thing that was broken and
 * the cheaper signal when it breaks again.
 */

const ANCHOR = averageStartableTrueValue();

function roster(trueValue: number, n: number): PlayerMarketRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    position: "RB",
    team: "KC",
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 35,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: "RB",
    status: "active",
    imageUrl: "",
    imageSource: "test"
  })) as unknown as PlayerMarketRecord[];
}

describe("the points anchor is the average STARTABLE player", () => {
  it("is derived in closed form from the depth cushion", () => {
    // 50 + 50*(1 - 1/(2*1.2)) = 79.17 — free of league size and position,
    // because startable count and replacement scale together.
    expect(ANCHOR).toBeCloseTo(79.17, 1);
  });

  it("sits ABOVE replacement level, which is what 50 means", () => {
    expect(ANCHOR).toBeGreaterThan(50);
  });

  it("puts a median roster's team mean EXACTLY on the field mean", () => {
    const { team, field } = deriveSeasonInputs(roster(ANCHOR, 10), {
      seed: 1,
      iterations: 10,
      rosterSlots: 10,
      riskTolerance: 0.5,
      weeklyProjections: null,
      scoringFormat: "PPR"
    });
    expect(team.meanWeekly).toBeCloseTo(field.meanWeekly, 6);
    expect(team.meanWeekly).toBeCloseTo(10 * avgStarterPtsFor("PPR"), 6);
  });

  it("holds the invariant in EVERY scoring format", () => {
    // The team side used to be pinned to the PPR constant while the field moved
    // with format, so this failed for STD and HALF in the opposite direction.
    for (const scoringFormat of ["STD", "HALF", "PPR"] as const) {
      const { team, field } = deriveSeasonInputs(roster(ANCHOR, 9), {
        seed: 1,
        iterations: 10,
        rosterSlots: 9,
        riskTolerance: 0.5,
        weeklyProjections: null,
        scoringFormat
      });
      expect(team.meanWeekly, scoringFormat).toBeCloseTo(field.meanWeekly, 6);
    }
  });
});

describe("league-average odds track the league's playoff share", () => {
  const sim = (tv: number, numTeams: number, playoffTeams: number) =>
    runNexusSimulation(roster(tv, 10), {
      seed: 42,
      iterations: 4000,
      rosterSlots: 10,
      riskTolerance: 0.5,
      weeklyProjections: null,
      scoringFormat: "PPR",
      numTeams,
      playoffTeams,
      regularSeasonWeeks: 14
    }).playoffProbability;

  it("follows playoffTeams/numTeams across league shapes", () => {
    for (const [numTeams, playoffTeams] of [
      [8, 4],
      [10, 6],
      [12, 6],
      [14, 6]
    ] as const) {
      const expected = (playoffTeams / numTeams) * 100;
      const odds = sim(ANCHOR, numTeams, playoffTeams);
      expect(Math.abs(odds - expected), `${numTeams}T/${playoffTeams}p → ${odds}`).toBeLessThan(18);
    }
  });

  it("REGRESSION: a median roster is no longer pinned near 100%", () => {
    // The precise symptom the backtest surfaced, and the reason AUC was 0.5:
    // with every team at 100% there is nothing left to discriminate.
    expect(sim(ANCHOR, 10, 6)).toBeLessThan(90);
  });
});
