import {
  averageStartableTrueValue,
  perTeamDemand,
  positionReplacementRank,
  DEFAULT_REPLACEMENT_MODEL,
  DEMAND_POSITIONS,
  type DemandPosition,
  type ReplacementModel
} from "../league/lineupDemand";
import type { LeagueFormat } from "../trade/format";

/**
 * Expected season points by positional draft rank, and the points-above-
 * replacement valuation built on it.
 *
 * WHY THIS EXISTS. The shipped valuation used rank-ratio VBD:
 *
 *   trueValue = 50 + 50 * (replacementRank - posRank) / replacementRank
 *
 * That is a ratio of RANKS, not of points, so the advantage it assigns at a
 * given positional rank grows with how DEEP the position is. In a 10-team
 * league replacement sits at QB 12 but RB 35, so QB3 scored 87.5 while RB3
 * scored 95.7 — the model marked quarterbacks down purely for playing a shallow
 * position. It never saw that a QB1 is worth ~320 points a season against a
 * TE1's ~153.
 *
 * The out-of-sample backtest measured the consequence: AUC 0.3058 with a 95% CI
 * of [0.1333, 0.4450], i.e. significantly WORSE than chance, while the raw
 * draft signal it was built from sat at 0.5033. The transform was destroying
 * signal. See reports/2026-08-06/backtest-valuation.md.
 *
 * Points above replacement is the textbook fix and the one that finally uses
 * the quantity that matters: how many points does this player produce ABOVE the
 * player you could have had for free at the same position.
 */

export interface PointsObservation {
  season: number;
  position: DemandPosition;
  /** 1-based rank within position by draft order — pre-season by construction. */
  adpRank: number;
  /** Total regular-season fantasy points actually scored. */
  seasonPoints: number;
  /**
   * Platform player id. REQUIRED (audit 2026-08-20 §5).
   *
   * Without it this type could not express the thing that most needed
   * measuring. The backtest pools observations from every earlier league, so one
   * NFL player-season appears once per league that drafted them — the ADP rank
   * differs but the OUTCOME is literally the same number. Nothing in the old
   * shape could tell a 500-observation fit built from 500 distinct players from
   * one built from 100 players counted five times, and the second carries
   * roughly a fifth of the evidence.
   */
  playerId: string;
  /** Source league. REQUIRED — it is the cluster these observations share. */
  leagueId: string;
}

/**
 * How repeated player-seasons are handled when fitting.
 *
 * The choice is made on statistical grounds BEFORE any untouched validation
 * (audit §5), never by picking whichever scores best on the development sample.
 *
 * - `league-level` — one observation per (league, player, season). The previous
 *   behaviour. Treats a player drafted in five leagues as five independent
 *   pieces of evidence about their scoring, which they are not: the outcome is
 *   one draw from one NFL season. It overstates precision roughly in proportion
 *   to how many leagues share a player, and it silently over-weights the popular
 *   players who appear in every league — exactly the top of the draft, which is
 *   where the curve's shape matters most.
 *
 * - `player-season` — collapse to one observation per (player, season), using
 *   the MEDIAN ADP rank across leagues. Statistically clean on the outcome side,
 *   but it discards real information: ADP genuinely is league-specific, and a
 *   player taken RB8 in one league and RB20 in another is evidence about BOTH
 *   ranks. Median also hides that disagreement rather than representing it.
 *
 * - `cluster-weighted` (default) — keep every league-level row, but weight each
 *   by `1 / k` where `k` is the number of leagues containing that player-season.
 *   Each distinct NFL outcome therefore contributes total weight exactly 1,
 *   however many leagues drafted the player, while its league-specific ADP
 *   information is retained at every rank it was actually drafted at.
 *
 * `cluster-weighted` is the default because it is the only one of the three that
 * fixes the dependence problem without throwing away data: it matches the total
 * evidence to the number of independent outcomes (like `player-season`) while
 * preserving the rank spread (like `league-level`). This is the standard
 * cluster-weighting treatment for repeated measures on the same unit, and the
 * argument for it does not depend on any score it produces.
 */
export type CurveAggregation = "league-level" | "player-season" | "cluster-weighted";

export interface BuildCurveOptions {
  aggregation?: CurveAggregation;
}

/**
 * Dependence diagnostics for one fit (audit §5).
 *
 * `effectiveObservations` is the count of DISTINCT NFL player-seasons. It is the
 * honest denominator: repeated rows carry the same outcome draw, so they cannot
 * add independent information about it. `designEffect` is raw / effective — how
 * far a naive count overstates the evidence.
 */
