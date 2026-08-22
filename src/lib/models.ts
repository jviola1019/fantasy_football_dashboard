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

export function marketInefficiency(player: PlayerMarketRecord): number {
  return round(Math.abs(player.trueValue - player.perceivedValue) * player.confidence + Math.max(0, player.ownershipLeverage) * 0.12);
}

export function narrativeVelocity(player: PlayerMarketRecord): number {
  return round(player.trendingMomentum * 0.54 + player.volatility * 0.28 - player.fragility * 0.11);
}

export function chaosExposure(player: PlayerMarketRecord): number {
  return round(player.volatility * 0.45 + player.fragility * 0.4 + Math.abs(player.trendingMomentum) * 0.15);
}

export function liquidityScore(player: PlayerMarketRecord): number {
  return round((player.opportunity * 0.6 + marketInefficiency(player) * 0.4) / 10);
}

export function confidenceInterval(center: number, confidence: number): [number, number] {
  const width = (1 - confidence) * 18;
  return [round(Math.max(0, center - width)), round(Math.min(100, center + width))];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
