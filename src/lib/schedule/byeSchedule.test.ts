import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveByeWeeks,
  describeByeUnavailability,
  fetchByeSchedule,
  NFL_TEAMS,
  parseScheduleCsv,
  type ByeProvenance,
  type ScheduleGame,
  type UnavailableByeSchedule
} from "./byeSchedule";

const PROV: ByeProvenance = {
  source: "test",
  sourceUrl: "https://example.invalid/games.csv",
  retrievedAt: "2026-08-13T00:00:00.000Z",
  derivation: "test"
};

const FIXTURE = readFileSync(
  new URL("./__fixtures__/nflverse-games-2025-2026.csv", import.meta.url),
  "utf8"
);

/**
 * Build a structurally valid season: 32 teams, 18 weeks, four teams on bye in
 * each of weeks 5-12, everyone else paired up. Yields 272 games, matching a real
 * NFL regular season.
 */
function buildValidSeason(season = 2026): ScheduleGame[] {
  const byeWeekByTeam = new Map<string, number>();
  NFL_TEAMS.forEach((team, i) => byeWeekByTeam.set(team, 5 + Math.floor(i / 4)));

  const games: ScheduleGame[] = [];
  for (let week = 1; week <= 18; week += 1) {
    const playing = NFL_TEAMS.filter((t) => byeWeekByTeam.get(t) !== week);
    for (let i = 0; i + 1 < playing.length; i += 2) {
      games.push({
        season,
        gameType: "REG",
        week,
        awayTeam: playing[i]!,
        homeTeam: playing[i + 1]!
      });
    }
  }
  return games;
}

describe("deriveByeWeeks — happy path", () => {
  it("derives exactly one bye per team for all 32 teams", () => {
    const result = deriveByeWeeks(buildValidSeason(), 2026, PROV);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(Object.keys(result.byes)).toHaveLength(32);
    expect(result.regularSeasonWeeks).toBe(18);
    for (const team of NFL_TEAMS) {
      expect(result.byes[team], team).toBeGreaterThanOrEqual(1);
      expect(result.byes[team], team).toBeLessThanOrEqual(18);
    }
  });

  it("carries provenance through so notifications can record it", () => {
    const result = deriveByeWeeks(buildValidSeason(), 2026, PROV);
    expect(result.provenance).toMatchObject({ source: "test", retrievedAt: PROV.retrievedAt });
  });
});

