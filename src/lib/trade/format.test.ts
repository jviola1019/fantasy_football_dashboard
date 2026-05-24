import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FORMAT, parseSleeperFormat, parseEspnFormat } from "./format";

const FIXTURE_DIR = join(__dirname, "fixtures");

describe("parseSleeperFormat", () => {
  it("reads PPR, team count, and 1QB from settings", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 10,
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]
    });
    expect(fmt.ppr).toBe(1);
    expect(fmt.numQbs).toBe(1);
    expect(fmt.numTeams).toBe(10);
    expect(fmt.scoringFormat).toBe("PPR");
    expect(fmt.rosterSize).toBe(8);
    expect(fmt.starters).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 0, K: 0, SUPERFLEX: 0 });
  });

  it("detects superflex as numQbs 2 and counts SUPERFLEX as a starter", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 12,
      scoring_settings: { rec: 0.5 },
      roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"]
    });
    expect(fmt.numQbs).toBe(2);
    expect(fmt.ppr).toBe(0.5);
    expect(fmt.scoringFormat).toBe("HALF");
    expect(fmt.starters.SUPERFLEX).toBe(1);
    expect(fmt.starters.QB).toBe(1);
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseSleeperFormat(null)).toEqual(DEFAULT_FORMAT);
  });

  it("extracts every audit field from a real 10-team PPR fixture", () => {
    // Captured from https://api.sleeper.app/v1/league/1265735061127311360 — a
    // real 2025-season Creamy Les Coot 4.0 league. Anchors the audit pipeline
    // against actual Sleeper output rather than synthetic fixtures.
    const fixture = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "sleeper-10team-ppr.json"), "utf8")
    );
    const fmt = parseSleeperFormat(fixture);

    expect(fmt.numTeams).toBe(10);
    expect(fmt.scoringFormat).toBe("PPR");
    expect(fmt.ppr).toBe(1);
    expect(fmt.numQbs).toBe(1);
    expect(fmt.rosterSize).toBe(15);
    expect(fmt.starters).toEqual({
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 2,
      DEF: 1,
      K: 1,
      SUPERFLEX: 0
    });
    expect(fmt.tradeDeadlineWeek).toBe(11);
    expect(fmt.playoffWeekStart).toBe(15);
    expect(fmt.playoffTeams).toBe(6);
  });

  it("returns null for missing audit fields without crashing", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 8,
      scoring_settings: { rec: 0 },
      roster_positions: ["QB", "RB", "BN"]
      // settings omitted entirely — every audit field should be null
    });
    expect(fmt.tradeDeadlineWeek).toBeNull();
    expect(fmt.playoffWeekStart).toBeNull();
    expect(fmt.playoffTeams).toBeNull();
    expect(fmt.scoringFormat).toBe("STD");
  });
});

describe("parseEspnFormat", () => {
  it("reads PPR and team count from minimal ESPN settings", () => {
    const fmt = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 0, "2": 2, "4": 2, "6": 1, "7": 1, "16": 1, "17": 1, "20": 6 } }
    });
    expect(fmt.ppr).toBe(1);
    expect(fmt.numQbs).toBe(1);
    expect(fmt.numTeams).toBe(12);
    expect(fmt.scoringFormat).toBe("PPR");
    expect(fmt.rosterSize).toBe(15); // sum of every slot count incl. bench
    expect(fmt.starters).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, SUPERFLEX: 0 });
  });

  it("derives tradeDeadlineWeek from deadlineDate and firstScoringPeriod", () => {
    // firstScoringPeriod 2025-09-04 (1756944000000 ms) → trade deadline
    // 2025-11-20 (1763596800000 ms) = ~77 days = 11 weeks.
    const fmt = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1 } },
      status: { firstScoringPeriod: 1756944000000 },
      tradeSettings: { deadlineDate: 1763596800000 }
    });
    expect(fmt.tradeDeadlineWeek).toBe(11);
  });

  it("derives playoffWeekStart from matchupPeriodCount", () => {
    const fmt = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 0 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1 } },
      scheduleSettings: { matchupPeriodCount: 14, playoffMatchupPeriodLength: 1 }
    });
    expect(fmt.playoffWeekStart).toBe(15);
    expect(fmt.scoringFormat).toBe("STD");
  });

  it("detects superflex via lineup slot 23", () => {
    const fmt = parseEspnFormat({
      size: 10,
      scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 1, "20": 5 } }
    });
    expect(fmt.numQbs).toBe(2);
    expect(fmt.starters.SUPERFLEX).toBe(1);
    expect(fmt.scoringFormat).toBe("HALF");
  });

  it("returns null audit fields when tradeSettings/scheduleSettings absent", () => {
    const fmt = parseEspnFormat({
      size: 8,
      scoringSettings: { scoringItems: [] },
      rosterSettings: { lineupSlotCounts: {} }
    });
    expect(fmt.tradeDeadlineWeek).toBeNull();
    expect(fmt.playoffWeekStart).toBeNull();
    expect(fmt.playoffTeams).toBeNull();
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseEspnFormat(undefined)).toEqual(DEFAULT_FORMAT);
  });

  it("reads playoffTeamCount from scheduleSettings or playoffSettings", () => {
    const fromSchedule = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [] },
      rosterSettings: { lineupSlotCounts: {} },
      scheduleSettings: { playoffTeamCount: 6 }
    });
    expect(fromSchedule.playoffTeams).toBe(6);

    const fromPlayoff = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [] },
      rosterSettings: { lineupSlotCounts: {} },
      playoffSettings: { playoffTeamCount: 4 }
    });
    expect(fromPlayoff.playoffTeams).toBe(4);
  });
});
