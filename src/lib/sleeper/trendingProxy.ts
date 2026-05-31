// Sleeper trending adds/drops -> trendingMomentum proxy.
//
// Sprint 3 (B1) renamed the field from narrativePressure to trendingMomentum
// to clarify what the value actually represents — roster-move-driven momentum,
// not news/sentiment. Sprint 3 (B5) then made real ESPN news article-velocity
// the PREFERRED SOURCE of that same trendingMomentum field, with this Sleeper
// add/drop proxy kept only as the fallback. There is no separate
// narrativePressure field in PlayerMarketRecordSchema — the two sources feed one
// field (see fantasypros/enrich.ts and espn/newsMatch.ts for the priority ladder).
//
// Sleeper exposes trending adds/drops over the last N hours, which is a
// *roster-move* signal: a player who's being added a lot more than dropped in
// the last 24h is the kind of player a fantasy manager is reading about. We
// keep this as the trendingMomentum signal; the disclosure is surfaced in two
// places:
//   1. SourceMeta.assumptions in toEnvelope.ts (machine-readable)
//   2. NarrativeEngine.tsx (user-visible disclosure note)
//
// This module is pure — no I/O. The caller (src/app/page.tsx) fetches the
// trending data via getTrendingPlayers and passes the maps in.

import type { PlayerMarketRecord } from "../governance";

/**
 * Map a player's trending count to a [-100, 100] trendingMomentum score.
 *
 * Positive when adds > drops (player is "rising"). Negative when drops > adds
 * (player is "falling"). Magnitude scales by the max count across the
 * trending pool — the player with the highest add count gets ~+100, the
 * player with the highest drop count gets ~-100.
 *
 * Returns 0 for any player not present in either trending list, so absent
 * players carry no signal rather than artificial zeros.
 */
export function trendingMomentumFromProxy(
  player: Pick<PlayerMarketRecord, "id">,
  trendingAdds: Map<string, number>,
  trendingDrops: Map<string, number>,
  maxAdds?: number,
  maxDrops?: number
): number {
  // The record id is "sleeper:<player_id>"; trending maps are keyed by the
  // bare Sleeper player_id, so strip the prefix.
  const sleeperId = player.id.startsWith("sleeper:") ? player.id.slice("sleeper:".length) : player.id;
  const adds = trendingAdds.get(sleeperId) ?? 0;
  const drops = trendingDrops.get(sleeperId) ?? 0;
  if (adds === 0 && drops === 0) return 0;
  // Use a single global denominator (max of either side) so the signed
  // delta stays on the same scale. Normalising each side independently
  // would zero out a player who is simultaneously top-adder and top-dropper
  // even though such a player has high trending momentum (just ambiguous
  // sign). max(adds, drops) keeps the sign meaningful.
  const addsMax = maxAdds ?? Math.max(1, ...Array.from(trendingAdds.values()));
  const dropsMax = maxDrops ?? Math.max(1, ...Array.from(trendingDrops.values()));
  const globalMax = Math.max(addsMax, dropsMax, 1);
  const pressure = ((adds - drops) / globalMax) * 100;
  return Math.max(-100, Math.min(100, Math.round(pressure)));
}

/**
 * Build add/drop lookup maps from the raw Sleeper trending API shape.
 * Each item in the input list is `{ player_id: string, count: number }`.
 */
export function buildTrendingMap(
  list: ReadonlyArray<{ player_id: string; count: number }> | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  if (!list) return map;
  for (const item of list) {
    if (!item || !item.player_id) continue;
    map.set(item.player_id, Number.isFinite(item.count) ? item.count : 0);
  }
  return map;
}
