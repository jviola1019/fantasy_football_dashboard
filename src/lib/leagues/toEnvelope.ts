import type { RAEEnvelope, SourceMeta, PlayerMarketRecord } from "../governance";
import type { LiveLeagueSnapshot } from "./fetchLive";
import type { FpEcrData, FpScoring } from "../fantasypros/types";
import type { SleeperPlayersMap } from "../sleeper/schemas";
import { buildFpIndex, enrichRoster, fpDataToRecords } from "../fantasypros/enrich";
import {
  detectSleeperDraftState,
  detectEspnDraftState,
  anyRosterNonEmpty,
  type DraftState
} from "./draftState";
import { resolveSleeperSeasonMirror, resolveEspnSeasonMirror, type SeasonMirror } from "./mirrorLeague";
import { buildLeagueUniverse, buildFreeAgents, UNIVERSE_LIMIT } from "./buildUniverse";
import { normalizeOppName, type OpportunityMap } from "../nflverse/opportunity";
import type { WeeklyProjectionByFormat } from "./scoringPoints";

/**
 * Stamp the FREE nflverse opportunity score (snap share, 0-100) onto records by
 * normalized name. Records without a match keep their existing opportunity
 * (0/declared-missing). Pure — returns a new array.
 */
function withOpportunity(records: PlayerMarketRecord[], scores: OpportunityMap | null): PlayerMarketRecord[] {
  if (!scores) return records;
  return records.map((r) => {
    const s = scores[normalizeOppName(r.name)];
    return s ? { ...r, opportunity: s.score } : r;
  });
}

// Convert a live league snapshot + FantasyPros rankings into the RAEEnvelope
// shape that deriveAppData + every route panel consume. The output envelope has:
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
  /**
   * Weekly projections keyed by sleeper player_id, carrying all three scoring
   * variants (audit 2026-08-20 §7) so the unit is chosen at the simulation
   * boundary rather than here. Off-season / pre-cron: absent.
   */
  weeklyProjections?: Record<string, WeeklyProjectionByFormat> | null;
  /** Metadata about the weekly projection snapshot (season, week, fetchedAt). */
  weeklyProjectionsMeta?: { season: string; week: number; fetchedAt: string } | null;
  /**
   * Recency-weighted ESPN headline-velocity scores (sleeperId → 0-100).
   * When provided, overrides the Sleeper-trending proxy as the trendingMomentum
   * source. Sleeper proxy stays as fallback when this is absent.
   */
  newsMomentumScores?: Record<string, number> | null;
  /**
   * The full Sleeper players map (from the daily snapshot). When present with
   * rankings, the envelope builds `leagueUniverse` + `freeAgents` (Sprint 5).
   */
  playersSnapshot?: SleeperPlayersMap | null;
  /** Current NFL season ("2026") for the season-mirror. Defaults to the league's own season. */
  currentSeason?: string;
  /** FREE nflverse opportunity scores (normalized-name → snap-share 0-100). When
   * present, `opportunity` is stamped onto records and dropped from missingFields. */
  opportunityScores?: OpportunityMap | null;
}

/**
 * Derive draft-state + the completed/upcoming season pair from the snapshot's
 * raw league payload. Platform-aware (Sleeper status/chain vs. ESPN roster-fill).
 */
function deriveLeagueMeta(
  snapshot: LiveLeagueSnapshot,
  currentSeason: string
): { draftState: DraftState; season: SeasonMirror } {
  const raw = snapshot.leagueRawData ?? {};
  if (snapshot.league.platform === "sleeper") {
    const status = typeof raw.status === "string" ? raw.status : null;
    const leagueSeason = typeof raw.season === "string" ? raw.season : String(snapshot.league.season);
    const prev = typeof raw.previous_league_id === "string" ? raw.previous_league_id : null;
    return {
      draftState: detectSleeperDraftState(status, snapshot.draftStatus, anyRosterNonEmpty(snapshot.allRosters)),
      season: resolveSleeperSeasonMirror(status, leagueSeason, prev, currentSeason)
    };
  }
  const expected = snapshot.format
    ? Object.values(snapshot.format.starters).reduce((s, n) => s + n, 0)
    : 0;
  const draftState = detectEspnDraftState(snapshot.allRosters, expected);
  return { draftState, season: resolveEspnSeasonMirror(snapshot.league.season, draftState) };
}

