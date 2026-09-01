import { describe, expect, it } from "vitest";
import { interpretSleeperLeague, interpretEspnLeague } from "../trade/verify";
import { parseSleeperFormat, parseEspnFormat, pprApproximated } from "../trade/format";
import { detectSleeperDraftState, detectEspnDraftState } from "./draftState";
import { extractSleeperFaabBudget, extractEspnFaabBudget } from "./faab";
import { resolveSleeperRosterId } from "./fetchLive";

/**
 * INGESTION CONFORMANCE — can ANY league be added, whatever it is configured as?
 *
 * The existing tests each check one league shape. This one walks the axes, so
 * that a configuration nobody happened to own is not simply untested:
 *
 *   platform      sleeper | espn
 *   draft state   pre_draft | drafting | in_season | complete | unknown | absent
 *   scoring       standard | half | full PPR | an off-scale value (0.75, 1.5, 2)
 *   league type   redraft | keeper | dynasty | undeclared
 *   lineup        1QB | superflex | TE-premium | IDP | best-ball | no K/DEF
 *   waivers       rolling | reverse standings | FAAB
 *   size          2 … 32 teams
 *   identity      Sleeper username given | omitted
 *
 * The rule these enforce is the product's own: a league RAE cannot read
 * correctly must SAY so. Silently substituting a default is the failure mode
 * that produced the FAAB board for two rolling-waiver leagues and the superflex
 * misread of every ESPN league with an ordinary flex.
 */

/** A Sleeper league payload with everything real, overridable per axis. */
function sleeperLeague(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    league_id: "1395917841022074880",
    name: "Offline",
    season: "2026",
    sport: "nfl",
    status: "in_season",
    total_rosters: 10,
    // Verified live 2026-09-01 against league 1395917841022074880.
    settings: { type: 2, waiver_type: 0, max_keepers: 1, num_teams: 10, waiver_budget: 100 },
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"],
    draft_id: "1395914493862621184",
    previous_league_id: null,
    ...over
  };
}

describe("scoring — every setting a league can have resolves to a stated format", () => {
  const CASES: Array<[number | undefined, "STD" | "HALF" | "PPR", boolean]> = [
    [0, "STD", false],
    [0.5, "HALF", false],
    [1, "PPR", false],
    [undefined, "STD", false],
    // Off-scale settings a real league can and does use. RAE supports three
    // buckets, so these are APPROXIMATED — the point is that the approximation
    // is declared rather than silently applied.
    [0.75, "PPR", true],
    [1.5, "PPR", true],
    [2, "PPR", true],
    [0.25, "STD", true],
    [0.1, "STD", true]
  ];

  for (const [rec, expected, approximated] of CASES) {
    it(`rec=${String(rec)} → ${expected}${approximated ? " (declared as approximated)" : ""}`, () => {
      const f = parseSleeperFormat(sleeperLeague({ scoring_settings: rec === undefined ? {} : { rec } }));
      expect(f.scoringFormat).toBe(expected);
      expect(pprApproximated(f.pprActual)).toBe(approximated);
      // The RAW setting is always kept, so an approximation can be audited.
      expect(f.pprActual).toBe(rec ?? 0);
    });
  }
});

