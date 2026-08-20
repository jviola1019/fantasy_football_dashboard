/**
 * Presentation layer for an UNVALIDATED simulation output.
 *
 * Audit 2026-08-20 §3, **Strategy B**: the shipped rank-ratio valuation chain
 * failed out-of-sample validation — Brier 0.3353 against a 0.2400 climatology
 * baseline, AUC 0.2546 with a cluster-bootstrap 95% CI of [0.1333, 0.4450],
 * entirely BELOW 0.5. Its ranking is significantly inverted in the tested
 * sample. See `reports/2026-08-06/backtest-valuation.md`.
 *
 * Why a one-decimal percentage is the wrong presentation for that model:
 *
 *  1. `12.4%` carries an implied precision the model has not earned. The
 *     measured calibration error is ECE 0.2999 — the number is wrong by tens of
 *     percentage points, not tenths.
 *  2. A percentage next to the word "probability" reads as a forecast. This
 *     output is a simulated FREQUENCY under model assumptions, which is a
 *     different quantity, and the audit requires the two be distinguished.
 *  3. A warning placed behind a tab is not informed presentation. It has to sit
 *     beside the number it qualifies.
 *
 * What is genuinely trustworthy here is the STRUCTURAL baseline — in a 10-team
 * league with 6 playoff berths, 6 of 10 teams qualify. That is arithmetic about
 * the league, not a model output, and climatology (Brier 0.2400) beats the model
 * on the same sample. So the baseline leads, and the simulation is shown as a
 * labeled comparison against it.
 *
 * Nothing here is fitted. The buckets are presentation choices, chosen before
 * looking at any output and stated in the code so they can be argued with.
 */

/** Structural rates for an average team in a league of this shape. */
export interface StructuralBaseline {
  /** playoffTeams / numTeams, as a percentage. */
  playoffs: number;
  /** 1 / numTeams, as a percentage. */
  championship: number;
  numTeams: number;
  playoffTeams: number;
}

/**
 * The base rates implied by league shape alone.
 *
 * Exactly `playoffTeams / numTeams` of teams make the playoffs and exactly one
 * team of `numTeams` wins, every season, by construction. No model is involved
 * and none can beat these on average.
 */
export function structuralBaseline(numTeams: number, playoffTeams: number): StructuralBaseline {
  const teams = Math.max(2, Math.floor(numTeams));
  const berths = Math.max(1, Math.min(Math.floor(playoffTeams), teams));
  return {
    playoffs: (berths / teams) * 100,
    championship: (1 / teams) * 100,
    numTeams: teams,
    playoffTeams: berths
  };
}

export type ScenarioBand = "far-below" | "below" | "near" | "above" | "far-above";

/**
 * Bucket boundaries, in absolute LOG-ODDS distance from the baseline.
 *
 * Not a plain probability ratio, and the reason matters. A ratio saturates
 * against the 100% ceiling: with a 60% playoff baseline the largest achievable
 * ratio is 100/60 = 1.67, so the pathological case this whole audit trail
 * started from — the pre-anchor-fix model predicting ~100% playoff odds for
 * every team in the league — could never have reached the top bucket. It would
 * have rendered as merely "above baseline", which is exactly the reassurance a
 * broken model must not be given.
 *
 * Log-odds is the scale on which probability differences are actually
 * comparable, it is symmetric about the baseline, and it never saturates. The
 * boundaries are stated as odds ratios because that is the interpretable form:
 *
 *   |d| < ln(1.5) ~ 0.405   -> near        (within a 1.5x odds ratio)
 *   |d| < ln(3)   ~ 1.099   -> below/above (1.5x to 3x)
 *   |d| >= ln(3)            -> far         (3x or more)
 *
 * Chosen before looking at any output. Five buckets is about as much resolution
 * as an uncalibrated model can honestly support, and coarse buckets are also
 * what fits a 320px screen without truncation.
 */
const NEAR_MAX_LOG_ODDS = Math.log(1.5);
const FAR_MIN_LOG_ODDS = Math.log(3);

