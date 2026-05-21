import { describe, it, expect } from "vitest";
import { DEFAULT_FORMAT, parseSleeperFormat, parseEspnFormat } from "./format";

describe("parseSleeperFormat", () => {
  it("reads PPR, team count, and 1QB from settings", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 10,
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]
    });
    expect(fmt).toEqual({ ppr: 1, numQbs: 1, numTeams: 10 });
  });

  it("detects superflex as numQbs 2", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 12,
      scoring_settings: { rec: 0.5 },
      roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"]
    });
    expect(fmt).toEqual({ ppr: 0.5, numQbs: 2, numTeams: 12 });
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseSleeperFormat(null)).toEqual(DEFAULT_FORMAT);
  });
});

describe("parseEspnFormat", () => {
  it("reads PPR and team count from ESPN settings", () => {
    const fmt = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 0 } }
    });
    expect(fmt).toEqual({ ppr: 1, numQbs: 1, numTeams: 12 });
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseEspnFormat(undefined)).toEqual(DEFAULT_FORMAT);
  });
});
