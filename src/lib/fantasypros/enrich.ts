import { DEFAULT_FORMAT, type LeagueFormat } from "../trade/format";
import type { PlayerMarketRecord, SourceMeta } from "../governance";
import type { FpEcrData, FpPlayer } from "./types";
import type { FpIndex } from "./match";
import { buildFpIndex, matchSleeperToFp } from "./match";
import { trendingMomentumFromProxy } from "../sleeper/trendingProxy";
import { positionReplacementRank } from "../league/lineupDemand";

// Map a FantasyPros ranking entry into the behavioral-market fields of
// PlayerMarketRecord. The transform is intentionally simple — invert the
// rank and normalize to 0-100 for perceivedValue, derive trueValue from
// positional VBD, and pass through ownership / variance / bye-week
// directly. Anything we can't compute from rankings (trendingMomentum,
// opportunity) stays 0 and the SourceMeta declares it missing.

const PPR_BEHAVIORAL_FIELDS = [
  "trending_momentum", // requires Sleeper trending or ESPN-news adapter
  "opportunity", // requires in-season target/snap data
  // `fragility` was MISSING FROM THIS LIST while every live record was still
  // created with fragility: 0 (src/lib/normalize.ts). The envelope therefore
  // never declared it missing, so every guard downstream was dead code — and
  // the DEF grade, which is entirely fragility-driven, printed a constant "B+"
  // for every live user regardless of their actual defense
  // (derivedMetrics: avg(fragility < 35 ? 6 : -4) => 6 => gradeFromScore(6)).
  // Audit 2026-08-22.
  "fragility" // requires an injury / snap-share adapter; none is integrated
];

/**
 * Replacement level: how deep the league actually rosters a position.
 *
 * Audit 2026-08-06 F-010. This was a fixed table (QB 18, RB 36, WR 40, TE 16)
 * with a comment that admitted it was "for a 12-team league". It took `scoring`
 * but NOT numTeams, starters, or numQbs — so an 8-team league, a 2-TE league and
 * a superflex league all got 12-team 1QB replacement levels. That matters more
 * than it looks: replacement level is the denominator of `trueValue`, and
 * trueValue feeds the season simulation, the draft board, trade grades and every
 * panel. A wrong baseline biases the entire product, quietly.
 *
 * Now derived from the league's real starting lineup:
 *   replacement = numTeams x (per-team starters at the position, incl. flex share)
 *                 x DEPTH_CUSHION
 *
 * THE ASSUMPTION DID CHANGE, and the audit requires that to be stated rather
 * than buried. Measured against the retired constants for the 12-team 1QB PPR
 * league they were tuned for:
 *
 *        retired   derived
 *   QB     18        14
 *   RB     36        35     <- essentially unchanged
 *   WR     44        37
 *   TE     18        14
 *   K/DEF  12        12
 *
 * RB lands close to the old value. That is AGREEMENT WITH THE PREVIOUS GUESS,
 * not calibration — one position, one league shape, no observed outcome — and
 * an earlier version of this comment overclaimed it as evidence the cushion was
 * "calibrated sensibly" (corrected per audit P2 §9). QB/WR/TE come in shallower
 * because the old table conflated ROSTERED depth with STARTABLE depth: a
 * 12-team PPR league rosters ~44 WRs but only starts ~30, and VBD's baseline is
 * the worst player you are forced to START. The derived value is the more
 * defensible definition, and it is now consistent across positions instead of
 * hand-tuned per position.
 *
 * The cushion is 1.2 because practical replacement sits slightly deeper than the
 * last starter — managers stream from waivers. K/DEF get no cushion, being
 * fully fungible. Measured influence, swept across 48 league shapes: moving the
 * cushion ±0.2 disturbs at most 4.2% of cross-position pairs and moves at most
 * ONE player in the top 24 (reports/2026-08-06/replacement-sensitivity.md).
 *
 * Where the old table was simply WRONG, the change is large and obviously right:
 * a 12-team superflex goes QB 14 -> 29, a 2-TE league goes TE 14 -> 31, and an
 * 8-team league scales down across the board (RB 35 -> 23) instead of using
 * 12-team baselines.
 */