describe("lineup — the shapes a league can be built in", () => {
  const LINEUPS: Array<[string, string[], { numQbs: 1 | 2; QB: number; FLEX: number; SUPERFLEX: number }]> = [
    ["standard 1QB", ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }],
    ["superflex", ["QB", "SUPER_FLEX", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"], { numQbs: 2, QB: 1, FLEX: 1, SUPERFLEX: 1 }],
    ["2QB (no SUPER_FLEX slot)", ["QB", "QB", "RB", "WR", "TE", "BN"], { numQbs: 1, QB: 2, FLEX: 0, SUPERFLEX: 0 }],
    ["TE premium / WR_TE_FLEX", ["QB", "RB", "WR", "TE", "WR_TE_FLEX", "BN"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }],
    ["REC_FLEX", ["QB", "RB", "WR", "TE", "REC_FLEX", "BN"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }],
    ["WRRB_FLEX", ["QB", "RB", "WR", "TE", "WRRB_FLEX", "BN"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }],
    ["no kicker or defence", ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }],
    ["IDP", ["QB", "RB", "WR", "TE", "DL", "LB", "DB", "IDP_FLEX", "BN"], { numQbs: 1, QB: 1, FLEX: 0, SUPERFLEX: 0 }],
    ["best ball (all starters, no bench)", ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"], { numQbs: 1, QB: 1, FLEX: 1, SUPERFLEX: 0 }]
  ];

  for (const [name, positions, want] of LINEUPS) {
    it(name, () => {
      const f = parseSleeperFormat(sleeperLeague({ roster_positions: positions }));
      expect(f.numQbs).toBe(want.numQbs);
      expect(f.starters.QB).toBe(want.QB);
      expect(f.starters.FLEX).toBe(want.FLEX);
      expect(f.starters.SUPERFLEX).toBe(want.SUPERFLEX);
      // rosterSize counts every slot including bench and IDP: it is what the
      // league gives a manager, not what RAE happens to model.
      expect(f.rosterSize).toBe(positions.length);
    });
  }

  it("never invents a lineup when the platform omits one", () => {
    const f = parseSleeperFormat(sleeperLeague({ roster_positions: [] }));
    // Falls back to the declared default rather than an empty lineup that would
    // make every downstream scarcity calculation divide by zero.
    expect(f.rosterSize).toBeGreaterThan(0);
    expect(f.starters.QB).toBeGreaterThan(0);
  });
});

describe("ESPN lineup slots — all three flex slots, not just the one that was mapped", () => {
  /** An ESPN mSettings payload; `lineupSlotCounts` is the lineup. */
  const espn = (counts: Record<string, number>, over: Record<string, unknown> = {}) => ({
    name: "Gridiron Kings",
    seasonId: 2026,
    size: 12,
    scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
    rosterSettings: { lineupSlotCounts: counts },
    ...over
  });

  it("maps slot 23 (RB/WR/TE) to FLEX — the one that was already mapped", () => {
    expect(parseEspnFormat(espn({ "0": 1, "2": 2, "4": 2, "6": 1, "23": 1, "20": 6 })).starters.FLEX).toBe(1);
  });

  it("maps slot 3 (RB/WR) to FLEX", () => {
    // Found by this sweep 2026-09-01. ESPN publishes three flex slots and only
    // 23 was in the map, so a league whose flex is RB/WR reported FLEX: 0 — the
    // same silent-drop class as the 7/23 swap that made every ordinary-flex
    // league read as superflex.
    expect(parseEspnFormat(espn({ "0": 1, "2": 2, "4": 2, "6": 1, "3": 1, "20": 6 })).starters.FLEX).toBe(1);
  });

  it("maps slot 5 (WR/TE) to FLEX", () => {
    expect(parseEspnFormat(espn({ "0": 1, "2": 2, "4": 2, "6": 1, "5": 1, "20": 6 })).starters.FLEX).toBe(1);
  });

  it("still reads slot 7 (OP) as superflex and slot 23 as an ordinary flex", () => {
    // Audit 2026-08-06 F-010 regression guard: these two were swapped, and every
    // one of the operator's four real ESPN leagues came back numQbs=2.
    expect(parseEspnFormat(espn({ "0": 1, "7": 1, "20": 6 })).numQbs).toBe(2);
    expect(parseEspnFormat(espn({ "0": 1, "23": 1, "20": 6 })).numQbs).toBe(1);
  });

  it("counts IDP slots as recognised-but-unmodelled rather than as unknown", () => {
    const f = parseEspnFormat(espn({ "0": 1, "2": 2, "4": 2, "6": 1, "10": 2, "14": 2, "20": 6 }));
    expect(f.unmappedSlots).toEqual([]);
    expect(f.unmodelledSlots).toEqual(["10", "14"]);
  });

  it("names a slot id it has never seen", () => {
    const f = parseEspnFormat(espn({ "0": 1, "99": 1, "20": 6 }));
    expect(f.unmappedSlots).toEqual(["99"]);
  });

  it("ignores a slot configured to zero — it is not part of this lineup at all", () => {
    const f = parseEspnFormat(espn({ "0": 1, "99": 0, "20": 6 }));
    expect(f.unmappedSlots).toEqual([]);
  });

  it("treats 20/21/24 as bench, reserve and extra rather than as starters", () => {
    const f = parseEspnFormat(espn({ "0": 1, "20": 6, "21": 1, "24": 1 }));
    expect(f.starters.QB).toBe(1);
    expect(f.unmappedSlots).toEqual([]);
    expect(f.unmodelledSlots).toEqual([]);
  });
});

describe("league type and keepers", () => {
  it.each([
    [0, "redraft", 2],
    [1, "keeper", 2],
    [2, "dynasty", 0] // whole roster is kept; a keeper COUNT is meaningless
  ])("settings.type=%s → %s", (type, expected, keepers) => {
    const f = parseSleeperFormat(sleeperLeague({ settings: { type, max_keepers: 2 } }));
    expect(f.leagueType).toBe(expected);
    expect(f.keeperCount).toBe(keepers);
    expect(f.provenance?.leagueType).toBe("platform-declared");
  });

  it("labels an undeclared type as defaulted rather than as fact", () => {
    const f = parseSleeperFormat(sleeperLeague({ settings: { max_keepers: 0 } }));
    expect(f.leagueType).toBe("redraft");
    expect(f.provenance?.leagueType).toBe("defaulted");
    expect(f.provenance?.note).toMatch(/omitted settings.type/i);
  });

  it("never claims to know the keeper COST, which no platform publishes", () => {
    const keeper = parseSleeperFormat(sleeperLeague({ settings: { type: 1, max_keepers: 3 } }));
    expect(keeper.keeperCostRule).toBe("unknown");
    expect(keeper.provenance?.keeperCostRule).toBe("unavailable");
    const redraft = parseSleeperFormat(sleeperLeague({ settings: { type: 0, max_keepers: 0 } }));
    expect(redraft.keeperCostRule).toBe("none");
  });
});

describe("league size — from a two-team test league to a 32-team monster", () => {
  it.each([2, 4, 6, 8, 10, 12, 14, 16, 20, 32])("%s teams", (n) => {
    const f = parseSleeperFormat(sleeperLeague({ settings: { num_teams: n }, total_rosters: n }));
    expect(f.numTeams).toBe(n);
  });

  it("falls back to total_rosters when settings.num_teams is absent", () => {
    const f = parseSleeperFormat(sleeperLeague({ settings: {}, total_rosters: 14 }));
    expect(f.numTeams).toBe(14);
  });
});

describe("draft state — every status a league can report, and the absence of one", () => {
  it.each([
    ["pre_draft", "pre"],
    ["drafting", "pre"],
    ["in_season", "post"],
    ["complete", "post"],
    ["PRE_DRAFT", "pre"] // case-insensitive: the string is Sleeper's, not ours
  ])("league.status=%s → %s", (status, expected) => {
    expect(detectSleeperDraftState(status, null, false)).toBe(expected);
  });

  it("falls back to the draft object when the league status is unrecognised", () => {
    // Sleeper has shipped status strings this code was not written against.
    // The draft object is the backup, and it must actually be consulted.
    expect(detectSleeperDraftState("post_draft", "complete", true)).toBe("post");
    expect(detectSleeperDraftState("some_new_status", "drafting", false)).toBe("pre");
  });

  it("falls back to roster fill when neither status is usable", () => {
    expect(detectSleeperDraftState(null, null, false)).toBe("pre");
    expect(detectSleeperDraftState(null, null, true)).toBe("post");
    expect(detectSleeperDraftState(undefined, undefined, true)).toBe("post");
  });

  it("infers ESPN from median roster fill, which has no status string at all", () => {
    const full = Array.from({ length: 10 }, () => Array.from({ length: 15 }, () => ({}) as never));
    const empty = Array.from({ length: 10 }, () => [] as never[]);
    expect(detectEspnDraftState(full, 15)).toBe("post");
    expect(detectEspnDraftState(empty, 15)).toBe("pre");
    // One stray empty team must not flip a drafted league back to pre.
    const mostlyFull = [...full.slice(0, 9), [] as never[]];
    expect(detectEspnDraftState(mostlyFull, 15)).toBe("post");
    expect(detectEspnDraftState([], 15)).toBe("unknown");
  });
});

describe("waivers — a budget is shown only where one can actually be bid", () => {
  it.each([
    [0, "rolling priority"],
    [1, "reverse standings"]
  ])("waiver_type=%s (%s) gets no budget even though Sleeper sends waiver_budget", (type) => {
    // Verified live 2026-08-31: BOTH of this account's leagues are waiver_type 0
    // and both report waiver_budget: 100.
    expect(extractSleeperFaabBudget({ waiver_type: type, waiver_budget: 100 }, { waiver_budget_used: 0 })).toBeNull();
  });

  it("waiver_type=2 (FAAB) gets the real budget", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 37 })).toEqual({
      total: 100,
      remaining: 63,
      ratio: 0.63
    });
  });

  it("treats an absent waiver_budget_used as zero spent, which is how Sleeper encodes it", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 50 }, {})?.remaining).toBe(50);
  });

  it("ESPN needs the acquisition-budget flag explicitly true", () => {
    const team = { transactionCounter: { acquisitionBudgetSpent: 20 } };
    expect(extractEspnFaabBudget({ acquisitionSettings: { acquisitionBudget: 100 } }, team)).toBeNull();
    expect(
      extractEspnFaabBudget(
        { acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 } },
        team
      )
    ).toEqual({ total: 100, remaining: 80, ratio: 0.8 });
  });

  it("refuses a corrupt budget rather than drawing a negative or >100% bar", () => {
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 100 }, { waiver_budget_used: 140 })).toBeNull();
    expect(extractSleeperFaabBudget({ waiver_type: 2, waiver_budget: 0 }, { waiver_budget_used: 0 })).toBeNull();
  });
});

