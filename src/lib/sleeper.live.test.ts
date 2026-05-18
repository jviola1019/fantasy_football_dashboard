import { describe, expect, it } from "vitest";
import { getNflState, getLeague, getRosters, getLeagueUsers } from "./sleeper";

const RUN = process.env.RAE_LIVE_TESTS === "1";
const LEAGUE = process.env.RAE_LIVE_SLEEPER_LEAGUE_ID ?? "";

const d = RUN ? describe : describe.skip;

d("Sleeper live round-trip", () => {
  it("fetches /v1/state/nfl", async () => {
    const result = await getNflState();
    expect(result.source.validation).toBe("valid");
    expect(result.data?.season).toBeTruthy();
  }, 15_000);

  it("fetches a real league when RAE_LIVE_SLEEPER_LEAGUE_ID is set", async () => {
    if (!LEAGUE) return;
    const [league, rosters, users] = await Promise.all([
      getLeague(LEAGUE),
      getRosters(LEAGUE),
      getLeagueUsers(LEAGUE)
    ]);
    expect(league.data?.league_id).toBe(LEAGUE);
    expect(rosters.data?.length ?? 0).toBeGreaterThan(0);
    expect(users.data?.length ?? 0).toBeGreaterThan(0);
  }, 30_000);
});
