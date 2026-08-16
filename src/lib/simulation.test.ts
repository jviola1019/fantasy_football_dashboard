import { describe, expect, it } from "vitest";
import { fixturePlayers } from "./fixtures";
import { avgStarterPtsFor, mulberry32, runNexusSimulation } from "./simulation";

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

  it("raises a roster's playoff odds in STD relative to PPR, all else equal", () => {
    // The concrete bias: the same roster in a standard league was scored in STD
    // points against a PPR-sized field, so its odds came out too low.
    //
    // Uses a MID-STRENGTH roster deliberately — the stock fixture is strong
    // enough to saturate at 100% in both formats, which would hide the effect
    // rather than test it.
    const roster = fixturePlayers.map((p) => ({ ...p, trueValue: 52 }));
    const base = { seed: 7, iterations: 4000, rosterSlots: 9, riskTolerance: 0.5 } as const;
    const ppr = runNexusSimulation(roster, { ...base, scoringFormat: "PPR" });
    const std = runNexusSimulation(roster, { ...base, scoringFormat: "STD" });
    expect(std.playoffProbability).toBeGreaterThan(ppr.playoffProbability);
  });

  it("defaults to PPR when the league format is unknown", () => {
    const roster = fixturePlayers;
    const base = { seed: 11, iterations: 1200, rosterSlots: 9, riskTolerance: 0.5 } as const;
    const explicit = runNexusSimulation(roster, { ...base, scoringFormat: "PPR" });
    const implicit = runNexusSimulation(roster, base);
    expect(implicit.playoffProbability).toBeCloseTo(explicit.playoffProbability, 5);
  });
});