/**
 * The replacement model and its derived anchor now live in
 * `lib/league/lineupDemand.ts`, beside the flex-allocation logic they belong
 * with. Re-exported here so existing importers are unchanged, and so there is
 * exactly ONE definition rather than two that a comment merely claims agree.
 */
export {
  averageStartableTrueValue,
  DEFAULT_REPLACEMENT_MODEL,
  type ReplacementModel
} from "../league/lineupDemand";

export { positionReplacementRank };

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
  /**
   * League format — replacement level is derived from it (audit F-010). When
   * omitted the documented 12-team 1QB PPR baseline applies, and that is a
   * stated default rather than a hidden assumption.
   */
  format?: LeagueFormat;
  /** Median ownership % for the scoring format. Pass 0 if you want raw delta. */
  medianOwnership?: number;
  /**
   * Sleeper trending-adds map keyed by sleeper player_id. When provided,
   * trendingMomentum is populated from this signal (a roster-move proxy
   * for momentum) instead of being left at zero. Caller is responsible
   * for the proxy disclosure in SourceMeta.assumptions.
   */
  trendingAdds?: Map<string, number>;
  /** Sleeper trending-drops map; see trendingAdds. */
  trendingDrops?: Map<string, number>;
  /**
   * Recency-weighted ESPN headline-velocity scores (sleeperId → normalised
   * 0-100 score). When provided, these override the Sleeper-trending proxy
   * as the trendingMomentum signal. The proxy stays as a fallback when this
   * is absent or the news cron has not yet fired.
   */
  newsMomentumScores?: Record<string, number> | null;
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
  maxes?: { trendingAddsMax?: number; trendingDropsMax?: number },
  /**
   * League format — replacement level is derived from it (audit F-010).
   * Optional and last so existing call sites are unaffected; when absent the
   * documented 12-team 1QB PPR baseline applies, matching the retired constants.
   */
  format: LeagueFormat = DEFAULT_FORMAT
): PlayerMarketRecord {
  // trendingMomentum priority:
  //   1. ESPN headline-velocity score (newsMomentumScores) — real signal.
  //   2. Sleeper trending proxy (trendingAdds/Drops) — roster-move proxy.
  //   3. Zero (default) — declared missing in SourceMeta.
  //
  // Computed BEFORE `sources`, because the SourceMeta has to state which of
  // those three actually supplied the number for THIS record. It previously
  // claimed ESPN news for every record whenever the map was non-empty.
  const newsScore = newsScoreFor(record.id, options.newsMomentumScores);
  const sources = [
    ...record.sources,
    withFpMissingFields(options.rankingsSource, options, newsScore != null)
  ];
  const trendingMomentum =
    newsScore != null
      ? newsScore
      : options.trendingAdds && options.trendingDrops
        ? trendingMomentumFromProxy(
            record,
            options.trendingAdds,
            options.trendingDrops,
            maxes?.trendingAddsMax,
            maxes?.trendingDropsMax
          )
        : record.trendingMomentum;
  if (!match) {
    // No FP match — keep identity values + apply trending proxy.
    return { ...record, trendingMomentum, sources };
  }
  const perceivedValue = ecrToPerceivedValue(match.rank_ecr, maxRank);
  const replacementPosRank = positionReplacementRank(record.position, options.format ?? format);
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
    trendingMomentum,
    volatility,
    // confidence: inverse of expert variance. std=0 -> confidence=1,
    // std=30 -> confidence=0.
    confidence: Math.max(0, Math.min(1, 1 - Math.min(match.rank_std, 30) / 30)),
    sources
  };
}

/**
 * The news score for a record, or undefined.
 *
 * Audit 2026-08-31 (D-A). `buildNewsWeightMap` keys its output by the BARE
 * Sleeper player id — it iterates the Sleeper players map directly
 * (`newsMatch.ts:59`) and emits `out[sleeperId]` (`:102`). A
 * `PlayerMarketRecord.id` is `sleeper:<id>` (`normalize.ts:25`). Looking up
 * `scores[record.id]` therefore missed on every player in the catalog: the
 * ESPN news signal was dead code in production, every record silently fell
 * through to the Sleeper add/drop proxy, and the SourceMeta went on announcing
 * "trending_momentum from ESPN headline velocity".
 *
 * `trendingMomentumFromProxy` strips the prefix and says why it must
 * (`trendingProxy.ts:44`). This is the same normalisation, in the one place
 * that needed it and did not have it.
 */
