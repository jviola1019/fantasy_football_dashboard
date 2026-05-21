import { describe, it, expect } from "vitest";
import { interpretSleeperLeague } from "./verify";

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
