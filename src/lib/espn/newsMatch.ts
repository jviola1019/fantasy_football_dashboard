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

import { z } from "zod";
import type { EspnNewsArticle } from "./news";
import { extractAthleteRefs } from "./news";

type SleeperPlayerLike = {
  player_id?: string;
  [key: string]: unknown;
};

/**
 * Build the espnAthleteId → sleeperId reverse map from the Sleeper catalog.
 *
 * Shared by the momentum weighting and the headline index so the two can never
 * match different sets of players: a headline the score counted must be a
 * headline the reader can see, and vice versa.
 */
function espnToSleeperMap(players: Record<string, SleeperPlayerLike>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [sleeperId, player] of Object.entries(players)) {
    const rawEspnId = (player as Record<string, unknown>).espn_id;
    if (rawEspnId == null) continue;
    const espnId =
      typeof rawEspnId === "number"
        ? rawEspnId
        : typeof rawEspnId === "string"
          ? parseInt(rawEspnId, 10)
          : NaN;
    if (!isNaN(espnId) && espnId > 0) out.set(espnId, sleeperId);
  }
  return out;
}

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
  const espnToSleeper = espnToSleeperMap(players);

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

// ---------------------------------------------------------------------------
// The headlines themselves
//
// S4. Until now this module reduced 100 articles to one number per player and
// discarded the articles. The cron fetched real, attributable, freshly-dated
// NFL news every morning at 09:20 and the product showed none of it — while
// `/players` displayed a "Trending" figure derived from it with no way to see
// what moved.
// ---------------------------------------------------------------------------

/**
 * One headline, ready to render.
 *
 * A zod schema rather than an interface because these travel inside
 * `RAEEnvelope`, which is validated at its boundary.
 */
export const PlayerNewsItemSchema = z.object({
  /** ESPN's article id — the dedupe key, and stable across snapshots. */
  articleId: z.number().int(),
  headline: z.string(),
  /**
   * ESPN's `published` timestamp, falling back to `lastModified` when the feed
   * omits it. NOTE this is deliberately not always the same field the momentum
   * weighting reads: that uses `lastModified`, because a re-modified article is
   * renewed attention, whereas a reader asking "how old is this news" means
   * when it was published. The UI says which it is showing.
   */
  publishedAt: z.string(),
  /** `links.web.href`, or null when ESPN published no web link for the article. */
  url: z.string().url().nullable()
});
export type PlayerNewsItem = z.infer<typeof PlayerNewsItemSchema>;

/** Headlines keyed by `PlayerMarketRecord.id` — see the key-form note below. */
export const PlayerNewsIndexSchema = z.record(z.string(), z.array(PlayerNewsItemSchema));
export type PlayerNewsIndex = z.infer<typeof PlayerNewsIndexSchema>;

/** Ceiling per player. Four is a screenful; the tail is rarely decision-relevant. */
export const MAX_NEWS_PER_PLAYER = 4;

/**
 * Group the snapshot's articles by the players they mention.
 *
 * **Keys are `sleeper:<id>` — the `PlayerMarketRecord.id` form — deliberately,
 * and unlike its sibling `buildNewsWeightMap`, which keys bare.** That
 * asymmetry is the direct lesson of audit finding D-A: the weight map keyed
 * bare, its one consumer looked up by record id, the lookup missed on every
 * player in the catalog, and the product spent months announcing an ESPN
 * provenance for a Sleeper number. This index is consumed by components holding
 * a record, so it is keyed the way those components will ask for it, and
 * `newsForPlayer` tolerates either form for anything that asks differently.
 *
 * Unmatched athletes contribute nothing — a player Sleeper has no `espn_id` for
 * simply has no news here, and the UI says "no coverage" rather than inventing
 * any.
 */
export function buildPlayerNewsIndex(
  articles: EspnNewsArticle[],
  players: Record<string, SleeperPlayerLike>,
  { maxPerPlayer = MAX_NEWS_PER_PLAYER }: { maxPerPlayer?: number } = {}
): PlayerNewsIndex {
  const espnToSleeper = espnToSleeperMap(players);
  const byId = new Map<number, EspnNewsArticle>();
  for (const a of articles) byId.set(a.id, a);

  const grouped = new Map<string, PlayerNewsItem[]>();
  const seen = new Set<string>();
  for (const { athleteId, articleId } of extractAthleteRefs(articles)) {
    const sleeperId = espnToSleeper.get(athleteId);
    if (!sleeperId) continue;
    const key = `sleeper:${sleeperId}`;
    // An article listing the same athlete twice must not appear twice.
    const pairKey = `${key}|${articleId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const article = byId.get(articleId);
    if (!article) continue;
    const publishedAt = article.published ?? article.lastModified;
    // An unparseable timestamp would render as "NaN ago". Drop the item rather
    // than show a headline whose age we cannot state.
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) continue;
    const href = article.links?.web?.href ?? null;
    const list = grouped.get(key) ?? [];
    list.push({
      articleId,
      headline: article.headline,
      publishedAt: new Date(publishedAt).toISOString(),
      // Only absolute http(s) URLs survive: the schema requires a real URL, and
      // a relative or malformed href would fail envelope validation for the
      // whole payload rather than for one link.
      url: href && /^https?:\/\//i.test(href) ? href : null
    });
    grouped.set(key, list);
  }

  const out: PlayerNewsIndex = {};
  for (const [key, list] of grouped) {
    list.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    out[key] = list.slice(0, maxPerPlayer);
  }
  return out;
}

// `newsForPlayer` — the record-id-tolerant reader for the index above — lives in
// `./newsLookup`, which imports NO zod. It is the only part of this pipeline a
// client component calls, and a runtime import of this module would ship zod to
// the browser. See the note there.
