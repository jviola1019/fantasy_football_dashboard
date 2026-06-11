import { describe, expect, it } from "vitest";
import { buildLeagueUniverse, buildFreeAgents, UNIVERSE_LIMIT } from "./buildUniverse";
import type { SourceMeta, PlayerMarketRecord } from "../governance";

describe("free-agent capping order (DAT-01)", () => {
  const rec = (id: string, trueValue: number) =>
    ({ id, trueValue }) as unknown as PlayerMarketRecord;

  it("UNIVERSE_LIMIT is the single shared cap", () => {
    expect(UNIVERSE_LIMIT).toBe(600);
  });

  it("capping AFTER subtraction keeps a deep unrostered player; capping BEFORE loses it", () => {
    // Full universe by value desc; the two highest are rostered.
    const full = [rec("sleeper:1", 100), rec("sleeper:2", 90), rec("sleeper:3", 80), rec("sleeper:4", 70)];
    const rosters = [[rec("sleeper:1", 100), rec("sleeper:2", 90)]];
    const CAP = 2;

    // OLD (buggy): cap the universe first, then subtract → both survivors are
    // rostered, so zero free agents even though 3 and 4 are available.
    const buggy = buildFreeAgents(full.slice(0, CAP), rosters);
    expect(buggy).toHaveLength(0);

    // NEW (fixed): subtract from the full universe, THEN cap.
    const fixed = buildFreeAgents(full, rosters).slice(0, CAP);
    expect(fixed.map((p) => p.id)).toEqual(["sleeper:3", "sleeper:4"]);
  });
});
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
