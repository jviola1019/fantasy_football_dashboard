import { predictLogisticProba } from "../stats/logistic";
import type { ReliabilityBin } from "../stats/distribution";

/**
 * The weekly start/sit probability — the one calibrated model in this product.
 *
 * WHAT IT IS. Per position, a logistic mapping a player's pre-game projected
 * PPR points to P(they clear the position's start threshold). Fitted once on
 * the committed input snapshot `reports/2026-08-20/brier-prospective.json.gz`
 * (3,573 startable player-weeks across all 17 regular-season weeks of 2025,
 * fingerprint `bba1d103`) and frozen here as constants.
 *
 * WHY CONSTANTS (redesign decision D1). It cannot be fitted at render time:
 * weekly projections are pruned to 14 days and weekly ACTUALS are not stored at
 * all, so there is nothing in production for `fitLogisticCV` to learn from. The
 * same precedent as `OPPORTUNITY_WEIGHT = 0.7613` in `inSeasonScore.ts`.
 * `npm run verify:weekly-prob` refits from that snapshot and fails if any
 * constant below has drifted from what the data produces.
 *
 * THE COEFFICIENTS AND THE SKILL COME FROM DIFFERENT FITS, DELIBERATELY.
 *   - `intercept` / `coefficient` are fitted on ALL rows for the position.
 *     A production model should use all the evidence it has.
 *   - `oofBrier` / `oofEce` / `brierSkillScore` are LEAVE-ONE-WEEK-OUT: every
 *     row scored by a model that never saw its week. That is the honest
 *     estimate of performance on an unseen week, and it is the only number that
 *     may be quoted as this model's accuracy. The full-fit model's in-sample
 *     Brier would measure how well it memorised, and it would look better.
 *
 * WHAT IT IS NOT. It is not a projection — it consumes one. It says nothing
 * about how many points a player will score, only about the probability of
 * clearing a fixed line. And its skill is NOT uniform across positions: see
 * `USEFUL_SKILL_FLOOR` below.
 */

export const WEEKLY_PROB_PROVENANCE = {
  snapshot: "reports/2026-08-20/brier-prospective.json.gz",
  capturedAt: "2026-08-23T19:39:27.895Z",
  fingerprint: "bba1d103",
  season: 2025,
  totalRows: 3573,
  evaluation: "leave-one-week-out (17 folds)",
  results: "docs/brier-results.md"
} as const;

export type WeeklyPosition = "QB" | "RB" | "WR" | "TE";

export interface WeeklyProbModel {
  position: WeeklyPosition;
  /** PPR points that count as a successful start for this position. */
  threshold: number;
  /** Fitted on ALL rows. */
  intercept: number;
  coefficient: number;
  /** Rows and weeks the fit saw. */
  n: number;
  weeks: number;
  /** Share of rows that cleared the threshold. */
  baseRate: number;
  /** Out-of-fold Brier score. Lower is better; 0.25 is a coin flip. */
  oofBrier: number;
  /** Out-of-fold Expected Calibration Error, 10 bins, occupancy-weighted. */
  oofEce: number;
  /** Brier of always forecasting the base rate — the bar to clear. */
  climatology: number;
  /** 1 - oofBrier/climatology. At or below zero means a constant beats it. */
  brierSkillScore: number;
  /** Out-of-fold reliability bins, so the panel plots what was measured. */
  reliabilityBins: ReliabilityBin[];
}

/**
 * The minimum Brier Skill Score at which this model may be presented as useful.
 *
 * QB measures +3.7% against RB/WR/TE's +21.2 / +18.5 / +17.6. That is a real
 * positive, and it is small enough that showing it beside the others without
 * comment would imply an equivalence the data does not support (redesign risk
 * R5). 10% is a judgement call and is declared as one — it is not derived from
 * the data, it is a product decision about what is worth a reader's attention,
 * and it sits above QB and well below the other three so no position is near
 * the line.
 */
export const USEFUL_SKILL_FLOOR = 0.1;

