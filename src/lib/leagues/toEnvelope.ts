import type { RAEEnvelope, SourceMeta } from "../governance";
import type { LiveLeagueSnapshot } from "./fetchLive";
import type { FpEcrData, FpScoring } from "../fantasypros/types";
import { buildFpIndex, enrichRoster } from "../fantasypros/enrich";

// Convert a live league snapshot + FantasyPros rankings into the RAEEnvelope
// shape that RaeApp + every panel consume. The output envelope has:
//   - mode: "live" when both snapshot and rankings are present
//   - records: the user's own roster (15-20 players typically), enriched with
//     behavioral-market fields from FantasyPros consensus rankings
//   - sourceState: composite metadata declaring which fields are still missing
//
// We use the user's own roster (not all 10-12 rosters flattened) because every
// panel's derivation function averages across records — averaging across all
// 150+ rostered players in the league dilutes the signal too much for the
// "your team" framing the UI implies.

export interface BuildEnvelopeOptions {
  snapshot: LiveLeagueSnapshot;
  rankings: FpEcrData | null;
  /** When null, the envelope falls back to identity-only mode. */
  rankingsSource: SourceMeta;
  /** Optional Sleeper trending-adds map keyed by sleeper player_id. */
  trendingAdds?: Map<string, number>;
  /** Optional Sleeper trending-drops map. */
  trendingDrops?: Map<string, number>;
  /** Weekly projected pts_ppr keyed by sleeper player_id. Off-season / pre-cron: absent. */
  weeklyProjections?: Record<string, number> | null;
  /** Metadata about the weekly projection snapshot (season, week, fetchedAt). */
  weeklyProjectionsMeta?: { season: string; week: number; fetchedAt: string } | null;
  /**
   * Recency-weighted ESPN headline-velocity scores (sleeperId → 0-100).
   * When provided, overrides the Sleeper-trending proxy as the trendingMomentum
   * source. Sleeper proxy stays as fallback when this is absent.
   */
  newsMomentumScores?: Record<string, number> | null;
}

export function buildLiveEnvelope({
  snapshot,
  rankings,
  rankingsSource,
  trendingAdds,
  trendingDrops,
  weeklyProjections,
  weeklyProjectionsMeta,
  newsMomentumScores
}: BuildEnvelopeOptions): RAEEnvelope {
  if (!rankings) {
    // No rankings cached yet — still emit live mode with the identity-only
    // roster. Panels will read source.missingFields and show "—" everywhere.
    return {
      mode: "live",
      generatedAt: new Date().toISOString(),
      records: snapshot.myRoster,
      sourceState: degradedSourceState(snapshot.source, rankingsSource),
      leagueFormat: snapshot.format,
      weeklyProjections: weeklyProjections ?? null,
      weeklyProjectionsMeta: weeklyProjectionsMeta ?? null
    };
  }

  const index = buildFpIndex(rankings.players);
  const enriched = enrichRoster(snapshot.myRoster, rankings, index, {
    rankingsSource,
    trendingAdds,
    trendingDrops,
    newsMomentumScores
  });

  // Composite source metadata. Freshness = the worse of the two upstream
  // sources; missingFields = union (so panels still mark trending /
  // opportunity as unavailable even though ECR populated the others).
  // When the trending proxy is wired, trending_momentum is no longer
  // missing — but opportunity always is (no in-season data pre-draft).
  const newsActive = !!(newsMomentumScores && Object.keys(newsMomentumScores).length > 0);
  const proxyActive = !!(trendingAdds && trendingDrops);
  const trendingActive = newsActive || proxyActive;
  const rankingsMissing = trendingActive
    ? rankingsSource.missingFields.filter((f) => f !== "trending_momentum")
    : rankingsSource.missingFields;
  const missingUnion = Array.from(
    new Set([...snapshot.source.missingFields, ...rankingsMissing])
  );
  const compositeFreshness =
    snapshot.source.freshness === "fresh" && rankingsSource.freshness === "fresh"
      ? "fresh"
      : "stale";

  return {
    mode: "live",
    generatedAt: new Date().toISOString(),
    records: enriched,
    sourceState: {
      source: `${snapshot.source.source} + ${rankingsSource.source}`,
      fetchedAt: rankingsSource.fetchedAt,
      ttlSeconds: Math.min(snapshot.source.ttlSeconds, rankingsSource.ttlSeconds),
      freshness: compositeFreshness,
      confidence: Math.min(snapshot.source.confidence, rankingsSource.confidence),
      validation: "valid",
      missingFields: missingUnion,
      assumptions: newsActive
        ? [
            "Identity from Sleeper, behavioral-market fields from FantasyPros ECR.",
            "trending_momentum from ESPN headline velocity (recency-weighted, 72h window). Not NLP sentiment classification.",
            "In-season opportunity not derived; declared in missingFields."
          ]
        : proxyActive
          ? [
              "Identity from Sleeper, behavioral-market fields from FantasyPros ECR.",
              "trending_momentum proxied from Sleeper 24h trending adds/drops; not news/sentiment classification.",
              "In-season opportunity not derived; declared in missingFields."
            ]
          : [
              "Identity from Sleeper, behavioral-market fields from FantasyPros ECR.",
              "Trending momentum and in-season opportunity not derived; declared in missingFields."
            ],
      failure: null
    },
    leagueFormat: snapshot.format,
    weeklyProjections: weeklyProjections ?? null,
    weeklyProjectionsMeta: weeklyProjectionsMeta ?? null
  };
}

function degradedSourceState(
  identity: SourceMeta,
  rankings: SourceMeta
): SourceMeta {
  return {
    source: `${identity.source} (rankings cache empty)`,
    fetchedAt: identity.fetchedAt,
    ttlSeconds: identity.ttlSeconds,
    freshness: identity.freshness,
    confidence: identity.confidence,
    validation: identity.validation,
    missingFields: Array.from(
      new Set([
        ...identity.missingFields,
        ...rankings.missingFields,
        "market_value",
        "true_value",
        "ownership"
      ])
    ),
    assumptions: identity.assumptions,
    failure: rankings.failure
  };
}

/** Helper for callers that have just loaded a snapshot row from the DB. */
export function rankingsSourceFromSnapshot(
  scoring: FpScoring,
  fetchedAt: Date | null,
  failure: string | null = null
): SourceMeta {
  return {
    source: `FantasyPros ${scoring} consensus rankings`,
    fetchedAt: fetchedAt ? fetchedAt.toISOString() : null,
    ttlSeconds: 24 * 60 * 60,
    freshness: fetchedAt && Date.now() - fetchedAt.getTime() <= 30 * 60 * 60 * 1000 ? "fresh" : "stale",
    confidence: 0.85,
    validation: "valid",
    missingFields: ["trending_momentum", "opportunity"],
    assumptions: [
      "FantasyPros ECR / ADP via public consensus-cheatsheet HTML scrape. Daily cron at 08:30 UTC."
    ],
    failure
  };
}
