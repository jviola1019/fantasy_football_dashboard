import { describe, expect, it } from "vitest";
import { detectByeWeekRisks } from "./byes";
import type { VerifiedByeSchedule } from "../schedule/byeSchedule";
import type { PlayerMarketRecord } from "../governance";

function p(id: string, position: PlayerMarketRecord["position"], team: string, trueValue = 70): PlayerMarketRecord {
  return {
    id,
    name: id,
    position,
    team,
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: position,
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test"
  };
}

/**
 * A verified schedule fixture. Byes are chosen for the test, not transcribed
 * from any season — the point of F-002 is that real byes come from the live
 * schedule, so tests must never re-introduce a hardcoded season table.
 */
function schedule(byes: Record<string, number>, season = 2026): VerifiedByeSchedule {
  return {
    status: "verified",
    season,
    byes,
    regularSeasonWeeks: 18,
    provenance: {
      source: "test fixture",
      sourceUrl: "https://example.invalid/games.csv",
      retrievedAt: "2026-08-13T00:00:00.000Z",
      derivation: "test"
    }
  };
}

const BYES = schedule({ ATL: 5, GB: 5, BUF: 7, DAL: 10, WAS: 12, LAR: 11 });

describe("lifecycle/byes", () => {
  it("flags a position when half or more of its players share a bye", () => {
    const roster = [p("rb1", "RB", "ATL"), p("rb2", "RB", "GB"), p("rb3", "RB", "BUF")];
    const alerts = detectByeWeekRisks(roster, BYES);
    const week5 = alerts.find((a) => a.position === "RB" && a.week === 5);
    expect(week5).toBeDefined();
    expect(week5!.affectedPlayers).toHaveLength(2);
    expect(week5!.stacked).toBe(true);
  });

  it("does not flag a position when only one of three is on bye", () => {
    const roster = [p("rb1", "RB", "ATL"), p("rb2", "RB", "BUF"), p("rb3", "RB", "DAL")];
    expect(detectByeWeekRisks(roster, BYES).filter((a) => a.position === "RB")).toHaveLength(0);
  });

  it("emits one alert per (position, week)", () => {
    const roster = [
      p("rb1", "RB", "ATL"),
      p("rb2", "RB", "GB"),
      p("wr1", "WR", "ATL"),
      p("wr2", "WR", "GB")
    ];
    const alerts = detectByeWeekRisks(roster, BYES);
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((a) => a.position))).toEqual(new Set(["RB", "WR"]));
  });

  it("stamps every alert with the schedule's season", () => {
    const alerts = detectByeWeekRisks([p("rb1", "RB", "ATL"), p("rb2", "RB", "GB")], BYES);
    expect(alerts.every((a) => a.season === 2026)).toBe(true);
  });

  it("matches Washington from BOTH platforms — Sleeper 'WAS' and ESPN 'WSH'", () => {
    // Regression: the retired table keyed only "WSH", so Sleeper rosters (which
    // say "WAS") had their Washington players silently dropped from bye analysis.
    const sleeper = detectByeWeekRisks([p("a", "TE", "WAS"), p("b", "TE", "WAS")], BYES);
    const espn = detectByeWeekRisks([p("a", "TE", "WSH"), p("b", "TE", "WSH")], BYES);
    expect(sleeper[0]?.week).toBe(12);
    expect(espn[0]?.week).toBe(12);
  });

  it("matches the Rams whether the feed says 'LAR' or nflverse-style 'LA'", () => {
    const lar = detectByeWeekRisks([p("a", "WR", "LAR"), p("b", "WR", "LAR")], BYES);
    const la = detectByeWeekRisks([p("a", "WR", "LA"), p("b", "WR", "LA")], BYES);
    expect(lar[0]?.week).toBe(11);
    expect(la[0]?.week).toBe(11);
  });

  it("ignores players whose team has no entry in the schedule", () => {
    const alerts = detectByeWeekRisks([p("a", "QB", "ZZZ"), p("b", "QB", "ZZZ")], BYES);
    expect(alerts).toHaveLength(0);
  });

  it("uses the supplied season's byes, not any baked-in table", () => {
    // Same roster, two different seasons -> two different weeks. If a hardcoded
    // table ever creeps back in, this fails.
    const roster = [p("rb1", "RB", "ATL"), p("rb2", "RB", "ATL")];
    expect(detectByeWeekRisks(roster, schedule({ ATL: 5 }, 2025))[0]?.week).toBe(5);
    expect(detectByeWeekRisks(roster, schedule({ ATL: 11 }, 2026))[0]?.week).toBe(11);
  });
});
