import { describe, expect, it } from "vitest";
import { fixturePlayers } from "./fixtures";
import { mulberry32, runNexusSimulation } from "./simulation";

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
