import { describe, it, expect } from "vitest";
import {
  extractSleeperFaabBudget,
  extractEspnFaabBudget,
  buildSleeperFaabState,
  buildEspnFaabState,
  myFaabBudget
} from "./faab";

// ---------------------------------------------------------------------------
// extractSleeperFaabBudget
//
// Moved here from fetchLive.test.ts in S4 when the return type changed from a
// bare ratio to { total, remaining, ratio }. Every null case below is carried
// over unchanged — the validation is the part that must not regress.
// ---------------------------------------------------------------------------

describe("extractSleeperFaabBudget", () => {
  it("returns dollars AND the ratio for a normal FAAB league", () => {
    // $100 budget, $40 spent -> $60 remaining, 0.60.
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 40 })).toEqual({
      total: 100,
      remaining: 60,
      ratio: 0.6
    });
  });

  it("treats an absent waiver_budget_used as 0 (Sleeper omits it)", () => {
    // Sleeper drops `waiver_budget_used` for rosters that have spent nothing.
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, {})).toEqual({
      total: 100,
      remaining: 100,
      ratio: 1
    });
  });

  it("returns 0 remaining when the entire budget is spent", () => {
    const b = extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 100 });
    expect(b).toEqual({ total: 100, remaining: 0, ratio: 0 });
  });

  it("returns null when waiver_budget is missing (non-FAAB league)", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2 }, { waiver_budget_used: 10 })).toBeNull();
  });

  it("returns null when waiver_budget is zero or negative", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 0 }, { waiver_budget_used: 0 })).toBeNull();
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: -10 }, { waiver_budget_used: 0 })).toBeNull();
  });

  it("returns null when leagueSettings or rosterSettings is null/undefined", () => {
    expect(extractSleeperFaabBudget(null, { waiver_budget_used: 10 })).toBeNull();
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, null)).toBeNull();
    expect(extractSleeperFaabBudget(undefined, undefined)).toBeNull();
  });

  it("returns null when waiver_budget_used exceeds total (corrupted upstream)", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 150 })).toBeNull();
  });

  it("ignores a non-numeric waiver_budget", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: "100" }, { waiver_budget_used: 0 })).toBeNull();
  });

  it("activates the lifecycle-rule threshold (< 0.1) for a depleted budget", () => {
    // $100 budget, $95 spent -> 0.05 remaining, below the alert threshold.
    const b = extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 95 });
    expect(b).not.toBeNull();
    expect(b!.ratio).toBeLessThan(0.1);
    expect(b!.remaining).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// extractEspnFaabBudget
// ---------------------------------------------------------------------------

const ESPN_FAAB_SETTINGS = {
  acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 }
};