export const WEEKLY_PROB_MODELS: Record<WeeklyPosition, WeeklyProbModel> = {
  QB: {
    position: "QB",
    threshold: 18,
    intercept: -3.512943714699121,
    coefficient: 0.165946400178133,
    n: 512,
    weeks: 17,
    baseRate: 0.435546875,
    oofBrier: 0.23681754450588868,
    oofEce: 0.03312547464137702,
    climatology: 0.24584579467773438,
    brierSkillScore: 0.036723223936697136,
    reliabilityBins: [
      { binCenter: 0.15000000000000002, meanForecast: 0.18419001710614885, observedFreq: 0, n: 1 },
      { binCenter: 0.25, meanForecast: 0.26532374953008087, observedFreq: 0.3409090909090909, n: 44 },
      { binCenter: 0.35000000000000003, meanForecast: 0.35726633141476777, observedFreq: 0.3128834355828221, n: 163 },
      { binCenter: 0.45, meanForecast: 0.4462919490299257, observedFreq: 0.4742857142857143, n: 175 },
      { binCenter: 0.55, meanForecast: 0.5448262000443054, observedFreq: 0.5465116279069767, n: 86 },
      { binCenter: 0.6500000000000001, meanForecast: 0.6481205781838201, observedFreq: 0.6410256410256411, n: 39 },
      { binCenter: 0.7500000000000001, meanForecast: 0.7238319232183952, observedFreq: 0.5, n: 4 }
    ]
  },
  RB: {
    position: "RB",
    threshold: 10,
    intercept: -2.7033629310436704,
    coefficient: 0.22522386921860624,
    n: 876,
    weeks: 17,
    baseRate: 0.4840182648401826,
    oofBrier: 0.19690602510344138,
    oofEce: 0.032671019235491434,
    climatology: 0.2497445841412807,
    brierSkillScore: 0.21157038988260302,
    reliabilityBins: [
      { binCenter: 0.15000000000000002, meanForecast: 0.18324865616173752, observedFreq: 0.20652173913043478, n: 92 },
      { binCenter: 0.25, meanForecast: 0.2467466899698485, observedFreq: 0.23163841807909605, n: 177 },
      { binCenter: 0.35000000000000003, meanForecast: 0.3480257230232576, observedFreq: 0.2909090909090909, n: 110 },
      { binCenter: 0.45, meanForecast: 0.45189358247947076, observedFreq: 0.5, n: 90 },
      { binCenter: 0.55, meanForecast: 0.5498990066183225, observedFreq: 0.5833333333333334, n: 120 },
      { binCenter: 0.6500000000000001, meanForecast: 0.6479328724338377, observedFreq: 0.6777777777777778, n: 90 },
      { binCenter: 0.7500000000000001, meanForecast: 0.7478848641241352, observedFreq: 0.7608695652173914, n: 92 },
      { binCenter: 0.8500000000000001, meanForecast: 0.8460244216824536, observedFreq: 0.8108108108108109, n: 74 },
      { binCenter: 0.9500000000000001, meanForecast: 0.925598631976263, observedFreq: 0.8387096774193549, n: 31 }
    ]
  },
  WR: {
    position: "WR",
    threshold: 8,
    intercept: -2.461902961144873,
    coefficient: 0.24092302110952366,
    n: 1470,
    weeks: 17,
    baseRate: 0.48707482993197276,
    oofBrier: 0.20360710190244383,
    oofEce: 0.017477494107505456,
    climatology: 0.24983293997871758,
    brierSkillScore: 0.18502699475982465,
    reliabilityBins: [
      { binCenter: 0.15000000000000002, meanForecast: 0.19085465735674714, observedFreq: 0.1927710843373494, n: 83 },
      { binCenter: 0.25, meanForecast: 0.24451155490321763, observedFreq: 0.2262295081967213, n: 305 },
      { binCenter: 0.35000000000000003, meanForecast: 0.3508278527334174, observedFreq: 0.3466666666666667, n: 225 },
      { binCenter: 0.45, meanForecast: 0.44772821094627047, observedFreq: 0.4421052631578947, n: 190 },
      { binCenter: 0.55, meanForecast: 0.5487485041475965, observedFreq: 0.6089385474860335, n: 179 },
      { binCenter: 0.6500000000000001, meanForecast: 0.6542209098301296, observedFreq: 0.6460674157303371, n: 178 },
      { binCenter: 0.7500000000000001, meanForecast: 0.7479146420324458, observedFreq: 0.7473684210526316, n: 190 },
      { binCenter: 0.8500000000000001, meanForecast: 0.8483476682100632, observedFreq: 0.8717948717948718, n: 78 },
      { binCenter: 0.9500000000000001, meanForecast: 0.923671384172102, observedFreq: 0.8333333333333334, n: 42 }
    ]
  },
  TE: {
    position: "TE",
    threshold: 6,
    intercept: -2.386355101151318,
    coefficient: 0.3171156286309515,
    n: 715,
    weeks: 17,
    baseRate: 0.5118881118881119,
    oofBrier: 0.20589242903677518,
    oofEce: 0.024597451930674884,
    climatology: 0.2498586727957333,
    brierSkillScore: 0.1759644492905067,
    reliabilityBins: [
      { binCenter: 0.15000000000000002, meanForecast: 0.1940987625300644, observedFreq: 0.25, n: 24 },
      { binCenter: 0.25, meanForecast: 0.2492421554195749, observedFreq: 0.21739130434782608, n: 138 },
      { binCenter: 0.35000000000000003, meanForecast: 0.3489574648714005, observedFreq: 0.3979591836734694, n: 98 },
      { binCenter: 0.45, meanForecast: 0.4442767523963499, observedFreq: 0.43529411764705883, n: 85 },
      { binCenter: 0.55, meanForecast: 0.5539030572221264, observedFreq: 0.57, n: 100 },
      { binCenter: 0.6500000000000001, meanForecast: 0.649799595900464, observedFreq: 0.6495726495726496, n: 117 },
      { binCenter: 0.7500000000000001, meanForecast: 0.7454932540656192, observedFreq: 0.7108433734939759, n: 83 },
      { binCenter: 0.8500000000000001, meanForecast: 0.8443671303649634, observedFreq: 0.825, n: 40 },
      { binCenter: 0.9500000000000001, meanForecast: 0.9334144571075437, observedFreq: 0.9666666666666667, n: 30 }
    ]
  }
};

