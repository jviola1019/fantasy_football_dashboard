import { describe, expect, it } from "vitest";
import { EspnClient } from "./espn/client";
import { getLeague } from "./espn/league";
import { espnPlayerToRecord } from "./normalize";
import { unavailableSource } from "./governance";

describe("ESPN client and league adapter", () => {
  it("builds the modern season league URL with views", () => {
    const client = new EspnClient();
    const url = client.leagueUrl(2026, "12345", ["mTeam", "mRoster"]);
    expect(url).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/12345?view=mTeam&view=mRoster"
    );
  });

  it("uses the leagueHistory path for pre-2018 seasons", () => {
    const client = new EspnClient();
    const url = client.leagueUrl(2017, "999");
    expect(url).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/999?seasonId=2017"
    );
    const withViews = client.leagueUrl(2017, "999", ["mTeam"]);
    expect(withViews).toContain("&view=mTeam");
  });

  it("formats cookies and braces SWID", () => {
    const client = new EspnClient({ credentials: { espnS2: "abc", swid: "AAA-BBB" } });
    expect(client.cookieHeader()).toBe("espn_s2=abc; SWID={AAA-BBB}");
    const braced = new EspnClient({ credentials: { espnS2: "x", swid: "{X}" } });
    expect(braced.cookieHeader()).toBe("espn_s2=x; SWID={X}");
  });

  it("parses a minimal league response", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          id: 12345,
          seasonId: 2026,
          teams: [
            {
              id: 1,
              abbrev: "TEAM",
              location: "City",
              nickname: "Name",
              roster: {
                entries: [
                  {
                    playerId: 4362887,
                    lineupSlotId: 4,
                    playerPoolEntry: {
                      player: {
                        id: 4362887,
                        fullName: "Test WR",
                        defaultPositionId: 3,
                        proTeamId: 14
                      }
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    const client = new EspnClient({ fetcher });
    const result = await getLeague(client, { leagueId: "12345", season: 2026 }, ["mTeam", "mRoster"]);
    expect(result.source.validation).toBe("valid");
    expect(result.data?.teams?.[0]?.roster?.entries?.[0]?.playerPoolEntry?.player.fullName).toBe("Test WR");
  });

  it("normalizes an ESPN player to a PlayerMarketRecord without fabricating market metrics", () => {
    const source = unavailableSource("ESPN", "test");
    const record = espnPlayerToRecord(
      { id: 4362887, fullName: "Test WR", defaultPositionId: 3, proTeamId: 14 },
      { source }
    );
    expect(record).not.toBeNull();
    expect(record?.position).toBe("WR");
    expect(record?.team).toBe("LAR");
    expect(record?.perceivedValue).toBe(0);
    expect(record?.trueValue).toBe(0);
    expect(record?.sources[0]?.missingFields).toContain("market_value");
    expect(record?.imageUrl).toContain("a.espncdn.com");
  });

  it("returns unavailable envelope on 401", async () => {
    const fetcher = async () => new Response("unauth", { status: 401 });
    const client = new EspnClient({ credentials: { espnS2: "bad", swid: "bad" }, fetcher });
    const result = await getLeague(client, { leagueId: "x", season: 2026 });
    expect(result.data).toBeNull();
    expect(result.source.freshness).toBe("unavailable");
  });
});