describe("deriveByeWeeks — fails closed", () => {
  it("rejects an empty schedule as not-yet-published", () => {
    const r = deriveByeWeeks([], 2027, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("schedule-not-published");
  });

  it("rejects a schedule missing a team", () => {
    const games = buildValidSeason().filter((g) => g.awayTeam !== "SEA" && g.homeTeam !== "SEA");
    const r = deriveByeWeeks(games, 2026, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("incomplete-coverage");
    expect(r.detail).toContain("SEA");
  });

  it("rejects a team with TWO off weeks (partial schedule)", () => {
    // Drop every week-3 game for BUF: it now has byes in both week 3 and its real one.
    const games = buildValidSeason().filter(
      (g) => !(g.week === 3 && (g.awayTeam === "BUF" || g.homeTeam === "BUF"))
    );
    const r = deriveByeWeeks(games, 2026, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("incomplete-coverage");
    expect(r.detail).toContain("BUF");
  });

  it("rejects a team with ZERO off weeks (duplicate/extra game)", () => {
    const games = buildValidSeason();
    // KC is index 15 of NFL_TEAMS, so its synthetic bye is week 5 + floor(15/4) = 8.
    // DEN (index 9) byes in week 7, so it is available to play that week.
    games.push({ season: 2026, gameType: "REG", week: 8, awayTeam: "KC", homeTeam: "DEN" });
    const r = deriveByeWeeks(games, 2026, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("incomplete-coverage");
  });

  it("rejects an unrecognised team abbreviation", () => {
    const games = buildValidSeason();
    games.push({ season: 2026, gameType: "REG", week: 2, awayTeam: "XXX", homeTeam: "KC" });
    const r = deriveByeWeeks(games, 2026, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("incomplete-coverage");
    expect(r.detail).toContain("XXX");
  });

  it("rejects an out-of-range season length", () => {
    const games = buildValidSeason().filter((g) => g.week <= 10);
    const r = deriveByeWeeks(games, 2026, PROV) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("invalid-week");
  });
});

describe("parseScheduleCsv", () => {
  it("selects only REG rows for the requested season", () => {
    const g2026 = parseScheduleCsv(FIXTURE, 2026);
    const g2025 = parseScheduleCsv(FIXTURE, 2025);
    expect(g2026).toHaveLength(272);
    expect(g2025).toHaveLength(272);
    expect(g2026.every((g) => g.season === 2026)).toBe(true);
  });

  it("returns nothing for a season that is not in the file", () => {
    expect(parseScheduleCsv(FIXTURE, 2031)).toEqual([]);
  });

  it("normalizes nflverse team codes (LA -> LAR)", () => {
    const csv = [
      "season,game_type,week,away_team,home_team",
      "2026,REG,1,LA,WAS"
    ].join("\n");
    const games = parseScheduleCsv(csv, 2026);
    expect(games[0]).toMatchObject({ awayTeam: "LAR", homeTeam: "WAS" });
  });

  it("resolves columns by header name, not position", () => {
    const csv = [
      "home_team,week,away_team,game_type,season",
      "KC,3,DEN,REG,2026"
    ].join("\n");
    expect(parseScheduleCsv(csv, 2026)[0]).toMatchObject({
      week: 3,
      awayTeam: "DEN",
      homeTeam: "KC"
    });
  });

  it("returns nothing when required headers are absent", () => {
    expect(parseScheduleCsv("a,b,c\n1,2,3", 2026)).toEqual([]);
  });
});

describe("real nflverse data (regression fixture)", () => {
  it("derives a fully verified 2026 schedule", () => {
    const result = deriveByeWeeks(parseScheduleCsv(FIXTURE, 2026), 2026, PROV);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(Object.keys(result.byes)).toHaveLength(32);
    // Spot-check values derived from the published 2026 schedule.
    expect(result.byes.KC).toBe(5);
    expect(result.byes.BUF).toBe(7);
    expect(result.byes.WAS).toBe(7);
    expect(result.byes.LAR).toBe(11);
  });

  it("derives 2025 and proves the retired hardcoded table was WRONG for WAS", () => {
    const result = deriveByeWeeks(parseScheduleCsv(FIXTURE, 2025), 2025, PROV);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    // The deleted BYE_WEEKS_2025 claimed WSH: 14. The actual 2025 bye was week 12.
    // This is why a transcribed table is not an acceptable source.
    expect(result.byes.WAS).toBe(12);
    expect(result.byes.WAS).not.toBe(14);
  });

  it("produces DIFFERENT byes for 2026 than 2025, so using the stale table would misfire", () => {
    const y2025 = deriveByeWeeks(parseScheduleCsv(FIXTURE, 2025), 2025, PROV);
    const y2026 = deriveByeWeeks(parseScheduleCsv(FIXTURE, 2026), 2026, PROV);
    if (y2025.status !== "verified" || y2026.status !== "verified") throw new Error("fixture broken");
    const changed = NFL_TEAMS.filter((t) => y2025.byes[t] !== y2026.byes[t]);
    expect(changed.length).toBeGreaterThan(25);
  });
});

describe("fetchByeSchedule — transport failures all fail closed", () => {
  const okCsv = (body: string) =>
    ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

  it("returns source-unavailable on a non-OK response", async () => {
    const r = (await fetchByeSchedule(2026, async () =>
      ({ ok: false, status: 503, text: async () => "" }) as unknown as Response
    )) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("source-unavailable");
    expect(r.detail).toContain("503");
  });

  it("returns source-unavailable when the fetch throws", async () => {
    const r = (await fetchByeSchedule(2026, async () => {
      throw new Error("ECONNRESET");
    })) as UnavailableByeSchedule;
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("source-unavailable");
    expect(r.detail).toContain("ECONNRESET");
  });

  it("distinguishes an unreadable file from a season that is not out yet", async () => {
    const garbage = (await fetchByeSchedule(2026, async () =>
      okCsv("total,nonsense\n1,2")
    )) as UnavailableByeSchedule;
    expect(garbage.reason).toBe("source-unparseable");

    const future = (await fetchByeSchedule(2031, async () => okCsv(FIXTURE))) as UnavailableByeSchedule;
    expect(future.reason).toBe("schedule-not-published");
  });

  it("succeeds end-to-end on well-formed data", async () => {
    const r = await fetchByeSchedule(2026, async () => okCsv(FIXTURE));
    expect(r.status).toBe("verified");
  });

  it("never returns a fallback table on failure", async () => {
    const r = await fetchByeSchedule(2026, async () => {
      throw new Error("down");
    });
    expect(r).not.toHaveProperty("byes");
  });
});

describe("describeByeUnavailability", () => {
  it("explains every failure reason without leaking internals", () => {
    const reasons = [
      "season-unresolved",
      "source-unavailable",
      "source-unparseable",
      "schedule-not-published",
      "incomplete-coverage",
      "invalid-week",
      "season-mismatch"
    ] as const;
    for (const reason of reasons) {
      const msg = describeByeUnavailability({
        status: "unavailable",
        season: 2026,
        reason,
        detail: "internal detail",
        provenance: {}
      });
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain("internal detail");
    }
  });
});
