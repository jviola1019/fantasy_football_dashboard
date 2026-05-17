import { describe, expect, it } from "vitest";
import { loadRAEEnvelope } from "./sleeper";

describe("Sleeper adapter boundary", () => {
  it("derives estimated market metrics with disclosed missing fields and 0.35 confidence", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          one: {
            player_id: "one",
            full_name: "Test Player",
            position: "WR",
            team: "TST",
            active: true,
            depth_chart_order: 1,
            years_exp: 2,
            age: 24,
          },
        }),
        { status: 200 }
      );
    const envelope = await loadRAEEnvelope({ fetcher });
    expect(envelope.mode).toBe("live");
    expect(envelope.records).toHaveLength(1);
    expect(envelope.records[0]!.confidence).toBe(0.35);
    expect(envelope.sourceState.missingFields).toContain("market_value");
    expect(envelope.sourceState.ttlSeconds).toBe(0);
    expect(envelope.sourceState.assumptions.join(" ")).toContain("no edge cache");
  });

  it("falls back to unavailable mode when the response contains no fantasy-relevant players", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          ol: { player_id: "ol", full_name: "Tackle", position: "OL", team: "TST", active: true },
        }),
        { status: 200 }
      );
    const envelope = await loadRAEEnvelope({ fetcher });
    expect(envelope.mode).toBe("unavailable");
    expect(envelope.records).toHaveLength(0);
    expect(envelope.sourceState.missingFields).toContain("market_value");
  });

  it("loads K and DEF positions as fantasy-relevant", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          k: { player_id: "k1", full_name: "Test Kicker", position: "K", team: "TST", active: true, depth_chart_order: 1 },
          def: { player_id: "BAL", full_name: "Ravens", position: "DEF", team: "BAL", active: true },
        }),
        { status: 200 }
      );
    const envelope = await loadRAEEnvelope({ fetcher });
    expect(envelope.mode).toBe("live");
    expect(envelope.records).toHaveLength(2);
    const positions = new Set(envelope.records.map((r) => r.position));
    expect(positions.has("K")).toBe(true);
    expect(positions.has("DEF")).toBe(true);
  });

  it("can opt into explicitly labeled fixtures for development", async () => {
    const fetcher = async () => new Response("{}", { status: 503 });
    const envelope = await loadRAEEnvelope({ allowFixtures: true, fetcher });
    expect(envelope.mode).toBe("fixture");
    expect(envelope.sourceState.source).toContain("fixture");
  });
});
