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
}

/** Expected season points at each 1-based positional rank, best first. */
export type PositionCurve = Partial<Record<DemandPosition, number[]>>;

export interface PointsCurve {
  byPosition: PositionCurve;
  /** Seasons the curve was fitted on — the leakage audit trail. */
  seasons: number[];
  /** Observations used, per position. */
  counts: Partial<Record<DemandPosition, number>>;
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
export function buildPointsCurve(observations: readonly PointsObservation[]): PointsCurve {
  const grouped = new Map<DemandPosition, Map<number, number[]>>();
  const seasons = new Set<number>();

  for (const o of observations) {
    if (!Number.isFinite(o.seasonPoints) || o.adpRank < 1) continue;
    seasons.add(o.season);
    let byRank = grouped.get(o.position);
    if (!byRank) {
      byRank = new Map();
      grouped.set(o.position, byRank);
    }
    const bucket = byRank.get(o.adpRank);
    if (bucket) bucket.push(o.seasonPoints);
    else byRank.set(o.adpRank, [o.seasonPoints]);
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
      if (bucket && bucket.length > 0) {
        lastMean = bucket.reduce((a, b) => a + b, 0) / bucket.length;
        means.push(lastMean);
        weights.push(bucket.length);
        total += bucket.length;
      } else {
        means.push(lastMean);
        weights.push(0);
      }
    }
    byPosition[position] = isotonicDecreasing(means, weights);
    counts[position] = total;
  }

  return { byPosition, seasons: [...seasons].sort(), counts };
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
