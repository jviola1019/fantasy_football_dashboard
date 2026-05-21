import { describe, it, expect } from "vitest";
import { fetchTradeValues } from "./values";
import { DEFAULT_FORMAT } from "./format";

const live = process.env.RAE_LIVE_TESTS === "1";

describe.skipIf(!live)("FantasyCalc live", () => {
  it("returns a non-empty value map for the default format", async () => {
    const data = await fetchTradeValues(DEFAULT_FORMAT);
    expect(data.source.freshness).toBe("fresh");
    expect(data.values.size).toBeGreaterThan(100);
  }, 20_000);
});
