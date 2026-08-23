import type { PlayerValue } from "./values";

/**
 * `unpriced` is not a grade — it is the ABSENCE of one.
 *
 * Audit 2026-08-22. `evaluateTrade([], [])` previously returned
 * `{ fairness: 1, verdict: "balanced", winner: "even" }`, because
 * `pctDelta = 0 / Math.max(0, 0, 1) = 0`. A trade with NO valuation data was
 * rendered as maximally fair — the strongest possible claim, manufactured from
 * nothing. Worse, a trade where only ONE side could be priced returned
 * `pctDelta = 1` => "lopsided", inventing a blowout out of a missing price.
 *
 * This mattered in production rather than in theory: the league refresh route
 * calls `normalizeEspnTrades(txns, indexByEspnId(new Map()))` with a
 * deliberately EMPTY value map, so every ESPN trade took the first path and was
 * graded perfectly fair.
 */
export type Verdict = "balanced" | "slight-edge" | "lopsided" | "unpriced" | "multi-team";

export interface TradeVerdict {
  totalA: number;
  totalB: number;
  /** totalA - totalB. */
  delta: number;
  /** |delta| / max(totalA, totalB, 1), in 0..1. */
  pctDelta: number;
  /** 1 - pctDelta, clamped to 0..1. */
  fairness: number;
  verdict: Verdict;
  winner: "A" | "B" | "even";
  /** How many players on each side carried a usable value. */
  pricedA: number;
  pricedB: number;
  /** True when either side had no priced player, so no verdict is possible. */
  unpriced: boolean;
  /**
   * Number of distinct teams in the deal. 2 for an ordinary trade; more when
   * the source reported a multi-team deal that cannot be reduced to two sides.
   */
  teamCount: number;
}

// Starting thresholds; Backtest B (Task 8) validates and may adjust them once.
const BALANCED_MAX = 0.1;
const SLIGHT_MAX = 0.25;

const sum = (side: PlayerValue[]) => side.reduce((acc, p) => acc + p.value, 0);

/**
 * A multi-team deal is not a two-sided comparison, and pretending otherwise
 * produces a specific, confident, wrong answer.
 *
 * Audit 2026-08-22, P1-4. `normalizeEspnTrades` bucketed every item by
 * "did it go to team A?", so in a three-team trade team C's haul was attributed
 * to team B, team B's label was printed over it, and the verdict compared A
 * against B-plus-C. There is no arrangement of two totals that answers "was
 * this fair?" for three parties, so the honest output is a refusal with the
 * team count attached — the same shape as `unpriced`.
 */
export function multiTeamTrade(teamCount: number): TradeVerdict {
  return {
    totalA: Number.NaN,
    totalB: Number.NaN,
    delta: Number.NaN,
    pctDelta: Number.NaN,
    fairness: Number.NaN,
    verdict: "multi-team",
    winner: "even",
    pricedA: 0,
    pricedB: 0,
    unpriced: true,
    teamCount
  };
}

export function evaluateTrade(sideA: PlayerValue[], sideB: PlayerValue[]): TradeVerdict {
  const totalA = sum(sideA);
  const totalB = sum(sideB);
  const pricedA = sideA.length;
  const pricedB = sideB.length;

  // Refuse to grade what cannot be priced. Returning NaN rather than 0 keeps a
  // caller that ignores `unpriced` from quietly rendering a plausible number.
  if (pricedA === 0 || pricedB === 0) {
    return {
      totalA, totalB,
      delta: Number.NaN,
      pctDelta: Number.NaN,
      fairness: Number.NaN,
      verdict: "unpriced",
      winner: "even",
      pricedA, pricedB,
      unpriced: true,
      teamCount: 2
    };
  }

  const delta = totalA - totalB;
  const pctDelta = Math.abs(delta) / Math.max(totalA, totalB, 1);
  const fairness = Math.max(0, Math.min(1, 1 - pctDelta));
  const verdict: Verdict =
    pctDelta <= BALANCED_MAX ? "balanced" : pctDelta <= SLIGHT_MAX ? "slight-edge" : "lopsided";
  const winner = verdict === "balanced" ? "even" : delta > 0 ? "A" : "B";
  return { totalA, totalB, delta, pctDelta, fairness, verdict, winner, pricedA, pricedB, unpriced: false, teamCount: 2 };
}
