import { describe, expect, it } from "vitest";
import { buildLeagueUniverse, buildFreeAgents } from "./buildUniverse";
import type { SourceMeta, PlayerMarketRecord } from "../governance";
import type { SleeperPlayersMap } from "../sleeper/schemas";
import type { FpEcrData } from "../fantasypros/types";

const SOURCE: SourceMeta = {
  source: "test",
  fetchedAt: new Date().toISOString(),
  ttlSeconds: 120,
  freshness: "fresh",
  confidence: 0.85,
  validation: "valid",
  missingFields: [],
  assumptions: [],
  failure: null
};

// Minimal valid FP payload (one player — enough to satisfy `.min(1)`; the
// universe count is driven by the Sleeper map, not FP matching).
const RANKINGS = {
  sport: "NFL",
  type: "ros",
  year: 2026,
  week: 0,
  position_id: "ALL",
  scoring: "PPR",
  count: 1,
  total_experts: 10,
  last_updated: "2026-06-01",
  players: [
    {
      player_name: "Some Player",
      player_team_id: "KC",
      player_position_id: "WR",
      rank_ecr: 1,
      rank_min: 1,
      rank_max: 3,
      rank_ave: 1.5,
      rank_std: 0.5
    }
  ]
} as unknown as FpEcrData;

const PLAYERS: SleeperPlayersMap = {
  "100": { position: "RB", team: "GB", active: true, fantasy_positions: ["RB"], first_name: "Aaron", last_name: "Back" } as never,
  "200": { position: "WR", team: "KC", active: true, fantasy_positions: ["WR"], first_name: "Wide", last_name: "Out" } as never,
  "300": { position: "P", team: "NE", active: true, fantasy_positions: ["P"], first_name: "Punter", last_name: "Guy" } as never, // non-fantasy
  "400": { position: "RB", team: "FA", active: false, fantasy_positions: ["RB"], first_name: "In", last_name: "Active" } as never // inactive
};

describe("buildLeagueUniverse", () => {
  it("keeps only active, fantasy-relevant players and keys them as sleeper:<id>", () => {
    const universe = buildLeagueUniverse(PLAYERS, RANKINGS, { rankingsSource: SOURCE });
    expect(universe).toHaveLength(2); // 100 + 200; punter + inactive dropped
    expect(universe.every((p) => p.id.startsWith("sleeper:"))).toBe(true);
    expect(universe.map((p) => p.id).sort()).toEqual(["sleeper:100", "sleeper:200"]);
  });
});

describe("buildFreeAgents", () => {
  it("subtracts the union of all rosters by id (the post-draft pool)", () => {
    const universe = buildLeagueUniverse(PLAYERS, RANKINGS, { rankingsSource: SOURCE });
    const rosterA: PlayerMarketRecord[] = [universe.find((p) => p.id === "sleeper:100")!];
    const free = buildFreeAgents(universe, [rosterA, []]);
    expect(free.map((p) => p.id)).toEqual(["sleeper:200"]);
  });

  it("REGRESSION: a rostered sleeper:<id> is excluded (ids share the Sleeper space)", () => {
    const universe = buildLeagueUniverse(PLAYERS, RANKINGS, { rankingsSource: SOURCE });
    const allRostered = universe.map((p) => [p]); // everyone rostered somewhere
    expect(buildFreeAgents(universe, allRostered)).toHaveLength(0);
  });

  it("returns the whole universe when no one is rostered (pre-draft)", () => {
    const universe = buildLeagueUniverse(PLAYERS, RANKINGS, { rankingsSource: SOURCE });
    expect(buildFreeAgents(universe, [[], []])).toHaveLength(universe.length);
  });
});
