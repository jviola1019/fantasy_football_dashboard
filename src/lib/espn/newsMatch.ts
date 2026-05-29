// Maps ESPN athlete IDs to Sleeper player IDs using the `espn_id` field
// present on every Sleeper player record (exposed via the passthrough schema).
//
// Recency weighting — applied per article, not per mention:
//   0–24h  → weight 1.0
//   24–48h → weight 0.5
//   48–72h → weight 0.25
//   >72h   → excluded
//
// The resulting map feeds the trendingMomentum field in enrichWithFp.
// Unmapped athletes (no espn_id link in the Sleeper catalog) contribute 0
// to no player's score — we never fabricate.

import type { EspnNewsArticle } from "./news";
import { extractAthleteRefs } from "./news";

type SleeperPlayerLike = {
  player_id?: string;
  [key: string]: unknown;
};

const HOUR_MS = 60 * 60 * 1000;
const WEIGHTS: Array<{ maxAgeMs: number; weight: number }> = [
  { maxAgeMs: 24 * HOUR_MS, weight: 1.0 },
  { maxAgeMs: 48 * HOUR_MS, weight: 0.5 },
  { maxAgeMs: 72 * HOUR_MS, weight: 0.25 }
];

function articleWeight(lastModified: string, nowMs: number): number | null {
  const articleMs = Date.parse(lastModified);
  if (isNaN(articleMs)) return null;
  const ageMs = nowMs - articleMs;
  for (const { maxAgeMs, weight } of WEIGHTS) {
    if (ageMs <= maxAgeMs) return weight;
  }
  return null; // older than 72h — drop
}

/**
 * Build a Map<sleeperId, recencyWeightedCount> from a list of ESPN articles
 * and the Sleeper players catalog.
 *
 * Each article that mentions an athlete contributes its recency weight once
 * to that player's total. The resulting scores are NOT normalised — callers
 * normalise to the [-100, 100] trendingMomentum scale.
 *
 * @param articles  Articles returned by fetchEspnNews
 * @param players   Sleeper players map (playerId → player object), as
 *                  returned by the players snapshot payload.
 * @param nowMs     Current timestamp in ms (injectable for tests)
 */
export function buildNewsWeightMap(
  articles: EspnNewsArticle[],
  players: Record<string, SleeperPlayerLike>,
  nowMs: number = Date.now()
): Map<string, number> {
  // Build reverse map: espnAthleteId (string) → sleeperId
  const espnToSleeper = new Map<number, string>();
  for (const [sleeperId, player] of Object.entries(players)) {
    const rawEspnId = (player as Record<string, unknown>).espn_id;
    if (rawEspnId == null) continue;
    const espnId =
      typeof rawEspnId === "number"
        ? rawEspnId
        : typeof rawEspnId === "string"
          ? parseInt(rawEspnId, 10)
          : NaN;
    if (!isNaN(espnId) && espnId > 0) {
      espnToSleeper.set(espnId, sleeperId);
    }
  }

  const refs = extractAthleteRefs(articles);
  const scores = new Map<string, number>();

  for (const { athleteId, lastModified } of refs) {
    const sleeperId = espnToSleeper.get(athleteId);
    if (!sleeperId) continue; // unmapped — never fabricate
    const w = articleWeight(lastModified, nowMs);
    if (w === null) continue; // older than 72h — drop
    scores.set(sleeperId, (scores.get(sleeperId) ?? 0) + w);
  }

  return scores;
}

/**
 * Normalise the raw weighted counts into the [-100, 100] trendingMomentum
 * range. Players not mentioned score 0 (neutral). The max observed score
 * maps to 100; we never go negative because news mentions are always
 * non-negative (a mention is attention, not anti-attention).
 *
 * Returns a plain record for easy merge into PlayerMarketRecord.
 */
export function normaliseMomentumScores(
  weightMap: Map<string, number>
): Record<string, number> {
  if (weightMap.size === 0) return {};
  const max = Math.max(...weightMap.values());
  if (max <= 0) return {};
  const out: Record<string, number> = {};
  for (const [sleeperId, score] of weightMap.entries()) {
    out[sleeperId] = Math.round((score / max) * 100);
  }
  return out;
}
