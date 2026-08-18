import { describe, expect, it } from "vitest";
import { fixturePlayers } from "./fixtures";
import { avgStarterPtsFor, deriveSeasonInputs, mulberry32, runNexusSimulation } from "./simulation";

describe("nexus simulation", () => {
  it("replays deterministic random streams", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("replays deterministic simulation results", () => {
    const params = { seed: 20260513, iterations: 500, rosterSlots: 5, riskTolerance: 0.6 };
    const first = runNexusSimulation(fixturePlayers, params);
    const second = runNexusSimulation(fixturePlayers, params);
    expect(second).toEqual(first);
    expect(first.assumptions.length).toBeGreaterThan(0);
  });
});

describe("opponent field follows league scoring (audit F-010)", () => {
  it("keeps PPR at the value the model was calibrated against", () => {
    // PPR must be unchanged so existing calibration is not silently disturbed.
    expect(avgStarterPtsFor("PPR")).toBe(11.5);
  });

  it("lowers the field baseline as reception scoring drops", () => {
    // An average starter catches ~2 passes/game: worth 2 pts in PPR, 1 in half,
    // 0 in standard. The field must move with the league or the user's team is
    // measured in one currency against a field priced in another.
    expect(avgStarterPtsFor("HALF")).toBeLessThan(avgStarterPtsFor("PPR"));
    expect(avgStarterPtsFor("STD")).toBeLessThan(avgStarterPtsFor("HALF"));
    expect(avgStarterPtsFor("PPR") - avgStarterPtsFor("STD")).toBeCloseTo(2, 5);
  });

  it("gives the SAME odds in STD and PPR for an equally-valuable roster", () => {
    // CORRECTED. This test used to assert std > ppr "all else equal", and that
    // asymmetry was the bug, not the fix. When it was written the FIELD moved
    // with scoring format while the team stayed anchored to the PPR constant,
    // so a standard league mechanically inflated the team against a shrunken
    // field — the same defect as the original F-010, pointing the other way.
    //
    // The correct invariant: trueValue is already format-relative (replacement
    // level accounts for ppr through the flex weights), so a roster that is
    // equally far above replacement is equally good in its own league. Scoring
    // format rescales BOTH sides of the comparison and must cancel.
    //
    // Format-sensitivity of the baseline itself is still asserted by the
    // avgStarterPtsFor tests above; this one pins that it is applied evenly.
    const roster = fixturePlayers.map((p) => ({ ...p, trueValue: 82 }));
    const base = { seed: 7, iterations: 4000, rosterSlots: 9, riskTolerance: 0.5 } as const;

    // The exact invariant: the team's ADVANTAGE over its field, in points, does
    // not depend on scoring format.
    const gap = (scoringFormat: "STD" | "HALF" | "PPR") => {
      const { team, field } = deriveSeasonInputs(roster, { ...base, scoringFormat });
      return team.meanWeekly - field.meanWeekly;
    };
    expect(gap("STD")).toBeCloseTo(gap("PPR"), 6);
    expect(gap("HALF")).toBeCloseTo(gap("PPR"), 6);

    const ppr = runNexusSimulation(roster, { ...base, scoringFormat: "PPR" });
    const std = runNexusSimulation(roster, { ...base, scoringFormat: "STD" });
    const half = runNexusSimulation(roster, { ...base, scoringFormat: "HALF" });

    // Odds are CLOSE but not identical, and the reason is a known second-order
    // asymmetry rather than the bug above: the field's betweenTeamSigma is
    // proportional to the field mean and so shrinks in STD, while a player's
    // weekly sigma is an absolute points figure that does not move with format.
    // The same mean edge against slightly less noise is worth slightly more.
    // Documented in reports/2026-08-06/backtest-valuation.md as a residual.
    expect(Math.abs(std.playoffProbability - ppr.playoffProbability)).toBeLessThan(4);
    expect(Math.abs(half.playoffProbability - ppr.playoffProbability)).toBeLessThan(4);
    // Not vacuous — the roster is nowhere near saturation.
    expect(ppr.playoffProbability).toBeGreaterThan(1);
    expect(ppr.playoffProbability).toBeLessThan(99);
  });

  it("defaults to PPR when the league format is unknown", () => {
    const roster = fixturePlayers;
    const base = { seed: 11, iterations: 1200, rosterSlots: 9, riskTolerance: 0.5 } as const;
    const explicit = runNexusSimulation(roster, { ...base, scoringFormat: "PPR" });
    const implicit = runNexusSimulation(roster, base);
    expect(implicit.playoffProbability).toBeCloseTo(explicit.playoffProbability, 5);
  });
});