export interface CurveSampleDiagnostics {
  rawObservations: number;
  uniquePlayerSeasons: number;
  /** Rows that are a repeat of a player-season already counted. */
  duplicatedPlayerSeasons: number;
  /** Distinct player-seasons appearing in more than one league. */
  playerSeasonsInMultipleLeagues: number;
  leagues: number;
  seasons: number[];
  designEffect: number;
  perPosition: Partial<
    Record<
      DemandPosition,
      {
        rawObservations: number;
        effectiveObservations: number;
        distinctRanks: number;
        designEffect: number;
      }
    >
  >;
}

/** Identity of one NFL player-season, independent of which league saw it. */
function playerSeasonKey(o: PointsObservation): string {
  return `${o.season}:${o.playerId}`;
}

/**
 * Measure how much of a fit's apparent sample is repetition.
 *
 * Reported rather than acted on: pseudo-replication is not automatically wrong
 * here — ADP really is league-specific — but correlated rows must not be
 * presented as independent evidence.
 */
export function curveSampleDiagnostics(
  observations: readonly PointsObservation[]
): CurveSampleDiagnostics {
  const seen = new Map<string, Set<string>>();
  const leagues = new Set<string>();
  const seasons = new Set<number>();
  const perPos = new Map<
    DemandPosition,
    { raw: number; keys: Set<string>; ranks: Set<number> }
  >();

  for (const o of observations) {
    const key = playerSeasonKey(o);
    leagues.add(o.leagueId);
    seasons.add(o.season);
    const inLeagues = seen.get(key);
    if (inLeagues) inLeagues.add(o.leagueId);
    else seen.set(key, new Set([o.leagueId]));

    let bucket = perPos.get(o.position);
    if (!bucket) {
      bucket = { raw: 0, keys: new Set(), ranks: new Set() };
      perPos.set(o.position, bucket);
    }
    bucket.raw += 1;
    bucket.keys.add(key);
    bucket.ranks.add(o.adpRank);
  }

  const raw = observations.length;
  const unique = seen.size;
  const perPosition: CurveSampleDiagnostics["perPosition"] = {};
  for (const [position, b] of perPos) {
    perPosition[position] = {
      rawObservations: b.raw,
      effectiveObservations: b.keys.size,
      distinctRanks: b.ranks.size,
      designEffect: b.keys.size > 0 ? b.raw / b.keys.size : 0
    };
  }

  return {
    rawObservations: raw,
    uniquePlayerSeasons: unique,
    duplicatedPlayerSeasons: raw - unique,
    playerSeasonsInMultipleLeagues: [...seen.values()].filter((s) => s.size > 1).length,
    leagues: leagues.size,
    seasons: [...seasons].sort((a, b) => a - b),
    designEffect: unique > 0 ? raw / unique : 0,
    perPosition
  };
}

/** Expected season points at each 1-based positional rank, best first. */
export type PositionCurve = Partial<Record<DemandPosition, number[]>>;

export interface PointsCurve {
  byPosition: PositionCurve;
  /** Seasons the curve was fitted on — the leakage audit trail. */
  seasons: number[];
  /**
   * EFFECTIVE observations per position — total fitting weight, not row count.
   * Under `cluster-weighted` these are fractional and sum to the number of
   * distinct player-seasons, which is the honest figure to quote (audit §5).
   */
  counts: Partial<Record<DemandPosition, number>>;
  /** Which dependence treatment produced this curve. Recorded, never inferred. */
  aggregation: CurveAggregation;
}

/**
 * Isotonic regression by pool-adjacent-violators, constrained NON-INCREASING.
 *
 * The right smoother for this shape. Expected points must not rise with draft
 * rank — the market is not systematically wrong about ordering — but a single
 * season's raw means violate that constantly through noise (in one real league
 * QB1/QB2/QB3 scored 320/180/114 while QB4 scored 254). PAVA imposes exactly
 * the monotone constraint and nothing else: no bandwidth to choose, no
 * functional form assumed, and it is the maximum-likelihood fit under the
 * ordering constraint. A moving average would instead invent a smoothness the
 * data has not earned and would still permit rank inversions.
 */
export function isotonicDecreasing(values: number[], weights?: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const w = weights ?? values.map(() => 1);
  // Each block: running weighted mean over a contiguous run of ranks.
  const blockValue: number[] = [];
  const blockWeight: number[] = [];
  const blockSize: number[] = [];

  for (let i = 0; i < n; i += 1) {
    blockValue.push(values[i]!);
    blockWeight.push(w[i]!);
    blockSize.push(1);
    // Merge backwards while the sequence increases (violating non-increasing).
    while (
      blockValue.length > 1 &&
      blockValue[blockValue.length - 2]! < blockValue[blockValue.length - 1]!
    ) {
      const v2 = blockValue.pop()!;
      const w2 = blockWeight.pop()!;
      const s2 = blockSize.pop()!;
      const v1 = blockValue.pop()!;
      const w1 = blockWeight.pop()!;
      const s1 = blockSize.pop()!;
      const wSum = w1 + w2;
      blockValue.push(wSum > 0 ? (v1 * w1 + v2 * w2) / wSum : (v1 + v2) / 2);
      blockWeight.push(wSum);
      blockSize.push(s1 + s2);
    }
  }

  const out: number[] = [];
  for (let b = 0; b < blockValue.length; b += 1) {
    for (let k = 0; k < blockSize[b]!; k += 1) out.push(blockValue[b]!);
  }
  return out;
}

