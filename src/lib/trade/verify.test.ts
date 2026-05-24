import { describe, it, expect } from "vitest";
import { interpretSleeperLeague, interpretEspnLeague } from "./verify";

describe("interpretSleeperLeague", () => {
  it("returns ok with parsed format for a valid league", () => {
    const result = interpretSleeperLeague({
      name: "Dynasty Warriors",
      total_rosters: 12,
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "WR", "TE", "BN"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedLabel).toBe("Dynasty Warriors");
      // Core slim shape preserved
      expect(result.format.ppr).toBe(1);
      expect(result.format.numQbs).toBe(1);
      expect(result.format.numTeams).toBe(12);
      // Audit fields added by the extended LeagueFormat
      expect(result.format.scoringFormat).toBe("PPR");
      expect(result.format.rosterSize).toBe(5);
      expect(result.format.starters).toEqual({
        QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0
      });
      expect(result.format.tradeDeadlineWeek).toBeNull();
      expect(result.format.playoffWeekStart).toBeNull();
      expect(result.format.playoffTeams).toBeNull();
    }
  });

  it("returns an error when the league payload is empty", () => {
    expect(interpretSleeperLeague(null)).toEqual({
      ok: false,
      error: "League not found on Sleeper. Check the league ID and season."
    });
  });
});

describe("interpretEspnLeague", () => {
  it("returns ok with parsed format for a valid ESPN settings object", () => {
    const result = interpretEspnLeague({
      name: "Gridiron Kings",
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 0 } }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedLabel).toBe("Gridiron Kings");
      expect(result.format.ppr).toBe(1);
      expect(result.format.numQbs).toBe(1);
      expect(result.format.numTeams).toBe(12);
      expect(result.format.scoringFormat).toBe("PPR");
      expect(result.format.rosterSize).toBe(1);
      expect(result.format.starters.QB).toBe(1);
      expect(result.format.starters.SUPERFLEX).toBe(0);
      expect(result.format.tradeDeadlineWeek).toBeNull();
      expect(result.format.playoffWeekStart).toBeNull();
      expect(result.format.playoffTeams).toBeNull();
    }
  });

  it("returns an error when the settings payload is null", () => {
    expect(interpretEspnLeague(null)).toEqual({
      ok: false,
      error: "ESPN league not reachable. Check the league ID and cookies."
    });
  });
});
