import { describe, it, expect } from "vitest";
import { resolveSleeperRosterId, resolveEspnTeam, extractSleeperFaabRatio } from "./fetchLive";

// ---------------------------------------------------------------------------
// resolveSleeperRosterId
// ---------------------------------------------------------------------------

const USERS = [
  { user_id: "u1", username: "alice", display_name: "Alice" },
  { user_id: "u2", username: "bob", display_name: "Bob" },
  { user_id: "u3", username: "charlie", display_name: null }
] as const;

const ROSTERS = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: "u3" }
] as const;

describe("resolveSleeperRosterId", () => {
  it("resolves by exact username match", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "alice")).toBe(1);
    expect(resolveSleeperRosterId(USERS, ROSTERS, "bob")).toBe(2);
  });

  it("resolves by display_name when username does not match", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "Alice")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "ALICE")).toBe(1);
    expect(resolveSleeperRosterId(USERS, ROSTERS, "BOB")).toBe(2);
  });

  it("returns null when username is null", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, null)).toBeNull();
  });

  it("returns null when username is empty string", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "")).toBeNull();
  });

  it("returns null when no user matches", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "dave")).toBeNull();
  });

  it("returns null when user has no roster (orphaned user_id)", () => {
    const usersWithExtra = [...USERS, { user_id: "u99", username: "orphan", display_name: "Orphan" }];
    expect(resolveSleeperRosterId(usersWithExtra, ROSTERS, "orphan")).toBeNull();
  });

  it("handles empty users array", () => {
    expect(resolveSleeperRosterId([], ROSTERS, "alice")).toBeNull();
  });

  it("handles empty rosters array", () => {
    expect(resolveSleeperRosterId(USERS, [], "alice")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveEspnTeam
// ---------------------------------------------------------------------------

type EspnTeamStub = {
  id: number;
  primaryOwner?: string | null;
  owners?: string[] | null;
};

const TEAMS: EspnTeamStub[] = [
  { id: 1, primaryOwner: "{AAA-0001}", owners: ["{AAA-0001}"] },
  { id: 2, primaryOwner: "{BBB-0002}", owners: ["{BBB-0002}"] },
  { id: 3, primaryOwner: null, owners: ["{CCC-0003}", "{DDD-0004}"] }
];

describe("resolveEspnTeam", () => {
  it("matches a braced SWID via primaryOwner", () => {
    const team = resolveEspnTeam(TEAMS, "{AAA-0001}");
    expect(team?.id).toBe(1);
  });

  it("matches a bare SWID (normalises to braced form)", () => {
    const team = resolveEspnTeam(TEAMS, "BBB-0002");
    expect(team?.id).toBe(2);
  });

  it("matches when SWID is in owners array but not primaryOwner", () => {
    const team = resolveEspnTeam(TEAMS, "{CCC-0003}");
    expect(team?.id).toBe(3);
  });

  it("matches secondary owner in owners array", () => {
    const team = resolveEspnTeam(TEAMS, "DDD-0004");
    expect(team?.id).toBe(3);
  });

  it("is case-insensitive (lowercase input vs uppercase stored)", () => {
    const team = resolveEspnTeam(TEAMS, "{aaa-0001}");
    expect(team?.id).toBe(1);
  });

  it("returns null when SWID is null", () => {
    expect(resolveEspnTeam(TEAMS, null)).toBeNull();
  });

  it("returns null when SWID does not match any team", () => {
    expect(resolveEspnTeam(TEAMS, "{ZZZ-9999}")).toBeNull();
  });

  it("returns null when teams array is empty", () => {
    expect(resolveEspnTeam([], "{AAA-0001}")).toBeNull();
  });

  it("handles teams with no owner fields gracefully", () => {
    const sparse: EspnTeamStub[] = [{ id: 9 }];
    expect(resolveEspnTeam(sparse, "{AAA-0001}")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractSleeperFaabRatio
// ---------------------------------------------------------------------------

describe("extractSleeperFaabRatio", () => {
  it("returns the correct ratio for a normal FAAB league", () => {
    // $100 budget, $40 spent → 0.60 remaining.
    expect(
      extractSleeperFaabRatio({ waiver_budget: 100 }, { waiver_budget_used: 40 })
    ).toBeCloseTo(0.6, 5);
  });

  it("returns 1.0 when waiver_budget_used is absent (Sleeper omits 0)", () => {
    // Sleeper drops `waiver_budget_used` for rosters that have spent nothing,
    // so treat absent as 0.
    expect(extractSleeperFaabRatio({ waiver_budget: 100 }, {})).toBe(1);
  });

  it("returns ~0 when the entire budget is spent", () => {
    expect(
      extractSleeperFaabRatio({ waiver_budget: 100 }, { waiver_budget_used: 100 })
    ).toBe(0);
  });

  it("returns null when waiver_budget is missing (non-FAAB league)", () => {
    expect(extractSleeperFaabRatio({}, { waiver_budget_used: 10 })).toBeNull();
  });

  it("returns null when waiver_budget is zero or negative", () => {
    expect(
      extractSleeperFaabRatio({ waiver_budget: 0 }, { waiver_budget_used: 0 })
    ).toBeNull();
    expect(
      extractSleeperFaabRatio({ waiver_budget: -10 }, { waiver_budget_used: 0 })
    ).toBeNull();
  });

  it("returns null when leagueSettings or rosterSettings is null/undefined", () => {
    expect(extractSleeperFaabRatio(null, { waiver_budget_used: 10 })).toBeNull();
    expect(extractSleeperFaabRatio({ waiver_budget: 100 }, null)).toBeNull();
    expect(extractSleeperFaabRatio(undefined, undefined)).toBeNull();
  });

  it("returns null when waiver_budget_used exceeds total (corrupted upstream)", () => {
    expect(
      extractSleeperFaabRatio({ waiver_budget: 100 }, { waiver_budget_used: 150 })
    ).toBeNull();
  });

  it("ignores non-numeric waiver_budget", () => {
    expect(
      extractSleeperFaabRatio({ waiver_budget: "100" }, { waiver_budget_used: 0 })
    ).toBeNull();
  });

  it("activates the lifecycle-rule threshold (< 0.1) for a depleted budget", () => {
    // $100 budget, $95 spent → 0.05 remaining — below the rule threshold.
    const ratio = extractSleeperFaabRatio(
      { waiver_budget: 100 },
      { waiver_budget_used: 95 }
    );
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeLessThan(0.1);
  });
});