/**
 * Fit expected-points-by-rank from observations.
 *
 * `seasons` records which seasons went in, because the whole validity of a
 * backtest using this curve rests on it containing no data from the season
 * being scored. The caller filters; this records what it was given so the
 * filtering is auditable rather than assumed.
 */
export function buildPointsCurve(
  observations: readonly PointsObservation[],
  options: BuildCurveOptions = {}
): PointsCurve {
  const aggregation = options.aggregation ?? "cluster-weighted";
  const rows = prepareRows(observations, aggregation);

  // Weighted sums per (position, rank), so a row's influence is its weight
  // rather than its mere existence.
  const grouped = new Map<DemandPosition, Map<number, { sum: number; weight: number }>>();
  const seasons = new Set<number>();

  for (const { observation: o, weight } of rows) {
    if (!Number.isFinite(o.seasonPoints) || o.adpRank < 1 || weight <= 0) continue;
    seasons.add(o.season);
    let byRank = grouped.get(o.position);
    if (!byRank) {
      byRank = new Map();
      grouped.set(o.position, byRank);
    }
    const bucket = byRank.get(o.adpRank);
    if (bucket) {
      bucket.sum += o.seasonPoints * weight;
      bucket.weight += weight;
    } else {
      byRank.set(o.adpRank, { sum: o.seasonPoints * weight, weight });
    }
  }

  const byPosition: PositionCurve = {};
  const counts: Partial<Record<DemandPosition, number>> = {};

  for (const [position, byRank] of grouped) {
    const maxRank = Math.max(...byRank.keys());
    const means: number[] = [];
    const weights: number[] = [];
    let total = 0;
    // Ranks with no observation inherit the previous rank's mean, so a gap does
    // not punch a hole in the curve. Weight 0 keeps them from pulling the fit.
    let lastMean = 0;
    for (let rank = 1; rank <= maxRank; rank += 1) {
      const bucket = byRank.get(rank);
      if (bucket && bucket.weight > 0) {
        lastMean = bucket.sum / bucket.weight;
        means.push(lastMean);
        weights.push(bucket.weight);
        total += bucket.weight;
      } else {
        means.push(lastMean);
        weights.push(0);
      }
    }
    byPosition[position] = isotonicDecreasing(means, weights);
    // Rounded because a cluster-weighted total is fractional; it reports
    // EFFECTIVE observations, which is the number that should be quoted.
    counts[position] = Math.round(total * 100) / 100;
  }

  return { byPosition, seasons: [...seasons].sort(), counts, aggregation };
}

interface WeightedRow {
  observation: PointsObservation;
  weight: number;
}

/**
 * Apply the chosen aggregation, producing the weighted rows the fit consumes.
 *
 * Every mode gives one distinct NFL player-season a TOTAL weight of at most 1,
 * except `league-level`, which is retained only so the previous behaviour stays
 * reproducible for comparison.
 */
function prepareRows(
  observations: readonly PointsObservation[],
  aggregation: CurveAggregation
): WeightedRow[] {
  if (aggregation === "league-level") {
    return observations.map((observation) => ({ observation, weight: 1 }));
  }

  const byPlayerSeason = new Map<string, PointsObservation[]>();
  for (const o of observations) {
    const key = playerSeasonKey(o);
    const bucket = byPlayerSeason.get(key);
    if (bucket) bucket.push(o);
    else byPlayerSeason.set(key, [o]);
  }

  if (aggregation === "player-season") {
    // One row per player-season at the MEDIAN ADP rank across leagues. Robust to
    // a single league's outlier draft, at the cost of discarding the spread.
    const out: WeightedRow[] = [];
    for (const group of byPlayerSeason.values()) {
      const ranks = group.map((o) => o.adpRank).sort((a, b) => a - b);
      const mid = Math.floor(ranks.length / 2);
      const medianRank =
        ranks.length % 2 === 1 ? ranks[mid]! : Math.round((ranks[mid - 1]! + ranks[mid]!) / 2);
      out.push({ observation: { ...group[0]!, adpRank: medianRank }, weight: 1 });
    }
    return out;
  }

  // cluster-weighted: every league-level row survives, carrying 1/k of the
  // player-season's single unit of evidence.
  const out: WeightedRow[] = [];
  for (const group of byPlayerSeason.values()) {
    const w = 1 / group.length;
    for (const observation of group) out.push({ observation, weight: w });
  }
  return out;
}