export function newsScoreFor(
  recordId: string,
  scores: Record<string, number> | null | undefined
): number | undefined {
  if (!scores) return undefined;
  const bare = recordId.startsWith("sleeper:") ? recordId.slice("sleeper:".length) : recordId;
  return scores[bare] ?? scores[recordId];
}

function withFpMissingFields(
  source: SourceMeta,
  options?: EnrichOptions,
  /**
   * Did an ESPN news score actually land on this record? Distinct from "is a
   * news map present" — a player with no articles legitimately falls back to
   * the Sleeper proxy, and saying otherwise is a false provenance claim.
   */
  newsUsedForThisRecord = false
): SourceMeta {
  // trending_momentum is no longer missing when news scores or the Sleeper
  // proxy is wired. opportunity stays missing always (in-season-only signal).
  const hasNewsMap = !!(options?.newsMomentumScores && Object.keys(options.newsMomentumScores).length > 0);
  const hasProxy = !!(options?.trendingAdds && options?.trendingDrops);
  // The FIELD is present when either source can supply it; the ASSUMPTION must
  // name the one that did.
  const hasNews = hasNewsMap && newsUsedForThisRecord;
  const fieldsStillMissing = hasNewsMap || hasProxy ? ["opportunity"] : PPR_BEHAVIORAL_FIELDS;
  const baseAssumptions = source.assumptions.length
    ? source.assumptions
    : ["FantasyPros consensus rankings + ownership; in-season opportunity not derived."];
  const assumptions = hasNews
    ? [
        ...baseAssumptions,
        "trending_momentum from ESPN headline velocity (count of articles mentioning player in last 72h, recency-weighted). Not NLP sentiment classification."
      ]
    : hasProxy
      ? [
          ...baseAssumptions,
          "trending_momentum proxied from Sleeper 24h trending adds/drops; not news/sentiment classification."
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
  // Pre-compute trending max counts once so per-player trendingMomentumFromProxy
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
  rankingsSource: SourceMeta,
  /** See enrichWithFp — optional and last, defaults to the documented baseline. */
  format: LeagueFormat = DEFAULT_FORMAT
): PlayerMarketRecord | null {
  const position = fpPositionToPmr(fp.player_position_id);
  if (!position) return null;

  const perceivedValue = ecrToPerceivedValue(fp.rank_ecr, maxRank);
  const replacementPosRank = positionReplacementRank(position, format);
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
    trendingMomentum: 0,
    volatility,
    opportunity: 0,
    confidence,
    sources: [
      {
        ...rankingsSource,
        missingFields: Array.from(
          new Set([
            ...rankingsSource.missingFields,
            "trending_momentum",
            "opportunity",
            "fragility"
          ])
        )
      }
    ],
    // NOT "FLEX". These are league-universe players ranked by consensus, not
    // members of anyone's lineup, so there is no slot to report. See the
    // field comment in governance.ts.
    rosterSlot: null,
    status: "active",
    // FantasyPros ships this in every snapshot and it was dropped here. The
    // field is a string upstream and may be absent, empty, or non-numeric, so
    // anything that is not a plausible week becomes null rather than NaN or 0.
    byeWeek: parseByeWeek(fp.player_bye_week),
    imageUrl: FP_DEFAULT_HEADSHOT,
    imageSource: "FantasyPros consensus rankings"
  };
}

/**
 * FantasyPros reports the bye as a STRING and sometimes omits it entirely.
 *
 * Anything that is not a plausible NFL week returns null. Zero is explicitly not
 * a bye week -- upstream uses it as a placeholder, and passing it through would
 * put "BYE 0" next to a real draft decision.
 */
export function parseByeWeek(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 1 && raw <= 22 ? raw : null;
  if (typeof raw !== "string") return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 22 ? n : null;
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
