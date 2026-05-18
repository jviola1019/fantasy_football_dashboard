import { describe, expect, it } from "vitest";
import { EspnClient } from "./espn/client";
import { getLeague } from "./espn/league";

const RUN = process.env.RAE_LIVE_TESTS === "1";
const S2 = process.env.ESPN_S2 ?? "";
const SWID = process.env.ESPN_SWID ?? "";
const LEAGUE_ID = process.env.ESPN_LEAGUE_ID ?? "";
const SEASON = Number.parseInt(process.env.ESPN_SEASON ?? "2026", 10);

const d = RUN && S2 && SWID && LEAGUE_ID ? describe : describe.skip;

d("ESPN live round-trip (requires ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID)", () => {
  it("fetches a real league with rosters", async () => {
    const client = new EspnClient({ credentials: { espnS2: S2, swid: SWID } });
    const result = await getLeague(client, { leagueId: LEAGUE_ID, season: SEASON }, ["mTeam", "mRoster", "mSettings"]);
    expect(result.source.validation).toBe("valid");
    expect(result.data?.teams?.length ?? 0).toBeGreaterThan(0);
    const entries = result.data?.teams?.[0]?.roster?.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);
  }, 30_000);
});