/**
 * Expected points at a positional rank.
 *
 * Beyond the fitted range the curve is held flat at its last value rather than
 * extrapolated to zero: those are deep bench players who are close to
 * interchangeable, and a linear extrapolation would invent large negative
 * differences between players who are all equally replaceable.
 */
export function expectedPointsAt(
  curve: PointsCurve,
  position: DemandPosition,
  rank: number
): number | null {
  const series = curve.byPosition[position];
  if (!series || series.length === 0) return null;
  const idx = Math.max(0, Math.min(series.length - 1, Math.round(rank) - 1));
  return series[idx]!;
}

/**
 * Points above replacement: what this player produces beyond the player you
 * could have had for nothing at the same position.
 *
 * This is the quantity rank-ratio VBD was standing in for, and the reason the
 * substitution matters: it is denominated in POINTS, so a shallow position no
 * longer earns a discount for being shallow.
 */
export function pointsAboveReplacement(
  curve: PointsCurve,
  position: DemandPosition,
  rank: number,
  replacementRank: number
): number | null {
  const mine = expectedPointsAt(curve, position, rank);
  const repl = expectedPointsAt(curve, position, replacementRank);
  if (mine == null || repl == null) return null;
  return mine - repl;
}

/**
 * The PAR of the AVERAGE STARTABLE player in this league.
 *
 * Needed because trueValue is not a free scale — the season simulation reads it
 * against a fixed contract, that an average startable player sits at
 * `averageStartableTrueValue()` (79.2). Rank-ratio VBD happened to satisfy that
 * (its starters average 77.1); a naive PAR mapping does not.
 *
 * Measured on the real 2025 league with a 2024-fitted curve: mapping best-PAR to
 * 100 put PAR starters at a mean trueValue of 71.4 against the simulation
 * anchor of 79.2, so every team looked weak, every playoff probability came out
 * low, and Brier collapsed to 0.5530 against a 0.2400 baseline — even though
 * PAR's ordering was BETTER than rank-ratio's (AUC 0.4329 vs 0.2546).
 * Discrimination up, calibration down, is the signature of a scale error.
 *
 * Computed from the curve and the league format only — no outcome data for the
 * season being scored — so anchoring here does not compromise a backtest.
 */
export function averageStartablePar(
  curve: PointsCurve,
  format: LeagueFormat,
  model: ReplacementModel = DEFAULT_REPLACEMENT_MODEL
): number {
  const demand = perTeamDemand(format, model);
  let weighted = 0;
  let weight = 0;

  for (const position of DEMAND_POSITIONS) {
    const startable = Math.round(format.numTeams * demand[position]);
    if (startable < 1) continue;
    const replacementRank = positionReplacementRank(position, format, model);
    let sum = 0;
    let n = 0;
    for (let rank = 1; rank <= startable; rank += 1) {
      const par = pointsAboveReplacement(curve, position, rank, replacementRank);
      if (par == null) continue;
      sum += par;
      n += 1;
    }
    if (n === 0) continue;
    // Weight by how many such slots the league actually starts, so a deep
    // position counts for more than a shallow one.
    weighted += (sum / n) * startable;
    weight += startable;
  }

  return weight > 0 ? weighted / weight : 0;
}

/**
 * Map points-above-replacement onto the 0-100 trueValue scale the rest of the
 * system already speaks.
 *
 * TWO anchors, both structural rather than fitted:
 *   PAR = 0 (replacement)              -> 50
 *   PAR of the average startable player -> averageStartableTrueValue() (79.2)
 *
 * The second is what the season simulation requires in order for a
 * league-average roster to come out at league-average odds. Anchoring on the
 * best player in the pool instead — the obvious first choice — leaves the
 * average starter below the simulation's field baseline and destroys
 * calibration while leaving ordering intact.
 *
 * Clamped to 0-100 because the scale is bounded; a generational player at a
 * scarce position can otherwise exceed it.
 */
export function parToTrueValue(par: number, parAtAverageStartable: number): number {
  if (!Number.isFinite(par) || !Number.isFinite(parAtAverageStartable)) return 50;
  if (parAtAverageStartable <= 0) return 50;
  const anchor = averageStartableTrueValue();
  const raw = 50 + (anchor - 50) * (par / parAtAverageStartable);
  return Math.max(0, Math.min(100, Math.round(raw)));
}