/** Does this position's measured skill clear the floor above? */
export function hasUsefulSkill(position: WeeklyPosition): boolean {
  return WEEKLY_PROB_MODELS[position].brierSkillScore >= USEFUL_SKILL_FLOOR;
}

/**
 * P(this player clears their position's start threshold this week).
 *
 * Returns null — never a number — when the projection is absent or the position
 * has no fitted model. K and DEF were never fitted: there is no evidence for
 * them, and inventing a curve would be fabrication. A null renders as
 * unavailable. It does not render as 50%.
 */
export function weeklyStartProbability(
  position: string,
  projectedPoints: number | null | undefined
): number | null {
  const model = WEEKLY_PROB_MODELS[position as WeeklyPosition];
  if (!model) return null;
  if (typeof projectedPoints !== "number" || !Number.isFinite(projectedPoints)) return null;
  // A negative projection is not a real forecast, and the fit never saw one.
  if (projectedPoints < 0) return null;
  return predictLogisticProba(
    { intercept: model.intercept, coefficients: [model.coefficient] },
    [projectedPoints]
  );
}


/**
 * Render a probability for display — and never as a certainty.
 *
 * The model is a logistic, so at a large enough projection `sigmoid` saturates
 * to exactly 1 in float64 and a naive `Math.round(p * 100)` prints "100%". No
 * weekly fantasy outcome is certain: a player can be inactive an hour before
 * kickoff, and the fit itself scored 218 did-not-plays as failures precisely
 * because that happens. The same at the bottom, where "0%" claims impossibility.
 *
 * So the DISPLAY is bounded while the probability is not. Clamping the model
 * itself would corrupt a calibrated output to fix a presentation problem; this
 * clamps only the string.
 */
export function formatWeeklyProb(p: number): string {
  const pct = p * 100;
  if (pct >= 99.5) return ">99%";
  if (pct <= 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * The disclosure that must accompany any rendering of this probability.
 *
 * Data rather than prose inside a component, so the panel cannot show the number
 * without the limits and a test can assert the limits are present. Same shape as
 * the disclosure block in `inSeasonScore.ts`.
 */
export function weeklyProbDisclosure(position: WeeklyPosition): {
  headline: string;
  limits: string[];
  evidence: string;
} {
  const m = WEEKLY_PROB_MODELS[position];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return {
    headline: `P(${position} clears ${m.threshold} PPR points)`,
    limits: [
      `Measured out-of-fold on ${m.n} ${position} player-weeks across ${m.weeks} weeks of the ${WEEKLY_PROB_PROVENANCE.season} season: Brier ${m.oofBrier.toFixed(4)}, calibration error ${pct(m.oofEce)}.`,
      `Brier skill against always forecasting the base rate (${pct(m.baseRate)}): ${pct(m.brierSkillScore)}.` +
        (hasUsefulSkill(m.position)
          ? ""
          : " That is small — near enough to zero that the base rate is almost as good a forecast, so this position's number should carry little weight."),
      "It converts a projection into a probability. It does not produce the projection, and it says nothing about how many points a player will score.",
      "Fitted on one season. A rule change, or a scoring format unlike the PPR the fit saw, is outside what was measured."
    ],
    evidence: `${WEEKLY_PROB_PROVENANCE.results} · snapshot fingerprint ${WEEKLY_PROB_PROVENANCE.fingerprint}`
  };
}
