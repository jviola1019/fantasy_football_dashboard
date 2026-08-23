import { describe, expect, it } from "vitest";
import { normalizePpr, pprApproximated, parseSleeperFormat } from "./format";
import { normalizeEspnTrades, normalizeSleeperTrades } from "./transactions";
import type { PlayerValue } from "./values";

/**
 * Regression guards for two P1 findings (audit 2026-08-22).
 *
 * Both share a shape worth naming: the code did not fail, and it did not say
 * "I don't know". It produced a confident, specific, WRONG answer, in the one
 * place a user would never think to double-check.
 */

// ── P1-3 ────────────────────────────────────────────────────────────────────
/**
 * `normalizePpr` returned 0 for anything that was not exactly 0, 0.5 or 1.
 *
 * The worst case is not the near-misses. It is 1.5 PPR — a real and not-rare
 * TE-premium format — which was classified STANDARD: the furthest possible
 * answer from the truth. The settings screen then reported "STD (0
 * pt/reception)" to an owner looking at a league that pays 1.5, and FantasyCalc
 * was queried at ppr=0, so every receiving player was priced low.
 */
describe("P1-3 · a league's real scoring is not rounded to zero", () => {
  it("snaps to the NEAREST supported value, never to a default", () => {
    expect(normalizePpr(0)).toBe(0);
    expect(normalizePpr(0.25)).toBe(0); // exactly on the boundary, rounds down
    expect(normalizePpr(0.5)).toBe(0.5);
    expect(normalizePpr(0.75)).toBe(1);
    expect(normalizePpr(1)).toBe(1);
  });

  it("does NOT call a 1.5 PPR league standard", () => {
    // The specific defect. Old behaviour: 1.5 -> 0 -> "STD".
    expect(normalizePpr(1.5)).toBe(1);
    expect(normalizePpr(2)).toBe(1);
  });

  it("still treats a missing or malformed setting as zero", () => {
    // Absence is genuinely zero-information; the fix must not turn undefined
    // into a guess in the other direction.
    expect(normalizePpr(undefined)).toBe(0);
    expect(normalizePpr("1.5")).toBe(0);
    expect(normalizePpr(Number.NaN)).toBe(0);
  });

  it("flags the snapped value as an approximation, so the UI can say so", () => {
    expect(pprApproximated(1.5)).toBe(true);
    expect(pprApproximated(0.25)).toBe(true);
    expect(pprApproximated(1)).toBe(false);
    expect(pprApproximated(0.5)).toBe(false);
    expect(pprApproximated(0)).toBe(false);
    // Rows stored before this field existed must not claim to be approximate.
    expect(pprApproximated(undefined)).toBe(false);
  });

  it("carries the REAL reception value through from Sleeper settings", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 12,
      settings: {},
      scoring_settings: { rec: 1.5 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN"]
    } as never);
    expect(fmt.pprActual).toBe(1.5);
    expect(fmt.ppr).toBe(1);
    expect(fmt.scoringFormat).toBe("PPR");
  });
});

// ── P1-4 ────────────────────────────────────────────────────────────────────
const pv = (name: string, value: number): PlayerValue =>
  ({ id: name, name, position: "RB", team: "AAA", value }) as unknown as PlayerValue;

/**
 * Multi-team trades were flattened into two sides.
 *
 * The bucketing rule was "did this item go to team A?", so everything that did
 * not was swept into side B — under side B's NAME. In a three-team deal, team
 * C's haul was printed as team B's and the fairness verdict compared A against
 * B-plus-C. There is no pair of totals that answers "was this fair?" for three
 * parties, so the only correct output is a refusal.
 */
describe("P1-4 · a three-team trade is not graded as two-sided", () => {
  const espnThreeWay = [
    {
      id: "t1",
      type: "TRADE_ACCEPT",
      status: "EXECUTED",
      proposedDate: 1_700_000_000_000,
      items: [
        { playerId: 1, fromTeamId: 2, toTeamId: 1 },
        { playerId: 2, fromTeamId: 1, toTeamId: 2 },
        { playerId: 3, fromTeamId: 1, toTeamId: 3 }
      ]
    }
  ] as never;

  const values = new Map<string, PlayerValue>([
    ["1", pv("Player One", 100)],
    ["2", pv("Player Two", 40)],
    ["3", pv("Player Three", 60)]
  ]);

  it("reports the verdict as multi-team rather than a fairness score", () => {
    const [t] = normalizeEspnTrades(espnThreeWay, values);
    expect(t.verdict.verdict).toBe("multi-team");
    expect(t.verdict.teamCount).toBe(3);
    // NaN, not 0 — a caller that ignores the verdict must not render a number.
    expect(Number.isNaN(t.verdict.fairness)).toBe(true);
  });

  it("does not attribute the third team's players to the second team", () => {
    const [t] = normalizeEspnTrades(espnThreeWay, values);
    // Player Three went to team 3. It must not appear under team 2's label.
    expect(t.sideB.map((p) => p.name)).not.toContain("Player Three");
    expect(t.sideBLabel).toMatch(/\+1 more/);
  });

  it("still grades an ordinary two-team trade", () => {
    const twoWay = [
      {
        id: "t2",
        type: "TRADE_ACCEPT",
        status: "EXECUTED",
        proposedDate: 1_700_000_000_000,
        items: [
          { playerId: 1, fromTeamId: 2, toTeamId: 1 },
          { playerId: 2, fromTeamId: 1, toTeamId: 2 }
        ]
      }
    ] as never;
    const [t] = normalizeEspnTrades(twoWay, values);
    expect(t.verdict.verdict).not.toBe("multi-team");
    expect(t.verdict.teamCount).toBe(2);
    expect(Number.isNaN(t.verdict.fairness)).toBe(false);
  });

  it("applies the same rule on the Sleeper path, where the roster list is explicit", () => {
    const sleeperThreeWay = [
      {
        type: "trade",
        status: "complete",
        created: 1_700_000_000_000,
        roster_ids: [1, 2, 3],
        adds: { "1": 1, "2": 2, "3": 3 }
      }
    ] as never;
    const [t] = normalizeSleeperTrades(sleeperThreeWay, values);
    expect(t.verdict.verdict).toBe("multi-team");
    expect(t.verdict.teamCount).toBe(3);
    expect(t.sideB.map((p) => p.name)).not.toContain("Player Three");
  });
});
