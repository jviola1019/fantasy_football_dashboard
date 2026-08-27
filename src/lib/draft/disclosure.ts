/**
 * Heuristic disclosure for the draft scoring, which was never fitted to anything.
 *
 * The 2026-06-09 quant audit's first recommendation was that every heuristic
 * metric say so at the governance surface. It was carried out for the
 * `models.ts` composites — both panels that show them carry the "fixed
 * hand-tuned weights, not yet fitted to observed outcomes (QNT-01)" line — and
 * it was **not** carried out here. Neither `recommend.ts` nor `tiers.ts`
 * contained the word "heuristic", and neither surface told the user that the
 * numbers ordering their draft board are authored constants.
 *
 * The audit's own note on this was: "All hand-tuned and reasonable for draft
 * heuristics; none claim to be fitted. No defect, but no doc states 'heuristic'"
 * (`reports/audit-2026-06-09/02-quant-audit.md`, S3). Closing it on 2026-08-26.
 *
 * The weights are quoted rather than described, because "uses a heuristic" tells
 * a reader nothing they can argue with, and `edge x 1.5` tells them exactly what
 * to disagree with. They are kept here rather than inline for the same
 * single-source reason as `edgeDisclosure.ts`: a disclosure that drifts between
 * two panels is worse than one disclosure.
 *
 * These constants are NOT the source of truth for the arithmetic — the functions
 * are. `disclosure.test.ts` asserts the two agree, so editing a weight without
 * editing this line fails the suite.
 */

/** Shown under the Recommendation Queue. */
export const DRAFT_RECOMMENDATION_NOTE =
  "Ranked by a hand-tuned heuristic — scarcity gap x1.5 + opportunity x0.6 " +
  "- fragility x0.25, plus a roster-need bonus. The weights are authored, not " +
  "fitted to draft outcomes, and no holdout test has measured this ordering.";

/** Shown under the Tier Collapse Forecast. */
export const DRAFT_TIER_NOTE =
  "Tier breaks are a fixed 6-point gap in consensus value; collapse intensity is " +
  "the cliff size capped at 20. Both are authored thresholds, not fitted to " +
  "observed draft behaviour.";

/** The numbers the notes above quote, so a test can hold them to the code. */
export const DRAFT_HEURISTIC_WEIGHTS = {
  edge: 1.5,
  opportunity: 0.6,
  fragility: 0.25,
  tierGapThreshold: 6,
  intensityCap: 20
} as const;
