import type { PlayerMarketRecord, SourceMeta } from "../governance";
import type { FpEcrData, FpPlayer } from "./types";
import type { FpIndex } from "./match";
import { buildFpIndex, matchSleeperToFp } from "./match";
import { narrativePressureFromTrending } from "../sleeper/trendingProxy";

// Map a FantasyPros ranking entry into the behavioral-market fields of
// PlayerMarketRecord. The transform is intentionally simple — invert the
// rank and normalize to 0-100 for perceivedValue, derive trueValue from
// positional VBD, and pass through ownership / variance / bye-week
// directly. Anything we can't compute from rankings (narrativePressure,
// opportunity) stays 0 and the SourceMeta declares it missing.

const PPR_BEHAVIORAL_FIELDS = [
  "narrative_pressure", // requires news sentiment adapter
  "opportunity" // requires in-season target/snap data
];

// Average across all rated positions per scoring format. Used so VBD
// numbers are comparable league-wide rather than per-position-only.
function positionReplacementRank(
  position: PlayerMarketRecord["position"],
  scoring: "STD" | "PPR" | "HALF"
): number {
  // Approximate starter+bench replacement for a 12-team league at each pos.
  // QB: 12 starters, ~16-18 rostered → replacement around 18-20.
  // RB: 24 starters + ~2 flex + bench → replacement ~36.
  // WR: 24 starters + ~2 flex + bench → replacement ~40.
  // TE: 12 starters + bench → replacement ~16.
  // K/DEF: 12 starters, single per team → replacement ~12.
  const base: Record<PlayerMarketRecord["position"], number> = {
    QB: 18,
    RB: 36,
    WR: 40,
    TE: 16,
    K: 12,
    DEF: 12
  };
  // PPR boosts WR/TE replacement levels marginally because more pass-
  // catchers stay startable.
  const pprAdjust = scoring === "PPR" ? { WR: 4, TE: 2 } : scoring === "HALF" ? { WR: 2, TE: 1 } : { WR: 0, TE: 0 };
  if (position === "WR") return base.WR + pprAdjust.WR;
  if (position === "TE") return base.TE + pprAdjust.TE;
  return base[position];
}

/**
 * Build a perceivedValue (0-100) from an ECR rank. Top player = 100,
 * replacement-level player at the same position = 50, deeper than
 * replacement scales down toward 0. Bounded so we never emit values
 * outside the schema range.
 */
export function ecrToPerceivedValue(rank_ecr: number, maxRank: number): number {
  if (maxRank <= 1) return 0;
  const pct = 1 - (rank_ecr - 1) / (maxRank - 1);
  return Math.max(0, Math.min(100, Math.round(pct * 100)));
}

/**
 * trueValue is positional VBD: how much better is this player than the
 * replacement-level player at the same position. Replacement gets 50,
 * better than replacement gets higher, worse gets lower. Bounded 0-100.
 */
