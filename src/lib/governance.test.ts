import { describe, expect, it } from "vitest";
import { RAEEnvelopeSchema, boundedCacheKey, evaluateFreshness, unavailableSource } from "./governance";
import { fixtureEnvelope } from "./fixtures";

describe("data governance", () => {
  it("validates explicitly labeled fixture envelopes", () => {
    const parsed = RAEEnvelopeSchema.parse(fixtureEnvelope());
    expect(parsed.mode).toBe("fixture");
    expect(parsed.sourceState.freshness).toBe("fixture");
  });

  it("detects stale and missing data", () => {
    const now = new Date("2026-05-13T00:10:00Z");
    expect(evaluateFreshness("2026-05-13T00:09:30Z", 60, now)).toBe("fresh");
    expect(evaluateFreshness("2026-05-13T00:00:00Z", 60, now)).toBe("stale");
    expect(evaluateFreshness(null, 60, now)).toBe("missing");
  });

  it("creates unavailable states without fabricated records", () => {
    const source = unavailableSource("test", "boom");
    expect(source.freshness).toBe("unavailable");
    expect(source.confidence).toBe(0);
  });

  it("normalizes bounded cache keys", () => {
    expect(boundedCacheKey("x", { b: 2, a: 1 })).toBe(boundedCacheKey("x", { a: 1, b: 2 }));
  });
});
