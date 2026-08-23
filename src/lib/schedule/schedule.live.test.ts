import { describe, expect, it } from "vitest";
import { getCurrentNflSeason } from "./season";
import { fetchByeSchedule, NFL_TEAMS } from "./byeSchedule";

/**
 * Live-network integration for the F-002 replacement path. Gated behind
 * RAE_LIVE_TESTS=1 like the other .live tests so CI stays offline and
 * deterministic. Run locally with:
 *   RAE_LIVE_TESTS=1 npx vitest run src/lib/schedule/schedule.live.test.ts
 *
 * This is the test that proves the fix works against the real world rather than
 * against a fixture — the fixture could itself be wrong.
 */
const live = process.env.RAE_LIVE_TESTS === "1" ? describe : describe.skip;

live("schedule (live network)", () => {
  it("resolves the current NFL season from Sleeper", async () => {
    const state = await getCurrentNflSeason();
    expect(state).not.toBeNull();
    expect(state!.season).toBeGreaterThanOrEqual(2026);
    expect(["pre", "regular", "post", "off"]).toContain(state!.phase);
  }, 30_000);

  it("derives a fully verified bye schedule for the live season", async () => {
    const state = await getCurrentNflSeason();
    if (!state) throw new Error("could not resolve season");
    const schedule = await fetchByeSchedule(state.season);

    // Fail-closed is correct behavior in the spring before a schedule drops, so
    // only assert full verification once the league has published it.
    if (schedule.status === "unavailable") {
      expect(schedule.reason).toBe("schedule-not-published");
      return;
    }

    expect(Object.keys(schedule.byes)).toHaveLength(32);
    for (const team of NFL_TEAMS) {
      const week = schedule.byes[team];
      expect(week, `${team} bye`).toBeGreaterThanOrEqual(1);
      expect(week, `${team} bye`).toBeLessThanOrEqual(schedule.regularSeasonWeeks);
    }
    expect(schedule.provenance.sourceUrl).toContain("nflverse");
  }, 60_000);
});