export function buildLiveEnvelope({
  snapshot,
  rankings,
  rankingsSource,
  trendingAdds,
  trendingDrops,
  weeklyProjections,
  weeklyProjectionsMeta,
  newsMomentumScores,
  playersSnapshot,
  currentSeason,
  opportunityScores
}: BuildEnvelopeOptions): RAEEnvelope {
  const season0 = currentSeason ?? String(snapshot.league.season);
  const { draftState, season } = deriveLeagueMeta(snapshot, season0);
  const oppScores = opportunityScores ?? null;
  const opportunityActive = !!(oppScores && Object.keys(oppScores).length > 0);
  const allRosters = snapshot.allRosters.map((r) => withOpportunity(r, oppScores));

  // Build the league universe + free agents when both the players snapshot and
  // rankings are present. Capped + value-sorted to keep the payload bounded.
  let leagueUniverse: PlayerMarketRecord[] | null = null;
  let freeAgents: PlayerMarketRecord[] | null = null;
  // Disclosure string when the universe / free-agent lists are capped for payload.
  let universeNote: string | null = null;
  if (playersSnapshot && rankings) {
    const full = withOpportunity(
      buildLeagueUniverse(playersSnapshot, rankings, {
        rankingsSource,
        trendingAdds,
        trendingDrops,
        newsMomentumScores,
        // The draftable universe must use the SAME replacement level as the
        // roster, or the draft board and the roster would be priced on
        // different baselines (audit F-010).
        format: snapshot.format ?? undefined
      }),
      oppScores
    );
    const sortedFull = [...full].sort((a, b) => b.trueValue - a.trueValue);
    leagueUniverse = sortedFull.slice(0, UNIVERSE_LIMIT);
    // Free agents must come from the FULL universe minus rostered players, THEN
    // be capped — deriving from the display-capped leagueUniverse would hide a
    // genuinely-available player ranked past the cap (DAT-01).
    const allFreeAgents = buildFreeAgents(sortedFull, allRosters);
    freeAgents = allFreeAgents.slice(0, UNIVERSE_LIMIT);
    if (sortedFull.length > UNIVERSE_LIMIT || allFreeAgents.length > UNIVERSE_LIMIT) {
      universeNote = `Universe and free-agent lists show the top ${UNIVERSE_LIMIT} by value (of ${sortedFull.length} active players, ${allFreeAgents.length} unrostered); deeper low-value players are omitted from the payload.`;
    }
  }
  if (!rankings) {
    // No rankings cached yet — still emit live mode with the identity-only
    // roster. Panels will read source.missingFields and show "—" everywhere.
    return {
      mode: "live",
      generatedAt: new Date().toISOString(),
      records: withOpportunity(snapshot.myRoster, oppScores),
      sourceState: degradedSourceState(snapshot.source, rankingsSource),
      leagueFormat: snapshot.format,
      weeklyProjections: weeklyProjections ?? null,
      weeklyProjectionsMeta: weeklyProjectionsMeta ?? null,
      draftPool: null,
      // No rankings ⇒ no value-enriched universe; still expose real structure.
      draftState,
      season,
      leagueUniverse: null,
      freeAgents: null,
      allRosters
    };
  }

  const index = buildFpIndex(rankings.players);
  const enriched = enrichRoster(snapshot.myRoster, rankings, index, {
    rankingsSource,
    trendingAdds,
    trendingDrops,
    newsMomentumScores,
    // Replacement level (and therefore trueValue) is derived from the league's
    // real starters — audit F-010. Without this the roster would be valued
    // against a 12-team 1QB baseline no matter what league it belongs to.
    format: snapshot.format ?? undefined
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
  // opportunity is no longer missing once the FREE nflverse snap-share map is
  // applied (it's a role proxy, declared as such in the assumptions).
  const rankingsMissing2 = opportunityActive
    ? rankingsMissing.filter((f) => f !== "opportunity")
    : rankingsMissing;
  // A roster substitution must reach the user. `identityNote` is non-null only
  // when ANOTHER team's roster is standing in for theirs, which would otherwise
  // be invisible: every panel would compute against a stranger's team while the
  // source read `validation: "valid"`. Audit 2026-08-22.
  const identityFailure = snapshot.identityNote;

  const missingUnion = Array.from(
    new Set([...snapshot.source.missingFields, ...rankingsMissing2])
  ).filter((f) => !(opportunityActive && f === "opportunity"));
  const compositeFreshness =
    snapshot.source.freshness === "fresh" && rankingsSource.freshness === "fresh"
      ? "fresh"
      : "stale";

  const trendingAssumption = newsActive
    ? "trending_momentum from ESPN headline velocity (recency-weighted, 72h window). Not NLP sentiment classification."
    : proxyActive
      ? "trending_momentum proxied from Sleeper 24h trending adds/drops; not news/sentiment classification."
      : "Trending momentum not derived; declared in missingFields.";
  const opportunityAssumption = opportunityActive
    ? "opportunity = nflverse snap share (free, CC-BY) — a real role/usage proxy from the latest season's games."
    : "In-season opportunity not derived; declared in missingFields.";

  return {
    mode: "live",
    generatedAt: new Date().toISOString(),
    records: withOpportunity(enriched, oppScores),
    sourceState: {
      source: `${snapshot.source.source} + ${rankingsSource.source}${opportunityActive ? " + nflverse snaps" : ""}`,
      fetchedAt: rankingsSource.fetchedAt,
      ttlSeconds: Math.min(snapshot.source.ttlSeconds, rankingsSource.ttlSeconds),
      freshness: compositeFreshness,
      confidence: Math.min(snapshot.source.confidence, rankingsSource.confidence),
      validation: "valid",
      missingFields: missingUnion,
      assumptions: [
        "Identity from Sleeper, behavioral-market fields from FantasyPros ECR.",
        trendingAssumption,
        opportunityAssumption,
        ...(universeNote ? [universeNote] : []),
        // Stated as an ASSUMPTION too, not only a failure string: the roster
        // this envelope describes is an input to every downstream number, so a
        // reader auditing assumptions must see it there.
        ...(identityFailure ? [identityFailure] : [])
      ],
      // Surfaced through the existing failure channel, which GovernanceBanner,
      // GovernancePanel and TeamSignals already render. A declared substitution
      // nobody sees is no better than a silent one.
      failure: identityFailure
    },
    leagueFormat: snapshot.format,
    weeklyProjections: weeklyProjections ?? null,
    weeklyProjectionsMeta: weeklyProjectionsMeta ?? null,
    // The full FantasyPros-ranked pool so the draft panel can draft any player.
    draftPool: withOpportunity(fpDataToRecords(rankings, rankingsSource), oppScores),
    // Sprint 5: league-universe / season-mirror.
    draftState,
    season,
    leagueUniverse,
    freeAgents,
    allRosters
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
