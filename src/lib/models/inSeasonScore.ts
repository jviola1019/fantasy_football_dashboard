/**
 * The in-season ranking that protocols 4 and 5 licensed — and nothing more.
 *
 * ─── WHAT THIS IS ──────────────────────────────────────────────────────────
 *
 * Protocols 1–3 refuted RAE's consensus-derived valuation out-of-sample. The
 * single structural finding tying those refutations together is that every
 * predictor in that valuation is a monotone function of consensus rank, and **a
 * model built from the market's own opinion IS the market**.
 *
 * Protocols 4 and 5 found the one thing that is not: **observed in-season usage
 * carries information about rest-of-season scoring beyond what points already
 * scored carry.** Established twice, on data neither test was tuned on —
 * protocol 4 on 2021–2024, protocol 5 on 2017–2019 which protocol 4 never
 * touched.
 *
 *     score = z(pointsPerGame) + w · z(touchesPerGame),   w = 0.7613
 *
 * `w` is protocol 5's fitted ratio `b_touches / b_points`, computed ONCE on the
 * fit set and never adjusted. It is not a tuning knob and must not be treated
 * as one: re-fitting it here against anything would void the out-of-sample
 * justification that is the entire reason this function is allowed to exist.
 *
 * ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * - **Not a forecast.** It is a RANKING. Protocols 4/5 measured rank
 *   correlation and decision concordance, not calibrated probabilities, so
 *   nothing here may be presented as a probability.
 * - **Not for the draft.** Both protocols measured weeks 1–8 predicting weeks
 *   9–17. Before kickoff there is no usage to observe, and that regime is
 *   exactly where protocols 1–3 failed. `inSeasonScore` returns null without
 *   in-season data rather than degrading to a preseason guess.
 * - **Not large.** The validated gain is +0.0137 (protocol 4) and +0.0195
 *   (protocol 5) Spearman. Reliable, replicated, and small.
 * - **Not a magnitude claim.** Protocol 5's D2 diagnostic refitted the weight on
 *   the evaluation set and got 1.4208 against the fitted 0.7613. The DIRECTION
 *   generalises; the exact size does not. D5 showed the gain sits on a plateau
 *   (0.0177 at w = 0.5, 0.0205 at w = 1.0), which is why a drifting weight does
 *   not invalidate the ranking — but it does mean 0.7613 is a licensed choice,
 *   not a precise truth.
 *
 * ─── THE STANDARDISATION MATTERS ───────────────────────────────────────────
 *
 * Both protocols standardised **within (season, position)**. A running back's
 * touch count and a tight end's are not comparable, and a z-score computed
 * across positions would rank by position rather than by role. This function
 * therefore takes a per-position cohort, not a mixed pool.
 */
import type { PlayerMarketRecord } from "@/lib/governance";

/**
 * Protocol 5's fitted weight. FROZEN.
 *
 * reports/2026-08-20/holdout-protocol-5.md §4 and holdout-result-5.md.
 */
export const OPPORTUNITY_WEIGHT = 0.7613;

/**
 * Minimum cohort size. FIVE, because protocol 5 used five.
 *
 * Not a judgement about what makes a z-score meaningful — a judgement about
 * matching the implementation that was actually validated. See `zScores`.
 */
const MIN_COHORT = 5;

export interface InSeasonInput {
  /** Season-to-date PPR points PER GAME. Null when unknown — never defaulted. */
  pointsPerGame: number | null;
  /** (receptions + carries) per game. Null when unknown. */
  touchesPerGame: number | null;
}

export interface InSeasonRanked {
  id: string;
  score: number;
  zPoints: number;
  zTouches: number;
}

