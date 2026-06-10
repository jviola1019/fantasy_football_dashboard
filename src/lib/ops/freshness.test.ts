import { describe, it, expect } from "vitest";
import { evaluateFreshness, type FreshnessContract } from "./freshness";

const contract: FreshnessContract = {
  source: "players",
  warnAfterSeconds: 24 * 3600,
  expireAfterSeconds: 30 * 3600,
};
const now = new Date("2026-06-10T12:00:00Z");

function ago(hoursAgo: number): Date {
  return new Date(now.getTime() - hoursAgo * 3600 * 1000);
}

describe("evaluateFreshness", () => {
  it("is fresh within the warn window", () => {
    const r = evaluateFreshness(contract, ago(2), now);
    expect(r.verdict).toBe("fresh");
    expect(r.ok).toBe(true);
  });

  it("is stale (non-fatal) past warn but before expire", () => {
    const r = evaluateFreshness(contract, ago(26), now);
    expect(r.verdict).toBe("stale");
    expect(r.ok).toBe(true);
  });

  it("is expired (fatal) past the expire window", () => {
    const r = evaluateFreshness(contract, ago(31), now);
    expect(r.verdict).toBe("expired");
    expect(r.ok).toBe(false);
  });

  it("is missing (fatal) when there is no snapshot", () => {
    const r = evaluateFreshness(contract, null, now);
    expect(r.verdict).toBe("missing");
    expect(r.ok).toBe(false);
    expect(r.ageSeconds).toBeNull();
  });

  it("treats an unparseable timestamp as missing", () => {
    const r = evaluateFreshness(contract, "not-a-date", now);
    expect(r.verdict).toBe("missing");
    expect(r.ok).toBe(false);
  });

  it("accepts an ISO string and clamps negative ages to 0", () => {
    const future = new Date(now.getTime() + 3600 * 1000).toISOString();
    const r = evaluateFreshness(contract, future, now);
    expect(r.ageSeconds).toBe(0);
    expect(r.verdict).toBe("fresh");
  });
});
