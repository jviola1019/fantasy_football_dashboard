import { describe, it, expect } from "vitest";
import { buildTrendingMap, trendingMomentumFromProxy } from "./trendingProxy";

describe("buildTrendingMap", () => {
  it("returns an empty map for null / undefined / empty input", () => {
    expect(buildTrendingMap(null).size).toBe(0);
    expect(buildTrendingMap(undefined).size).toBe(0);
    expect(buildTrendingMap([]).size).toBe(0);
  });

  it("keys by player_id with count as the value", () => {
    const map = buildTrendingMap([
      { player_id: "4046", count: 10000 },
      { player_id: "11604", count: 5000 }
    ]);
    expect(map.get("4046")).toBe(10000);
    expect(map.get("11604")).toBe(5000);
  });

  it("clamps non-finite counts to zero", () => {
    const map = buildTrendingMap([{ player_id: "4046", count: Number.NaN }]);
    expect(map.get("4046")).toBe(0);
  });
});

describe("trendingMomentumFromProxy", () => {
  it("returns positive pressure when adds > drops", () => {
    const adds = new Map([["4046", 9000]]);
    const drops = new Map([["4046", 1000]]);
    const pressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    expect(pressure).toBeGreaterThan(0);
  });

  it("returns negative pressure when drops > adds", () => {
    const adds = new Map([["4046", 100]]);
    const drops = new Map([["4046", 9000]]);
    const pressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    expect(pressure).toBeLessThan(0);
  });

  it("returns 0 for a player not in either trending map", () => {
    const adds = new Map([["different-id", 9000]]);
    const drops = new Map();
    expect(trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops)).toBe(0);
  });

  it("strips the 'sleeper:' prefix on the record id before lookup", () => {
    const adds = new Map([["4046", 9000]]);
    const drops = new Map();
    // Same player, different id format — both should resolve.
    const withPrefix = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    const withoutPrefix = trendingMomentumFromProxy({ id: "4046" }, adds, drops);
    expect(withPrefix).toBe(withoutPrefix);
    expect(withPrefix).toBeGreaterThan(0);
  });

  it("normalises against the global max so the top adder gets ~+100", () => {
    const adds = new Map([
      ["4046", 10000],
      ["other", 5000]
    ]);
    const drops = new Map();
    const topPressure = trendingMomentumFromProxy({ id: "sleeper:4046" }, adds, drops);
    const midPressure = trendingMomentumFromProxy({ id: "sleeper:other" }, adds, drops);
    expect(topPressure).toBe(100);
    expect(midPressure).toBe(50);
  });

  it("respects the [-100, 100] bound", () => {
    const adds = new Map([["a", 1000]]);
    const drops = new Map([["a", 1000]]);
    // adds == drops -> pressure = 0
    expect(trendingMomentumFromProxy({ id: "sleeper:a" }, adds, drops)).toBe(0);
  });
});