/**
 * Clamp before taking a logit. One part in a thousand matches the one-decimal
 * percentage resolution the simulation actually reports, so clamping cannot
 * discard a distinction the model was capable of making.
 */
const P_EPSILON = 0.001;

function logit(p: number): number {
  const clamped = Math.min(1 - P_EPSILON, Math.max(P_EPSILON, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Where the simulation's frequency lands relative to the league's own base rate,
 * measured in log-odds so the buckets mean the same thing for a 10%
 * championship baseline and a 60% playoff baseline.
 */
export function classifyScenario(scenarioPct: number, baselinePct: number): ScenarioBand {
  if (
    !Number.isFinite(scenarioPct) ||
    !Number.isFinite(baselinePct) ||
    baselinePct <= 0 ||
    baselinePct >= 100
  ) {
    return "near";
  }
  const bounded = Math.min(100, Math.max(0, scenarioPct));
  const d = logit(bounded / 100) - logit(baselinePct / 100);
  const magnitude = Math.abs(d);
  if (magnitude < NEAR_MAX_LOG_ODDS) return "near";
  if (magnitude < FAR_MIN_LOG_ODDS) return d < 0 ? "below" : "above";
  return d < 0 ? "far-below" : "far-above";
}

/**
 * Plain-language label. Every one names the baseline explicitly, so the phrase
 * cannot be read as a standalone likelihood claim the way "Likely" could.
 */
export const BAND_LABEL: Record<ScenarioBand, string> = {
  "far-below": "Far below league baseline",
  below: "Below league baseline",
  near: "Near league baseline",
  above: "Above league baseline",
  "far-above": "Far above league baseline"
};

/** Short form for narrow screens. */
export const BAND_LABEL_SHORT: Record<ScenarioBand, string> = {
  "far-below": "Far below",
  below: "Below",
  near: "Near",
  above: "Above",
  "far-above": "Far above"
};

/**
 * Which design-system colour a band uses.
 *
 * Note this is NOT good/bad — an uncalibrated model has no business telling the
 * user that "above baseline" is good news. It encodes DISTANCE FROM BASELINE, so
 * both tails read as "unusual, treat with more suspicion" rather than one tail
 * reading as success.
 */
export const BAND_TONE: Record<ScenarioBand, "neutral" | "notable" | "extreme"> = {
  "far-below": "extreme",
  below: "notable",
  near: "neutral",
  above: "notable",
  "far-above": "extreme"
};

/**
 * The single sentence that must appear adjacent to every decision-facing number
 * derived from this model. Kept here, in one place, so it cannot drift between
 * surfaces or be softened on one of them.
 */
export const MODEL_FAILURE_HEADLINE = "Scenario — not a forecast";

export const MODEL_FAILURE_DETAIL =
  "This model failed out-of-sample testing: across 30 team-seasons it ranked teams " +
  "worse than chance (AUC 0.25, 95% CI [0.13, 0.45]) and scored worse than simply " +
  "predicting the league's base rate. Use it to explore assumptions, not to predict.";

/** Where a reader can check the claim. Never a bare assertion. */
export const MODEL_FAILURE_EVIDENCE = "reports/2026-08-06/backtest-valuation.md";

export interface ScenarioReading {
  band: ScenarioBand;
  label: string;
  shortLabel: string;
  tone: "neutral" | "notable" | "extreme";
  /** The trustworthy number: the league's structural base rate, percent. */
  baselinePct: number;
  /** The simulated frequency under model assumptions, percent. Disclosure only. */
  scenarioPct: number;
}

/** Build the full reading for one outcome. */
export function scenarioReading(scenarioPct: number, baselinePct: number): ScenarioReading {
  const band = classifyScenario(scenarioPct, baselinePct);
  return {
    band,
    label: BAND_LABEL[band],
    shortLabel: BAND_LABEL_SHORT[band],
    tone: BAND_TONE[band],
    baselinePct,
    scenarioPct
  };
}
