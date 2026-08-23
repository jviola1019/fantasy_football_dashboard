/**
 * Disclosure for in-season opportunity, after protocol 4 measured it.
 *
 * Audit 2026-08-21 §19/protocol 4. Every other RAE predictor turned out to be a
 * monotone function of consensus rank, which is why protocols 1–3 failed:
 * a model built from the market's own opinion is the market. Opportunity is the
 * one signal RAE collects that consensus has NOT already priced, because ADP
 * freezes at the draft while usage updates every week.
 *
 * Tested on nflverse 2021–2024 (CC-BY), RB/WR/TE, 958 player-seasons over 452
 * distinct players. Features from weeks 1–8, outcome weeks 9–17, standardised
 * within (season, position), all inference clustered on player:
 *
 * | hypothesis | result |
 * |---|---|
 * | usage adds beyond points-to-date | +0.2289 [0.1636, 0.2943] |
 * | **the same test WITHIN position** | **+0.2259 [0.1652, 0.2884]** |
 * | higher-usage wins at matched production | 0.5749 [0.5496, 0.5948] |
 *
 * All three cleared Holm correction. H2 matching H1 is the load-bearing detail:
 * protocol 3's retracted quarterback "finding" was manufactured by a
 * position-blind baseline, so protocol 4 re-tested the whole claim within
 * position, and the effect did not move.
 *
 * FOUR LIMITS TRAVEL WITH THIS RESULT and are surfaced, not buried:
 *
 * 1. The gain is modest. Out of fold, points-to-date alone reaches Spearman
 *    0.7342; adding usage reaches 0.7479. That is +0.0137.
 * 2. p < 0.0002 is the bootstrap floor (zero of 5000 resamples), not a
 *    vanishingly small number.
 * 3. Part of the effect is mechanical — in PPR a reception is a point, so this
 *    is partly volume persisting, not latent talent being uncovered.
 * 4. IN-SEASON ONLY. Pre-season there is no usage to observe, and that regime
 *    was tested in protocols 1–3 and failed.
 *
 * NO WEIGHT IS DERIVED HERE. Protocol 4 §8 forbids tuning a weight on this data,
 * so the shipped waiver weighting is unchanged; what changed is that it now
 * carries evidence and a scope limit instead of an assertion.
 *
 * Evidence: reports/2026-08-20/holdout-result-4.md
 * Protocol (frozen before scoring): reports/2026-08-20/holdout-protocol-4.md
 */

/** Validation state for a metric, mirroring the vocabulary used across RAE. */
export type OpportunityValidation = "validated-in-season" | "out-of-scope-preseason";

export const OPPORTUNITY_EVIDENCE = {
  /** Confirmatory statistics, quoted exactly as the harness emitted them. */
  partialSpearman: 0.2289,
  partialSpearmanWithinPosition: 0.2259,
  concordanceAtMatchedProduction: 0.5749,
  /** Bootstrap floor: 1/(5000+1). Reported as an upper bound, never as "=". */
  pValueUpperBound: 0.0002,
  /** Out-of-fold Spearman, the honest measure of practical gain. */
  baselineOutOfFold: 0.7342,
  withOpportunityOutOfFold: 0.7479,
  playerSeasons: 958,
  distinctPlayers: 452,
  seasons: "2021–2024",
  positions: "RB, WR, TE",
  protocol: "reports/2026-08-20/holdout-protocol-4.md",
  result: "reports/2026-08-20/holdout-result-4.md"
} as const;

/** Practical improvement, out of fold. Derived so it cannot drift from the pair. */
export const OPPORTUNITY_OUT_OF_FOLD_GAIN = Number(
  (OPPORTUNITY_EVIDENCE.withOpportunityOutOfFold - OPPORTUNITY_EVIDENCE.baselineOutOfFold).toFixed(4)
);

export const OPPORTUNITY_HEADLINE = "Validated in-season signal";

export const OPPORTUNITY_DETAIL =
  "Usage through the first half of a season predicts second-half scoring beyond " +
  "what points already scored predict — tested on 958 player-seasons across 452 " +
  "players, and it holds within position, not just across positions. The gain is " +
  "real but small: it improves out-of-sample ranking from 0.734 to 0.748.";

/** Compact form for a table caption or a narrow tile. */
export const OPPORTUNITY_SHORT =
  "Validated for in-season use on 452 players. Small but reliable gain over points scored to date.";

/**
 * The limit that matters most, because it is the one a reader would otherwise
 * assume away: this says nothing about drafting.
 */
export const OPPORTUNITY_SCOPE_LIMIT =
  "In-season only. Before the season there is no usage to observe, and RAE's " +
  "pre-season valuation was tested separately and did not beat consensus.";

export const OPPORTUNITY_MECHANISM_CAVEAT =
  "Part of this is mechanical rather than insight: in PPR scoring a reception is " +
  "itself a point, so a player who keeps drawing volume keeps scoring. That still " +
  "makes it useful for a start/sit or waiver call.";

/**
 * Whether the opportunity signal is inside the regime protocol 4 validated.
 *
 * Pre-season, opportunity is not merely unavailable — it is out of scope, and
 * those are different claims. Callers should say which one applies rather than
 * collapsing both into "no data".
 */
export function opportunityValidation(hasInSeasonUsage: boolean): OpportunityValidation {
  return hasInSeasonUsage ? "validated-in-season" : "out-of-scope-preseason";
}

export const OPPORTUNITY_VALIDATION_LABEL: Record<OpportunityValidation, string> = {
  "validated-in-season": OPPORTUNITY_HEADLINE,
  "out-of-scope-preseason": "Not applicable before kickoff"
};
