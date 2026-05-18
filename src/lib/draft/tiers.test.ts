import { describe, expect, it } from "vitest";
import { tierCollapseSignals, tiersByPosition } from "./tiers";
import { fixturePlayers } from "../fixtures";

describe("tiersByPosition()", () => {
  it("returns one or more tiers per populated position", () => {
    const tiers = tiersByPosition(fixturePlayers);
    const positions = new Set(tiers.map((t) => t.position));
    expect(positions.has("WR")).toBe(true);
    expect(positions.has("RB")).toBe(true);
  });

  it("sorts within a position by trueValue descending", () => {
    const tiers = tiersByPosition(fixturePlayers).filter((t) => t.position === "RB");
    const flat = tiers.flatMap((t) => t.players);
    for (let i = 0; i < flat.length - 1; i++) {
      expect(flat[i]!.trueValue).toBeGreaterThanOrEqual(flat[i + 1]!.trueValue);
    }
  });

  it("never invents players", () => {
    const tiers = tiersByPosition(fixturePlayers);
    const tierIds = new Set(tiers.flatMap((t) => t.players.map((p) => p.id)));
    for (const id of tierIds) {
      expect(fixturePlayers.some((p) => p.id === id)).toBe(true);
    }
  });
});

describe("tierCollapseSignals()", () => {
  it("returns an intensity in [0,1]", () => {
    const signals = tierCollapseSignals(tiersByPosition(fixturePlayers));
    for (const s of signals) {
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});
