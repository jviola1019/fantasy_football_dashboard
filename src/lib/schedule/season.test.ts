import { describe, expect, it } from "vitest";
import { classifySeasonPhase, getCurrentNflSeason } from "./season";

/** Minimal Sleeper /v1/state/nfl responder. */
function stateFetcher(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      headers: new Headers(),
      json: async () => body
    }) as unknown as Response) as unknown as typeof fetch;
}

const REAL_PRESEASON_2026 = {
  week: 1,
  leg: 0,
  season: "2026",
  season_type: "pre",
  league_season: "2026",
  previous_season: "2025",
  season_start_date: "2026-08-06",
  display_week: 1
};

describe("classifySeasonPhase", () => {
  it("maps every Sleeper season_type value", () => {
    expect(classifySeasonPhase("pre")).toBe("pre");
    expect(classifySeasonPhase("regular")).toBe("regular");
    expect(classifySeasonPhase("post")).toBe("post");
    expect(classifySeasonPhase("off")).toBe("off");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifySeasonPhase("  REGULAR ")).toBe("regular");
    expect(classifySeasonPhase("PreSeason")).toBe("pre");
  });

  it("returns 'unknown' rather than guessing on an unexpected value", () => {
    expect(classifySeasonPhase("playoffs")).toBe("unknown");
    expect(classifySeasonPhase(null)).toBe("unknown");
    expect(classifySeasonPhase(undefined)).toBe("unknown");
  });
});

describe("getCurrentNflSeason", () => {
  it("resolves the live 2026 preseason payload (the state at audit time)", async () => {
    const s = await getCurrentNflSeason(stateFetcher(REAL_PRESEASON_2026));
    expect(s).not.toBeNull();
    expect(s!.season).toBe(2026);
    expect(s!.phase).toBe("pre");
    // Week 1 of the PRESEASON must never be mistaken for regular-season week 1.
    expect(s!.week).toBe(1);
    expect(s!.isRegularSeason).toBe(false);
  });

  it("marks regular season only when games are actually being played", async () => {
    const reg = await getCurrentNflSeason(
      stateFetcher({ ...REAL_PRESEASON_2026, season_type: "regular", week: 4 })
    );
    expect(reg!.isRegularSeason).toBe(true);
    expect(reg!.week).toBe(4);

    const week0 = await getCurrentNflSeason(
      stateFetcher({ ...REAL_PRESEASON_2026, season_type: "regular", week: 0 })
    );
    expect(week0!.isRegularSeason).toBe(false);
  });

  it("handles the postseason and offseason without claiming a regular-season week", async () => {
    const post = await getCurrentNflSeason(
      stateFetcher({ ...REAL_PRESEASON_2026, season_type: "post", week: 19 })
    );
    expect(post!.phase).toBe("post");
    expect(post!.isRegularSeason).toBe(false);

    const off = await getCurrentNflSeason(
      stateFetcher({ ...REAL_PRESEASON_2026, season_type: "off", week: 0 })
    );
    expect(off!.phase).toBe("off");
    expect(off!.isRegularSeason).toBe(false);
  });

  it("reports the NFL season, not the calendar year, across the January rollover", async () => {
    // In Jan 2027 the 2026 season is still in its postseason. A wall-clock
    // getFullYear() would say 2027 and look up a schedule that does not exist —
    // the exact bug this module replaces.
    const s = await getCurrentNflSeason(
      stateFetcher({ ...REAL_PRESEASON_2026, season: "2026", season_type: "post", week: 20 }),
      () => new Date("2027-01-15T12:00:00Z")
    );
    expect(s!.season).toBe(2026);
    expect(s!.retrievedAt).toBe("2027-01-15T12:00:00.000Z");
  });

  it("returns null when the upstream is unreachable", async () => {
    const thrower = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await getCurrentNflSeason(thrower)).toBeNull();
  });

  it("returns null on an HTTP error rather than inventing a season", async () => {
    expect(await getCurrentNflSeason(stateFetcher({}, false))).toBeNull();
  });

  it("rejects a malformed or out-of-range season instead of propagating NaN", async () => {
    expect(await getCurrentNflSeason(stateFetcher({ ...REAL_PRESEASON_2026, season: "not-a-year" }))).toBeNull();
    expect(await getCurrentNflSeason(stateFetcher({ ...REAL_PRESEASON_2026, season: "1850" }))).toBeNull();
  });
});
