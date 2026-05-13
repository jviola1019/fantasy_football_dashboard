import { describe, expect, it } from "vitest";
import { loadRAEEnvelope } from "./sleeper";

describe("Sleeper adapter boundary", () => {
  it("returns missing production metrics instead of fabricating market records", async () => {
    const fetcher = async () => new Response(JSON.stringify({ one: { player_id: "one", full_name: "Test Player", position: "WR", team: "TST", active: true } }), { status: 200 });
    const envelope = await loadRAEEnvelope({ fetcher });
    expect(envelope.mode).toBe("unavailable");
    expect(envelope.records).toHaveLength(0);
    expect(envelope.sourceState.missingFields).toContain("market_value");
  });

  it("can opt into explicitly labeled fixtures for development", async () => {
    const fetcher = async () => new Response("{}", { status: 503 });
    const envelope = await loadRAEEnvelope({ allowFixtures: true, fetcher });
    expect(envelope.mode).toBe("fixture");
    expect(envelope.sourceState.source).toContain("fixture");
  });
});
