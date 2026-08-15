import { describe, expect, it } from "vitest";
import { parseEspnFormat, parseSleeperFormat } from "./format";

/**
 * League type / keeper detection, and the ESPN slot regression (audit F-010).
 *
 * Payload shapes below are trimmed from REAL responses captured from the
 * operator's Sleeper and ESPN accounts, so these are not invented fixtures.
 */

const espnPayload = (
  counts: Record<string, number>,
  opts: { keeperCount?: number; ppr?: number; size?: number } = {}
) => ({
  size: opts.size ?? 10,
  rosterSettings: { lineupSlotCounts: counts },
  scoringSettings: { scoringItems: [{ statId: 53, points: opts.ppr ?? 1 }] },
  draftSettings: {
    type: "SNAKE",
    keeperCount: opts.keeperCount ?? 0,
    keeperCountFuture: opts.keeperCount ?? 0
  }
});

/** Standard 1QB lineup: QB, 2RB, 2WR, TE, D/ST, K, bench, IR, and a FLEX (23). */
const STANDARD_FLEX = { "0": 1, "2": 2, "4": 2, "6": 1, "16": 1, "17": 1, "20": 7, "21": 1, "23": 1 };
/** Genuine superflex: ESPN slot 7 = OP (QB/RB/WR/TE eligible). */
const SUPERFLEX = { "0": 1, "2": 2, "4": 2, "6": 1, "7": 1, "16": 1, "17": 1, "20": 7 };

describe("ESPN lineup slots 7 vs 23 (regression)", () => {
  it("a standard FLEX league is NOT superflex", () => {
    // The bug: slots 7 and 23 were swapped, so superflex was keyed off slot 23
    // — the ordinary RB/WR/TE flex. Every one of the operator's four real ESPN
    // leagues therefore reported numQbs=2, feeding superflex QB targets into
    // the draft board and a 2QB FantasyCalc URL for 1QB leagues.
    const f = parseEspnFormat(espnPayload(STANDARD_FLEX));
    expect(f.numQbs).toBe(1);
    expect(f.starters.FLEX).toBe(1);
    expect(f.starters.SUPERFLEX).toBe(0);
  });

  it("slot 7 (OP) IS superflex", () => {
    const f = parseEspnFormat(espnPayload(SUPERFLEX));
    expect(f.numQbs).toBe(2);
    expect(f.starters.SUPERFLEX).toBe(1);
    expect(f.starters.FLEX).toBe(0);
  });

  it("matches every real ESPN league the operator owns", () => {
    const cases: Array<[string, Record<string, number>, number, number]> = [
      ["My 2024 League", STANDARD_FLEX, 0, 1],
      ["Scumbags", { ...STANDARD_FLEX, "21": 2, "23": 2 }, 1, 1],
      ["The Roberta Rat Pack", STANDARD_FLEX, 0, 0.5],
      ["Vols", STANDARD_FLEX, 0, 1]
    ];
    for (const [name, counts, keeperCount, ppr] of cases) {
      const f = parseEspnFormat(espnPayload(counts, { keeperCount, ppr }));
      expect(f.numQbs, `${name} numQbs`).toBe(1);
      expect(f.starters.SUPERFLEX, `${name} superflex`).toBe(0);
      expect(f.ppr, `${name} ppr`).toBe(ppr);
    }
  });
});

describe("ESPN league type", () => {
  it("no keepers means redraft", () => {
    const f = parseEspnFormat(espnPayload(STANDARD_FLEX, { keeperCount: 0 }));
    expect(f.leagueType).toBe("redraft");
    expect(f.keeperCount).toBe(0);
  });

  it("detects the operator's real 1-keeper league", () => {
    const f = parseEspnFormat(espnPayload({ ...STANDARD_FLEX, "23": 2 }, { keeperCount: 1 }));
    expect(f.leagueType).toBe("keeper");
    expect(f.keeperCount).toBe(1);
  });

  it("treats keeping (nearly) the whole roster as dynasty", () => {
    // ESPN has no dynasty flag; it models continuity purely as keepers.
    const f = parseEspnFormat(espnPayload(STANDARD_FLEX, { keeperCount: 17 }));
    expect(f.leagueType).toBe("dynasty");
  });

  it("uses the larger of keeperCount and keeperCountFuture", () => {
    const payload = espnPayload(STANDARD_FLEX);
    payload.draftSettings = { type: "SNAKE", keeperCount: 0, keeperCountFuture: 2 };
    expect(parseEspnFormat(payload).keeperCount).toBe(2);
  });
});

describe("Sleeper league type", () => {
  const sleeper = (settings: Record<string, unknown>) =>
    parseSleeperFormat({
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"],
      scoring_settings: { rec: 1 },
      settings: { num_teams: 10, ...settings }
    });

  it("reads settings.type: 0 redraft, 1 keeper, 2 dynasty", () => {
    expect(sleeper({ type: 0 }).leagueType).toBe("redraft");
    expect(sleeper({ type: 1 }).leagueType).toBe("keeper");
    expect(sleeper({ type: 2 }).leagueType).toBe("dynasty");
  });

  it("reads max_keepers for a keeper league", () => {
    expect(sleeper({ type: 1, max_keepers: 3 }).keeperCount).toBe(3);
  });

  it("reports no keeper COUNT for dynasty — the whole roster carries over", () => {
    expect(sleeper({ type: 2, max_keepers: 20 }).keeperCount).toBe(0);
  });

  it("matches the operator's real 2026 Sleeper league", () => {
    const f = sleeper({ type: 0, playoff_week_start: 15, trade_deadline: 11 });
    expect(f.leagueType).toBe("redraft");
    expect(f.numQbs).toBe(1);
    expect(f.starters.FLEX).toBe(2);
    expect(f.ppr).toBe(1);
  });

  it("defaults to redraft when the platform omits the field", () => {
    expect(sleeper({}).leagueType).toBe("redraft");
  });
});