describe("extractEspnFaabBudget", () => {
  it("returns dollars AND the ratio for a FAAB league", () => {
    expect(
      extractEspnFaabBudget(ESPN_FAAB_SETTINGS, {
        transactionCounter: { acquisitionBudgetSpent: 40 }
      })
    ).toEqual({ total: 100, remaining: 60, ratio: 0.6 });
  });

  it("treats an absent acquisitionBudgetSpent as 0 spent", () => {
    expect(extractEspnFaabBudget(ESPN_FAAB_SETTINGS, { transactionCounter: {} })?.ratio).toBe(1);
    expect(extractEspnFaabBudget(ESPN_FAAB_SETTINGS, {})?.ratio).toBe(1);
  });

  it("returns 0 remaining when the whole budget is spent", () => {
    expect(
      extractEspnFaabBudget(ESPN_FAAB_SETTINGS, {
        transactionCounter: { acquisitionBudgetSpent: 100 }
      })
    ).toEqual({ total: 100, remaining: 0, ratio: 0 });
  });

  it("returns null when the league does NOT use an acquisition budget", () => {
    expect(
      extractEspnFaabBudget(
        { acquisitionSettings: { isUsingAcquisitionBudget: false, acquisitionBudget: 100 } },
        { transactionCounter: { acquisitionBudgetSpent: 10 } }
      )
    ).toBeNull();
    // Missing the flag is treated as not-FAAB — never surface a budget for a
    // league we cannot confirm uses one.
    expect(
      extractEspnFaabBudget({ acquisitionSettings: { acquisitionBudget: 100 } }, { transactionCounter: {} })
    ).toBeNull();
  });

  it("returns null with missing settings / acquisitionSettings / team", () => {
    expect(extractEspnFaabBudget(null, {})).toBeNull();
    expect(extractEspnFaabBudget({}, {})).toBeNull();
    expect(extractEspnFaabBudget(ESPN_FAAB_SETTINGS, null)).toBeNull();
  });

  it("returns null when the budget is zero/negative or overspent (corrupt)", () => {
    expect(
      extractEspnFaabBudget(
        { acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 0 } },
        {}
      )
    ).toBeNull();
    expect(
      extractEspnFaabBudget(ESPN_FAAB_SETTINGS, {
        transactionCounter: { acquisitionBudgetSpent: 150 }
      })
    ).toBeNull();
  });

  it("activates the lifecycle threshold (< 0.1) for a depleted ESPN budget", () => {
    const b = extractEspnFaabBudget(ESPN_FAAB_SETTINGS, {
      transactionCounter: { acquisitionBudgetSpent: 95 }
    });
    expect(b).not.toBeNull();
    expect(b!.ratio).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// buildSleeperFaabState — the league-wide picture
// ---------------------------------------------------------------------------

const SLEEPER_USERS = [
  { user_id: "u1", username: "jviola1019", display_name: "jviola1019" },
  { user_id: "u2", username: "bob", display_name: "Bob" },
  { user_id: "u3", username: "charlie", display_name: null }
];

const sleeperRoster = (roster_id: number, owner_id: string | null, used?: number) => ({
  roster_id,
  owner_id,
  settings: used === undefined ? {} : { waiver_budget_used: used }
});

describe("buildSleeperFaabState", () => {
  it("reads every roster's budget from the payload already fetched", () => {
    const state = buildSleeperFaabState(
      { waiver_type: 2, waiver_budget: 100 },
      [sleeperRoster(1, "u1", 37), sleeperRoster(2, "u2", 80), sleeperRoster(3, "u3")],
      SLEEPER_USERS,
      1
    );
    expect(state).not.toBeNull();
    expect(state!.total).toBe(100);
    expect(state!.teamCount).toBe(3);
    // Richest first — the ordering a manager reasons with (who can outbid me).
    expect(state!.budgets.map((b) => b.remaining)).toEqual([100, 63, 20]);
    expect(state!.budgets.map((b) => b.teamName)).toEqual(["charlie", "jviola1019", "Bob"]);
  });

  it("marks exactly the user's own roster", () => {
    const state = buildSleeperFaabState(
      { waiver_type: 2, waiver_budget: 100 },
      [sleeperRoster(1, "u1", 37), sleeperRoster(2, "u2", 80)],
      SLEEPER_USERS,
      1
    );
    expect(state!.budgets.filter((b) => b.isMine).map((b) => b.teamId)).toEqual(["1"]);
    expect(myFaabBudget(state)!.remaining).toBe(63);
  });

  it("marks nobody when identity is unresolved, rather than guessing", () => {
    // D-D's sibling failure: with no resolved roster_id, the first team must not
    // be silently presented as the user's.
    const state = buildSleeperFaabState(
      { waiver_type: 2, waiver_budget: 100 },
      [sleeperRoster(1, "u1", 37), sleeperRoster(2, "u2", 80)],
      SLEEPER_USERS,
      null
    );
    expect(state!.budgets.some((b) => b.isMine)).toBe(false);
    expect(myFaabBudget(state)).toBeNull();
  });

  it("omits an unreadable roster and still reports the true team count", () => {
    const state = buildSleeperFaabState(
      { waiver_type: 2, waiver_budget: 100 },
      [
        sleeperRoster(1, "u1", 37),
        // Overspent past the total: incoherent, so it is dropped rather than
        // drawn as a negative bar.
        sleeperRoster(2, "u2", 150)
      ],
      SLEEPER_USERS,
      1
    );
    expect(state!.budgets).toHaveLength(1);
    expect(state!.teamCount).toBe(2);
  });

  it("labels an unowned roster by its slot instead of dropping it", () => {
    const state = buildSleeperFaabState(
      { waiver_type: 2, waiver_budget: 100 },
      [sleeperRoster(4, null, 10)],
      SLEEPER_USERS,
      null
    );
    expect(state!.budgets[0]!.teamName).toBe("Team 4");
  });

  it("returns null for a non-FAAB league", () => {
    expect(buildSleeperFaabState({ waiver_type: 2 }, [sleeperRoster(1, "u1", 0)], SLEEPER_USERS, 1)).toBeNull();
  });

  it("returns null with no rosters or no settings", () => {
    expect(buildSleeperFaabState({ waiver_type: 2, waiver_budget: 100 }, [], SLEEPER_USERS, 1)).toBeNull();
    expect(buildSleeperFaabState(null, [sleeperRoster(1, "u1", 0)], SLEEPER_USERS, 1)).toBeNull();
  });
});

describe("buildEspnFaabState", () => {
  const team = (id: number, spent: number, name?: Record<string, unknown>) => ({
    id,
    transactionCounter: { acquisitionBudgetSpent: spent },
    ...(name ?? {})
  });

  it("reads every team's budget and marks the user's", () => {
    const state = buildEspnFaabState(
      ESPN_FAAB_SETTINGS,
      [team(1, 40, { name: "Team Rocket" }), team(2, 0, { location: "Bay", nickname: "Bombers" })],
      2
    );
    expect(state!.budgets.map((b) => [b.teamName, b.remaining])).toEqual([
      ["Bay Bombers", 100],
      ["Team Rocket", 60]
    ]);
    expect(myFaabBudget(state)!.teamId).toBe("2");
  });

  it("falls back to the numeric id when ESPN sends no usable name", () => {
    const state = buildEspnFaabState(ESPN_FAAB_SETTINGS, [team(7, 10)], null);
    expect(state!.budgets[0]!.teamName).toBe("Team 7");
  });

  it("returns null for a non-FAAB ESPN league", () => {
    expect(
      buildEspnFaabState(
        { acquisitionSettings: { isUsingAcquisitionBudget: false, acquisitionBudget: 100 } },
        [team(1, 0)],
        1
      )
    ).toBeNull();
  });
});

describe("the waiver_type gate — measured against live leagues, 2026-08-31", () => {
  // Both of this account's Sleeper leagues report `waiver_type: 0` (rolling
  // waiver priority) AND `waiver_budget: 100`, because Sleeper emits that
  // default for every league regardless of format:
  //
  //   Offline              1395917841022074880  type 0  budget 100  in_season
  //   Creamy Les Coot 4.0  1389332513259790336  type 0  budget 100  pre_draft
  //
  // Keying on `waiver_budget` alone — which the predecessor of this module did —
  // therefore reports a full FAAB budget for EVERY Sleeper league. That was
  // invisible while the only consumer was the <10% lifecycle alert (an unused
  // budget sits at 100% and never trips it) and becomes a fabricated panel the
  // moment it is drawn: ten teams at "$100 of $100 left" in a league where no
  // dollar can be bid.
  it("refuses a budget for a rolling-waiver league that still reports waiver_budget", () => {
    expect(
      extractSleeperFaabBudget({ waiver_type: 0, waiver_budget: 100 }, { waiver_budget_used: 0 })
    ).toBeNull();
    expect(
      buildSleeperFaabState(
        { waiver_type: 0, waiver_budget: 100 },
        [sleeperRoster(1, "u1", 0), sleeperRoster(2, "u2", 0)],
        SLEEPER_USERS,
        1
      )
    ).toBeNull();
  });

  it("refuses a reverse-standings league too", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 1, waiver_budget: 100 }, {})).toBeNull();
  });

  it("refuses a league that declares no waiver_type at all", () => {
    // Symmetric with the ESPN path, which requires isUsingAcquisitionBudget to
    // be exactly true. Absence is not confirmation.
    expect(extractSleeperFaabBudget({ waiver_budget: 100 }, {})).toBeNull();
  });

  it("still accepts a genuine FAAB league", () => {
    expect(
      extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 25 })
    ).toEqual({ total: 100, remaining: 75, ratio: 0.75 });
  });
});