/**
 * Standardise with the POPULATION standard deviation (divide by n), not the
 * sample one (n − 1).
 *
 * This is not the estimator I would otherwise reach for. It is the one protocol
 * 5 used, and **matching the validated implementation outranks preferring a
 * different estimator** — a model validated one way and shipped another is not
 * a validated model.
 *
 * The difference is not cosmetic. Within one cohort both denominators scale
 * `zPoints` and `zTouches` by the same constant, so the within-cohort ordering
 * is identical. But the scores are then POOLED ACROSS COHORTS of different
 * sizes, and √(n/(n−1)) differs per cohort — so the relative weight of a small
 * cohort against a large one shifts, and the pooled rank correlation moves with
 * it.
 *
 * Caught by `npm run verify:inseason`, which replayed protocol 5's evaluation
 * set through this function and got a gain of 0.0204 against the published
 * 0.0195. The tolerance was NOT widened to accommodate it; the code was
 * corrected to match.
 */
function zScores(values: number[]): number[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  // A cohort with no spread carries no ranking information. Returning zeros
  // makes it inert rather than letting a divide-by-zero manufacture an ordering
  // out of nothing — the same failure `spearman` had before P2-4.
  if (!Number.isFinite(sd) || sd === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Rank one position cohort by the validated combination.
 *
 * Returns an EMPTY array when the cohort is too small or any player lacks
 * either input. Partial data does not get a partial score: a player missing
 * touches would be ranked on points alone and silently compared against players
 * ranked on both, which is a different model for different rows.
 */
export function rankCohort(
  cohort: ReadonlyArray<{ id: string } & InSeasonInput>,
  weight: number = OPPORTUNITY_WEIGHT
): InSeasonRanked[] {
  const usable = cohort.filter(
    (p) =>
      p.pointsPerGame != null &&
      p.touchesPerGame != null &&
      Number.isFinite(p.pointsPerGame) &&
      Number.isFinite(p.touchesPerGame)
  );
  if (usable.length < MIN_COHORT) return [];

  const zp = zScores(usable.map((p) => p.pointsPerGame!));
  const zt = zScores(usable.map((p) => p.touchesPerGame!));

  return usable.map((p, i) => ({
    id: p.id,
    zPoints: zp[i]!,
    zTouches: zt[i]!,
    score: zp[i]! + weight * zt[i]!
  }));
}

/**
 * Rank a mixed pool by splitting it into per-position cohorts first.
 *
 * The split is not a detail. Standardising across positions would rank by
 * position, which is the exact error `pointsCurve` exists to remove from
 * rank-ratio VBD and which P2-3 caught being reintroduced one layer down.
 */
export function rankInSeason(
  players: ReadonlyArray<PlayerMarketRecord & InSeasonInput>,
  weight: number = OPPORTUNITY_WEIGHT
): Map<string, InSeasonRanked> {
  const byPosition = new Map<string, Array<{ id: string } & InSeasonInput>>();
  for (const p of players) {
    const cohort = byPosition.get(p.position) ?? [];
    cohort.push({ id: p.id, pointsPerGame: p.pointsPerGame, touchesPerGame: p.touchesPerGame });
    byPosition.set(p.position, cohort);
  }

  const out = new Map<string, InSeasonRanked>();
  for (const cohort of byPosition.values()) {
    for (const ranked of rankCohort(cohort, weight)) out.set(ranked.id, ranked);
  }
  return out;
}

/**
 * The disclosure that must travel with any surface showing this score.
 *
 * CLAUDE.md requires every model output to expose its validation state. This is
 * the only model in the product with a POSITIVE out-of-sample result, which
 * makes overstating it easier and worse — so the limits ship in the same string
 * as the claim.
 */
export const IN_SEASON_DISCLOSURE = {
  headline: "Validated in-season signal",
  body:
    "Ranked by season-to-date scoring plus observed usage, weighted 0.76:1. Usage was tested " +
    "twice on untouched seasons (protocols 4 and 5) and predicted rest-of-season scoring beyond " +
    "points already scored both times.",
  limits: [
    "The measured gain is small: +0.0137 and +0.0195 Spearman.",
    "In-season only — before kickoff there is no usage to observe, and that is where the draft-time models failed.",
    "A ranking, not a forecast. No probability is implied.",
    "The weight generalises in direction; refitting it on the evaluation set gave 1.42 against the fitted 0.76."
  ],
  evidence: "reports/2026-08-20/holdout-protocol-5.md"
} as const;