describe("identity — with a username, and without one", () => {
  const users = [
    { user_id: "u1", display_name: "someoneElse" },
    { user_id: "u2", display_name: "jviola1019" }
  ];
  const rosters = [
    { roster_id: 1, owner_id: "u2" },
    { roster_id: 2, owner_id: "u1" }
  ];

  it("maps a username to that manager's own roster", () => {
    expect(resolveSleeperRosterId(users, rosters, "jviola1019")).toBe(1);
  });

  it("is case-insensitive, because a display name is not a key", () => {
    expect(resolveSleeperRosterId(users, rosters, "JVIOLA1019")).toBe(1);
  });

  it("returns null — not roster 1 — when no username was given", () => {
    // The fallback to the first roster is the caller's decision and is
    // DECLARED there. If this resolver invented one, the declaration would be
    // attached to a substitution nobody could detect.
    expect(resolveSleeperRosterId(users, rosters, undefined)).toBeNull();
    expect(resolveSleeperRosterId(users, rosters, "")).toBeNull();
  });

  it("returns null for a username that is not in the league", () => {
    expect(resolveSleeperRosterId(users, rosters, "not-a-member")).toBeNull();
  });
});

describe("the league must be the league the user asked for", () => {
  it("rejects a Sleeper league from another sport", () => {
    // Sleeper hosts NBA and LCS leagues behind the SAME endpoint and the same
    // payload shape. An NBA league parses cleanly as a "format" here, and every
    // downstream surface would then rank NFL players against it.
    const nba = sleeperLeague({ sport: "nba", name: "Hoops Dynasty", roster_positions: ["PG", "SG", "SF", "PF", "C", "BN"] });
    const result = interpretSleeperLeague(nba);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nba/i);
  });

  it("accepts an NFL league", () => {
    expect(interpretSleeperLeague(sleeperLeague()).ok).toBe(true);
  });

  it("reports the season the LEAGUE declares, not the one that was typed", () => {
    // A Sleeper league id belongs to exactly one season; a renewal gets a new
    // id, chained by previous_league_id. So the season field on the add form is
    // a guess, and storing the guess makes every season-keyed lookup —
    // projections, stats snapshots, the season mirror — silently disagree with
    // the league. It also lets the SAME league be added many times, once per
    // season typed, each looking like a different league.
    const result = interpretSleeperLeague(sleeperLeague({ season: "2026" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSeason).toBe(2026);
  });

  it("reports no season when the platform does not declare one", () => {
    const result = interpretSleeperLeague(sleeperLeague({ season: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSeason).toBeNull();
  });

  it("ESPN declares its season in the payload the same way", () => {
    const result = interpretEspnLeague({
      name: "Gridiron Kings",
      seasonId: 2026,
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 1 } }
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSeason).toBe(2026);
  });
});

describe("no roster slot is dropped without the code knowing it was dropped", () => {
  it("names every slot code it cannot map, instead of counting it as nothing", () => {
    // The silent-drop is the shape of every defect above: an unknown token maps
    // to `undefined`, the loop skips it, and the starters object looks complete.
    // A league using a slot Sleeper adds next season would be scored against a
    // lineup missing a position, with nothing anywhere to say so.
    const f = parseSleeperFormat(
      sleeperLeague({ roster_positions: ["QB", "RB", "WR", "TE", "SOME_NEW_SLOT", "BN"] })
    );
    expect(f.unmappedSlots).toEqual(["SOME_NEW_SLOT"]);
  });

  it("reports IDP slots as recognised-but-unmodelled, not as unknown", () => {
    // DL/LB/DB/IDP_FLEX are deliberately not modelled — RAE has no IDP values.
    // That is a product decision, and it must not read as a parser gap.
    const f = parseSleeperFormat(
      sleeperLeague({ roster_positions: ["QB", "RB", "WR", "TE", "DL", "LB", "DB", "IDP_FLEX", "BN"] })
    );
    expect(f.unmappedSlots).toEqual([]);
    expect(f.unmodelledSlots).toEqual(["DL", "LB", "DB", "IDP_FLEX"]);
  });

  it("reports nothing for a league RAE models completely", () => {
    const f = parseSleeperFormat(sleeperLeague());
    expect(f.unmappedSlots).toEqual([]);
    expect(f.unmodelledSlots).toEqual([]);
  });
});
