import { describe, expect, it } from "vitest";
import { parseEspnFormat, parseSleeperFormat } from "./format";

/**
 * Classification provenance (audit P2 §11).
 *
 * ESPN publishes NO league-type field. "dynasty" for an ESPN league is our
 * heuristic — keeperCount measured against roster size — and it previously
 * arrived as a bare `leagueType: "dynasty"`, indistinguishable from Sleeper's
 * `settings.type`, which the platform genuinely declares. That difference
 * matters because the classification switches the entire trade-value scale
 * between the dynasty and redraft horizons.
 *
 * A derived verdict must never be reported as an authoritative one.
 */

const STANDARD_FLEX = { "0": 1, "2": 2, "4": 2, "6": 1, "16": 1, "17": 1, "20": 7, "21": 1, "23": 1 };

const espn = (
  counts: Record<string, number>,
  draftSettings: Record<string, unknown> | null = { type: "SNAKE", keeperCount: 0, keeperCountFuture: 0 }
) => ({
  size: 10,
  rosterSettings: { lineupSlotCounts: counts },
  scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
  ...(draftSettings ? { draftSettings } : {})
});

const sleeper = (settings: Record<string, unknown>) =>
  parseSleeperFormat({
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN"],
    scoring_settings: { rec: 1 },
    settings: { num_teams: 10, ...settings }
  });

describe("ESPN classifications are DERIVED, and say so", () => {
  it("redraft ESPN — derived from the absence of keepers", () => {
    const f = parseEspnFormat(espn(STANDARD_FLEX));
    expect(f.leagueType).toBe("redraft");
    // Even the confident-looking verdict is an inference: ESPN never said
    // "redraft", we concluded it because keeperCount is 0.
    expect(f.provenance!.leagueType).toBe("derived");
    expect(f.provenance!.note).toMatch(/publishes no league type/i);
  });

  it("small-keeper ESPN — derived keeper, but the COUNT is platform-declared", () => {
    const f = parseEspnFormat(
      espn(STANDARD_FLEX, { type: "SNAKE", keeperCount: 1, keeperCountFuture: 1 })
    );
    expect(f.leagueType).toBe("keeper");
    expect(f.keeperCount).toBe(1);
    expect(f.provenance!.leagueType).toBe("derived");
    // The number itself IS published — only the classification is inferred.
    expect(f.provenance!.keeperCount).toBe("platform-declared");
  });

  it("near-full-roster keeper stays KEEPER, not dynasty", () => {
    // 16 slots total; keeping 14 of them is a deep keeper league, not dynasty.
    const f = parseEspnFormat(
      espn(STANDARD_FLEX, { type: "SNAKE", keeperCount: 14, keeperCountFuture: 14 })
    );
    expect(f.leagueType).toBe("keeper");
    expect(f.keeperCount).toBe(14);
  });

  it("full-roster ESPN is called dynasty — and the note says how to correct it", () => {
    const f = parseEspnFormat(
      espn(STANDARD_FLEX, { type: "SNAKE", keeperCount: 17, keeperCountFuture: 17 })
    );
    expect(f.leagueType).toBe("dynasty");
    expect(f.provenance!.leagueType).toBe("derived");
    // A wrong dynasty verdict silently switches trade values to the long-term
    // scale, so the note must tell the owner it is a guess and how to fix it.
    expect(f.provenance!.note).toMatch(/correct it in league settings/i);
    expect(f.provenance!.note).toMatch(/dynasty switches trade values/i);
  });

  it("marks the keeper count DEFAULTED when ESPN sends no keeper fields", () => {
    const f = parseEspnFormat(espn(STANDARD_FLEX, { type: "SNAKE" }));
    expect(f.leagueType).toBe("redraft");
    expect(f.provenance!.keeperCount).toBe("defaulted");
    expect(f.provenance!.note).toMatch(/sent no keeper fields/i);
  });

  it("never claims a cost rule — neither platform publishes one", () => {
    const f = parseEspnFormat(
      espn(STANDARD_FLEX, { type: "SNAKE", keeperCount: 1, keeperCountFuture: 1 })
    );
    expect(f.keeperCostRule).toBe("unknown");
    expect(f.provenance!.keeperCostRule).toBe("unavailable");
  });
});

describe("Sleeper classifications are PLATFORM-DECLARED", () => {
  it("redraft, keeper and dynasty all come from settings.type", () => {
    for (const [type, expected] of [
      [0, "redraft"],
      [1, "keeper"],
      [2, "dynasty"]
    ] as const) {
      const f = sleeper({ type });
      expect(f.leagueType).toBe(expected);
      expect(f.provenance!.leagueType).toBe("platform-declared");
      expect(f.provenance!.note).toBeNull();
    }
  });

  it("falls back to DEFAULTED when Sleeper omits the field", () => {
    const f = sleeper({});
    expect(f.leagueType).toBe("redraft");
    expect(f.provenance!.leagueType).toBe("defaulted");
    expect(f.provenance!.note).toMatch(/omitted settings.type/i);
  });

  it("marks max_keepers platform-declared when present", () => {
    expect(sleeper({ type: 1, max_keepers: 3 }).provenance!.keeperCount).toBe("platform-declared");
    expect(sleeper({ type: 1 }).provenance!.keeperCount).toBe("defaulted");
  });
});

describe("the two platforms are DISTINGUISHABLE for the same verdict", () => {
  it("a dynasty verdict carries different confidence per platform", () => {
    // This is the whole point: before this change both produced an identical
    // `leagueType: "dynasty"` with no way to tell an inference from a fact.
    const espnDynasty = parseEspnFormat(
      espn(STANDARD_FLEX, { type: "SNAKE", keeperCount: 17, keeperCountFuture: 17 })
    );
    const sleeperDynasty = sleeper({ type: 2 });

    expect(espnDynasty.leagueType).toBe(sleeperDynasty.leagueType);
    expect(espnDynasty.provenance!.leagueType).toBe("derived");
    expect(sleeperDynasty.provenance!.leagueType).toBe("platform-declared");
  });
});
