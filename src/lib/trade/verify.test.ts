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
    expect(result).toEqual({
      ok: true,
      format: { ppr: 1, numQbs: 1, numTeams: 12 },
      resolvedLabel: "Dynasty Warriors"
    });
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
    expect(result).toEqual({
      ok: true,
      format: { ppr: 1, numQbs: 1, numTeams: 12 },
      resolvedLabel: "Gridiron Kings"
    });
  });

  it("returns an error when the settings payload is null", () => {
    expect(interpretEspnLeague(null)).toEqual({
      ok: false,
      error: "ESPN league not reachable. Check the league ID and cookies."
    });
  });
});
