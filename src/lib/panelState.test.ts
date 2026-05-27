import { describe, it, expect } from "vitest";
import { derivePanelState, asMetricSet, type PanelMetricKey } from "./panelState";
import type { RAEEnvelope } from "./governance";

// Minimal envelope factory — only the sourceState.missingFields field
// matters to derivePanelState, so we leave everything else as the bare
// shape required by the schema (records empty, mode "live").
function envelopeWithMissing(missingFields: string[]): RAEEnvelope {
  return {
    mode: "live",
    generatedAt: new Date().toISOString(),
    records: [],
    sourceState: {
      source: "test",
      fetchedAt: new Date().toISOString(),
      ttlSeconds: 60,
      freshness: "fresh",
      confidence: 1,
      validation: "valid",
      missingFields,
      assumptions: [],
      failure: null
    }
  };
}

describe("derivePanelState", () => {
  it("returns ready with empty dependsOn list", () => {
    const env = envelopeWithMissing(["trending_momentum"]);
    const state = derivePanelState(env, []);
    expect(state.status).toBe("ready");
    expect(state.bannerText).toBeNull();
    expect(state.unavailable.size).toBe(0);
  });

  it("returns ready when none of the dependencies are missing", () => {
    const env = envelopeWithMissing(["fragility"]); // a different metric
    const state = derivePanelState(env, ["trending_momentum"]);
    expect(state.status).toBe("ready");
    expect(state.bannerText).toBeNull();
    expect(state.unavailable.has("trending_momentum")).toBe(false);
  });

  it("returns degraded when some but not all dependencies are missing", () => {
    const env = envelopeWithMissing(["trending_momentum"]);
    const state = derivePanelState(env, ["trending_momentum", "opportunity"]);
    expect(state.status).toBe("degraded");
    expect(state.bannerText).toMatch(/^Partial data:/);
    expect(state.bannerText).toMatch(/Trending-momentum/);
    expect(state.unavailable.has("trending_momentum")).toBe(true);
    expect(state.unavailable.has("opportunity")).toBe(false);
  });

  it("returns unavailable when every dependency is missing", () => {
    const env = envelopeWithMissing(["trending_momentum", "opportunity"]);
    const state = derivePanelState(env, ["trending_momentum", "opportunity"]);
    expect(state.status).toBe("unavailable");
    expect(state.bannerText).not.toMatch(/^Partial data:/);
    expect(state.bannerText).toMatch(/Trending-momentum/);
    expect(state.bannerText).toMatch(/opportunity/i);
    expect(state.unavailable.size).toBe(2);
  });

  it("banner composition is sorted deterministically by metric key", () => {
    // Two distinct orderings of the same missing set should produce the same banner.
    const env1 = envelopeWithMissing(["opportunity", "fragility", "trending_momentum"]);
    const env2 = envelopeWithMissing(["trending_momentum", "fragility", "opportunity"]);
    const deps: PanelMetricKey[] = ["trending_momentum", "opportunity", "fragility"];
    expect(derivePanelState(env1, deps).bannerText).toBe(derivePanelState(env2, deps).bannerText);
  });

  it("ignores missingFields not in the panel's dependsOn list", () => {
    const env = envelopeWithMissing(["trending_momentum", "ownership"]);
    const state = derivePanelState(env, ["opportunity"]);
    expect(state.status).toBe("ready");
    expect(state.unavailable.has("opportunity")).toBe(false);
  });
});

describe("asMetricSet", () => {
  it("filters arbitrary strings to known PanelMetricKey values only", () => {
    const set = asMetricSet(["trending_momentum", "totally_made_up", "fragility"]);
    expect(set.has("trending_momentum")).toBe(true);
    expect(set.has("fragility")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("returns empty set on empty input", () => {
    expect(asMetricSet([]).size).toBe(0);
  });
});
