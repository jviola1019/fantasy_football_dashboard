import { describe, expect, it } from "vitest";
import { loadRAEEnvelope } from "./sleeper";
import {
  getLeague,
  getRosters,
  getDraftPicks
} from "./sleeper";

describe("Sleeper adapter boundary", () => {
  it("returns missing production metrics instead of fabricating market records", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          one: { player_id: "one", full_name: "Test Player", position: "WR", team: "TST", active: true }
        }),
        { status: 200 }
      );
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

  it("fetches a league and parses the envelope shape", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          league_id: "abc",
          name: "Test",
          season: "2026",
          sport: "nfl",
          total_rosters: 12
        }),
        { status: 200 }
      );
    const result = await getLeague("abc", fetcher);
    expect(result.source.validation).toBe("valid");
    expect(result.data?.league_id).toBe("abc");
  });

  it("returns unavailable source on 404", async () => {
    const fetcher = async () => new Response("not found", { status: 404 });
    const result = await getRosters("missing", fetcher);
    expect(result.data).toBeNull();
    expect(result.source.freshness).toBe("unavailable");
  });

  it("parses draft picks", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify([
          { player_id: "12", picked_by: "u1", roster_id: 1, round: 1, draft_slot: 1, pick_no: 1 }
        ]),
        { status: 200 }
      );
    const result = await getDraftPicks("d1", fetcher);
    expect(result.data?.[0]?.player_id).toBe("12");
  });
});
