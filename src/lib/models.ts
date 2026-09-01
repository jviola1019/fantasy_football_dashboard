import type { PlayerMarketRecord } from "./governance";

/**
 * Was `reputationEdge` until 2026-08-22.
 *
 * Renamed with the product. Protocol 3 tested this quantity on 115 real drafts
 * and found it does not identify mispriced players — within a position it was
 * inverted — so "reputation edge" named a mechanism the evidence does not
 * support. What it actually measures is a positional scarcity gap, which is what
 * every user-visible label now calls it (`EDGE_LABELS`).
 *
 * The formula is UNCHANGED. This is a naming fix, not a model change: renaming
 * it while also altering it would have made the diff impossible to review.
 *
 * See `src/lib/models/edgeDisclosure.ts` for what may and may not be claimed
 * about this number.
 */
export function scarcityGap(player: PlayerMarketRecord): number {
  return round(player.trueValue - player.perceivedValue + player.ownershipLeverage * 0.18 - player.fragility * 0.08);
}

export function valuationGap(player: PlayerMarketRecord): number {
  return round(Math.abs(player.trueValue - player.perceivedValue) * player.confidence + Math.max(0, player.ownershipLeverage) * 0.12);
}

export function narrativeVelocity(player: PlayerMarketRecord): number {
  return round(player.trendingMomentum * 0.54 + player.volatility * 0.28 - player.fragility * 0.11);
}

export function chaosExposure(player: PlayerMarketRecord): number {
  return round(player.volatility * 0.45 + player.fragility * 0.4 + Math.abs(player.trendingMomentum) * 0.15);
}

export function liquidityScore(player: PlayerMarketRecord): number {
  return round((player.opportunity * 0.6 + valuationGap(player) * 0.4) / 10);
}

/*
 * REMOVED 2026-08-26 — `confidenceInterval(center, confidence)`.
 *
 * It returned `center ± (1 - confidence) * 18` and was rendered as `[lo, hi]`
 * immediately after `trueValue` in the Market Intelligence table, where a
 * bracketed pair beside a point estimate reads as an interval estimate. It was
 * not one. There was no sampling distribution behind it, no coverage guarantee
 * and no relationship to any stated level — just a magic 18-point half-width
 * scaled by a heuristic `confidence` (itself `1 - min(rank_std, 30) / 30`).
 *
 * The 2026-06-09 quant audit found this and recommended removing or relabelling
 * it (`reports/audit-2026-06-09/02-quant-audit.md:37,69`, item 6 / S1). The
 * recommendation was recorded and never executed; it shipped for another two
 * and a half months. Closing it now.
 *
 * WHY NOTHING REPLACES IT. A real dispersion band is not derivable from the
 * inputs on hand. FantasyPros gives `rank_std` — genuine expert disagreement —
 * but in OVERALL rank units, while `ecrToTrueValue` is a function of POSITIONAL
 * rank. Pushing an overall-rank sigma through a positional-rank transform is a
 * unit error, which is the class of bug `npm run check:projection-units` exists
 * to catch. Converting between the two depends on how other positions interleave
 * and would be an assumption nobody has measured.
 *
 * So the expert-disagreement signal stays where it is already traceable: as
 * `volatility` (`stdToVolatility`, `enrich.ts:123`), shown on the Player
 * Universe metric radar. Fabricating a second, prettier version of it next to
 * `trueValue` is what caused this.
 */

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