export function ecrToTrueValue(
  rank_ecr: number,
  posRank: number,
  replacementPosRank: number
): number {
  // Convert pos rank advantage into a 0-100 scale anchored at 50 for replacement.
  const advantage = (replacementPosRank - posRank) / replacementPosRank;
  const raw = 50 + advantage * 50;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * volatility comes from rank_std (expert disagreement). A std of 0 means
 * every expert ranked the player identically (highly confident); a std of
 * 20+ means experts wildly disagree (volatile draft-day asset).
 */
export function stdToVolatility(rank_std: number): number {
  // Empirically rank_std rarely exceeds 30 across the player pool.
  const pct = Math.min(rank_std, 30) / 30;
  return Math.round(pct * 100);
}

/**
 * ownershipLeverage is signed: positive means owned more than average
 * (consensus love), negative means owned less (contrarian opportunity).
 * Centered at the median ownership for the scoring format.
 */
export function ownershipToLeverage(owned: number | null | undefined, medianOwned: number): number {
  if (owned == null) return 0;
  const delta = owned - medianOwned;
  // Most of the curve sits in ±40 so scale that to ±100 for visual contrast.
  return Math.max(-100, Math.min(100, Math.round((delta / 40) * 100)));
}

export interface EnrichOptions {
  /** Source metadata to attach to enriched records. */
  rankingsSource: SourceMeta;
  /** Median ownership % for the scoring format. Pass 0 if you want raw delta. */
  medianOwnership?: number;
  /**
   * Sleeper trending-adds map keyed by sleeper player_id. When provided,
   * narrativePressure is populated from this signal (a roster-move proxy
   * for sentiment) instead of being left at zero. Caller is responsible
   * for the proxy disclosure in SourceMeta.assumptions.
   */
  trendingAdds?: Map<string, number>;
  /** Sleeper trending-drops map; see trendingAdds. */
  trendingDrops?: Map<string, number>;
}

/**
 * Take a Sleeper-derived PlayerMarketRecord (identity-only, all behavioral
 * fields zero) and overlay it with FantasyPros ranking data. Returns the
 * same record with behavioral fields populated and the rankings source
 * appended to sources.
 *
 * If no FantasyPros match is found, returns the input record unchanged
 * but with the rankings source still appended (so downstream consumers
 * know we tried and what's missing).
 */
export function enrichWithFp(
  record: PlayerMarketRecord,
  match: FpPlayer | null,
  options: EnrichOptions,
  maxRank: number,
  scoring: "STD" | "PPR" | "HALF",
  maxes?: { trendingAddsMax?: number; trendingDropsMax?: number }
): PlayerMarketRecord {
  const sources = [
    ...record.sources,
    withFpMissingFields(options.rankingsSource, options)
  ];
  // Optional trending proxy applies whether or not we have an FP match —
  // identity-only records also benefit from the roster-move signal.
  const narrativePressure =
    options.trendingAdds && options.trendingDrops
      ? narrativePressureFromTrending(
          record,
          options.trendingAdds,
          options.trendingDrops,
          maxes?.trendingAddsMax,
          maxes?.trendingDropsMax
        )
      : record.narrativePressure;
  if (!match) {
    // No FP match — keep identity values + apply trending proxy.
    return { ...record, narrativePressure, sources };
  }
  const perceivedValue = ecrToPerceivedValue(match.rank_ecr, maxRank);
  const replacementPosRank = positionReplacementRank(record.position, scoring);
  // pos_rank is "WR3" etc — parse the trailing integer.
  const posRankNum = Number((match.pos_rank ?? "").replace(/^[A-Z]+/, ""));
  const trueValue = Number.isFinite(posRankNum)
    ? ecrToTrueValue(match.rank_ecr, posRankNum, replacementPosRank)
    : perceivedValue;
  const volatility = stdToVolatility(match.rank_std);
  const ownershipLeverage = ownershipToLeverage(match.player_owned_avg, options.medianOwnership ?? 0);

  return {
    ...record,
    perceivedValue,
    trueValue,
    ownershipLeverage,
    // Bye-week stacking is a fragility input the existing models don't
    // see yet; leave fragility 0 for now so the source's missingFields
    // remains honest.
    fragility: record.fragility,
    narrativePressure,
    volatility,
    // confidence: inverse of expert variance. std=0 -> confidence=1,
    // std=30 -> confidence=0.
    confidence: Math.max(0, Math.min(1, 1 - Math.min(match.rank_std, 30) / 30)),
    sources
  };
}

function withFpMissingFields(source: SourceMeta, options?: EnrichOptions): SourceMeta {
  // narrative_pressure leaves the missingFields set when the trending proxy
  // is wired up. opportunity stays missing always (in-season-only signal).
  const fieldsStillMissing = options?.trendingAdds && options?.trendingDrops
    ? ["opportunity"]
    : PPR_BEHAVIORAL_FIELDS;
  const baseAssumptions = source.assumptions.length
    ? source.assumptions
    : ["FantasyPros consensus rankings + ownership; in-season opportunity not derived."];
  const assumptions = options?.trendingAdds && options?.trendingDrops
    ? [
        ...baseAssumptions,
        "narrative_pressure proxied from Sleeper 24h trending adds/drops; not true news sentiment."
      ]
    : baseAssumptions;
  return {
    ...source,
    missingFields: Array.from(new Set([...source.missingFields, ...fieldsStillMissing])),
    assumptions
  };
}

/**
 * Convenience: enrich an entire roster (array of records) against a
 * pre-built FpIndex. Records without a Sleeper position or with no
 * matching FantasyPros entry are returned unchanged but still get the
 * rankings source appended.
 */
export function enrichRoster(
  records: PlayerMarketRecord[],
  data: FpEcrData,
  index: FpIndex,
  options: EnrichOptions
): PlayerMarketRecord[] {
  const maxRank = data.players.length;
  // Convert record.id ("sleeper:4046") to a name-keyed lookup. We
  // re-match against the FP index using the record's name+position+team
  // instead of carrying through a Sleeper player object.
  const ownedValues = data.players.map((p) => p.player_owned_avg).filter((v): v is number => v != null);
  const medianOwnership =
    ownedValues.length > 0
      ? ownedValues.sort((a, b) => a - b)[Math.floor(ownedValues.length / 2)]
      : 0;
  // Pre-compute trending max counts once so per-player narrativePressureFromTrending
  // doesn't rescan the maps on every record.
  const trendingAddsMax = options.trendingAdds
    ? Math.max(1, ...Array.from(options.trendingAdds.values()))
    : undefined;
  const trendingDropsMax = options.trendingDrops
    ? Math.max(1, ...Array.from(options.trendingDrops.values()))
    : undefined;
  return records.map((rec) => {
    const match = matchSleeperToFp(
      {
        player_id: rec.id,
        full_name: rec.name,
        position: rec.position,
        team: rec.team
      },
      index
    );
    return enrichWithFp(
      rec,
      match?.fp ?? null,
      { ...options, medianOwnership },
      maxRank,
      data.scoring,
      { trendingAddsMax, trendingDropsMax }
    );
  });
}

// Re-export the index builder so callers can construct one and reuse it
// across multiple enrich calls (avoids rebuilding the maps per roster).
export { buildFpIndex };

// ---------------------------------------------------------------------------
// Standalone FP -> PlayerMarketRecord conversion (no Sleeper roster involved)
// ---------------------------------------------------------------------------

// Used by the mock-draft page: build a full PMR list from FantasyPros alone,
// no league required. Identity fields come from FP, behavioral fields come
// from the same ECR transforms used in enrichWithFp.

const FP_DEFAULT_HEADSHOT =
  "https://sleepercdn.com/images/v2/icons/player_default.webp";

/**
 * Convert a single FantasyPros ranking entry to a PlayerMarketRecord.
 * Skips non-rosterable positions (DST is mapped to DEF; FLEX/OP have no
 * direct PMR position and return null).
 */
export function fpPlayerToRecord(
  fp: FpPlayer,
  scoring: "STD" | "PPR" | "HALF",
  maxRank: number,
  medianOwnership: number,
  rankingsSource: SourceMeta
): PlayerMarketRecord | null {
  const position = fpPositionToPmr(fp.player_position_id);
  if (!position) return null;

  const perceivedValue = ecrToPerceivedValue(fp.rank_ecr, maxRank);
  const replacementPosRank = positionReplacementRank(position, scoring);
  const posRankNum = Number((fp.pos_rank ?? "").replace(/^[A-Z]+/, ""));
  const trueValue = Number.isFinite(posRankNum)
    ? ecrToTrueValue(fp.rank_ecr, posRankNum, replacementPosRank)
    : perceivedValue;
  const volatility = stdToVolatility(fp.rank_std);
  const ownershipLeverage = ownershipToLeverage(fp.player_owned_avg, medianOwnership);
  const confidence = Math.max(0, Math.min(1, 1 - Math.min(fp.rank_std, 30) / 30));

  return {
    id: `fp:${fp.player_id}`,
    name: fp.player_name,
    position,
    team: fp.player_team_id ? fp.player_team_id.toUpperCase() : null,
    perceivedValue,
    trueValue,
    ownershipLeverage,
    fragility: 0,
    narrativePressure: 0,
    volatility,
    opportunity: 0,
    confidence,
    sources: [
      {
        ...rankingsSource,
        missingFields: Array.from(
          new Set([
            ...rankingsSource.missingFields,
            "narrative_pressure",
            "opportunity",
            "fragility"
          ])
        )
      }
    ],
    rosterSlot: "FLEX",
    status: "active",
    imageUrl: FP_DEFAULT_HEADSHOT,
    imageSource: "FantasyPros consensus rankings"
  };
}

/**
 * Convert a full FantasyPros ECR payload to a PlayerMarketRecord list.
 * Drops non-PMR positions (FLEX/OP) silently.
 */
export function fpDataToRecords(
  data: FpEcrData,
  rankingsSource: SourceMeta
): PlayerMarketRecord[] {
  const maxRank = data.players.length;
  const ownedValues = data.players
    .map((p) => p.player_owned_avg)
    .filter((v): v is number => v != null);
  const medianOwnership =
    ownedValues.length > 0
      ? ownedValues.sort((a, b) => a - b)[Math.floor(ownedValues.length / 2)]
      : 0;
  const records: PlayerMarketRecord[] = [];
  for (const fp of data.players) {
    const r = fpPlayerToRecord(fp, data.scoring, maxRank, medianOwnership, rankingsSource);
    if (r) records.push(r);
  }
  return records;
}

// Re-exposed locally so fpPlayerToRecord can use the same conversion the
// roster enricher uses for DST -> DEF mapping.
function fpPositionToPmr(fp: FpPlayer["player_position_id"]): PlayerMarketRecord["position"] | null {
  if (fp === "QB" || fp === "RB" || fp === "WR" || fp === "TE" || fp === "K") return fp;
  if (fp === "DST") return "DEF";
  return null;
}
