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
}

export function buildLiveEnvelope({
  snapshot,
  rankings,
  rankingsSource
}: BuildEnvelopeOptions): RAEEnvelope {
  if (!rankings) {
    // No rankings cached yet — still emit live mode with the identity-only
    // roster. Panels will read source.missingFields and show "—" everywhere.
    return {
      mode: "live",
      generatedAt: new Date().toISOString(),
      records: snapshot.myRoster,
      sourceState: degradedSourceState(snapshot.source, rankingsSource),
      leagueFormat: snapshot.format
    };
  }

  const index = buildFpIndex(rankings.players);
  const enriched = enrichRoster(snapshot.myRoster, rankings, index, {
    rankingsSource
  });

  // Composite source metadata. Freshness = the worse of the two upstream
  // sources; missingFields = union (so panels still mark narrative /
  // opportunity as unavailable even though ECR populated the others).
  const missingUnion = Array.from(
    new Set([...snapshot.source.missingFields, ...rankingsSource.missingFields])
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
      assumptions: [
        "Identity from Sleeper, behavioral-market fields from FantasyPros ECR.",
        "Narrative pressure and in-season opportunity not derived; declared in missingFields."
      ],
      failure: null
    },
    leagueFormat: snapshot.format
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
    missingFields: ["narrative_pressure", "opportunity"],
    assumptions: [
      "FantasyPros ECR / ADP via public consensus-cheatsheet HTML scrape. Daily cron at 08:30 UTC."
    ],
    failure
  };
}
