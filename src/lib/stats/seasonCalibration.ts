// Season-simulation calibration harness.
//
// This measures whether the season simulator's displayed playoff/championship
// probabilities are (a) honest estimates of the simulator's OWN season
// frequencies (coverage) and (b) calibrated against realized outcomes drawn
// from that truth (reliability/Brier). It is a SELF-CONSISTENCY harness: it
// validates internal calibration + Monte-Carlo estimation error. It does NOT
// validate against real NFL outcomes — for that, supply real forecasts to
// `scoreForecasts` (see scripts/brier-season-sim.ts and docs/season-calibration.md).
import { mulberry32 } from "../rng";
import { runSeasonSimulation, type TeamStrength, type FieldModel } from "../seasonSim";
import {
  brierScore,
  expectedCalibrationError,
  reliabilityDiagram,
  wilsonInterval,
  type BrierForecast,
  type ReliabilityBin,
} from "./distribution";

export interface CalibrationConfig {
  team: TeamStrength;
  field: FieldModel;
  numTeams: number;
  regularSeasonWeeks: number;
  playoffTeams: number;
}

/**
 * A spread of synthetic 12-team league configs whose user-team strength ranges
 * from clearly-weak to clearly-strong relative to the field, so predicted
 * playoff probabilities span (0, 1) and the reliability diagram has signal
 * across the whole [0,1] range.
 */
export function syntheticConfigs(count: number): CalibrationConfig[] {
  const numTeams = 12;
  const playoffTeams = 6;
  const regularSeasonWeeks = 14;
  const fieldMean = 115;
  const betweenTeamSigma = fieldMean * 0.13;
  const withinTeamSigma = 21.5;
  const field: FieldModel = { meanWeekly: fieldMean, betweenTeamSigma, withinTeamSigma };

  const n = Math.max(2, Math.floor(count));
  const configs: CalibrationConfig[] = [];
  for (let i = 0; i < n; i++) {
    // Sweep team mean from -2.6σ to +2.6σ around the field mean.
    const z = -2.6 + (5.2 * i) / (n - 1);
    const team: TeamStrength = {
      meanWeekly: fieldMean + z * betweenTeamSigma,
      sigmaWeekly: withinTeamSigma,
    };
    configs.push({ team, field, numTeams, regularSeasonWeeks, playoffTeams });
  }
  return configs;
}

function predict(config: CalibrationConfig, seed: number, iterations: number) {
  return runSeasonSimulation(config.team, config.field, {
    seed,
    iterations,
    numTeams: config.numTeams,
    regularSeasonWeeks: config.regularSeasonWeeks,
    playoffTeams: config.playoffTeams,
  });
}

export interface SyntheticCalibrationResult {
  nConfigs: number;
  nForecasts: number;
  /**
   * Fraction of configs whose independent "truth" playoff frequency falls inside
   * the Wilson `coverageLevel` interval of the predicted frequency. Should be ≈
   * coverageLevel if the displayed probabilities + their stated Monte-Carlo error
   * are honest.
   */
  coverage: number;
  coverageLevel: number;
  playoffBrier: number;
  playoffEce: number;
  championshipBrier: number;
  championshipEce: number;
  reliabilityBins: ReliabilityBin[];
}

/**
 * Run the synthetic self-consistency calibration. Deterministic given `seed`.
 *
 * @param opts.count        number of synthetic configs (ignored if `configs` given)
 * @param opts.nPred        iterations for the predicted estimate (default 4000)
 * @param opts.nTruth       iterations for the independent "truth" estimate (default 20000)
 * @param opts.outcomeDraws Bernoulli outcomes per config for reliability (default 200)
 * @param opts.coverageLevel two-sided Wilson level for the coverage test (default 0.9)
 * @param opts.seed         base PRNG seed (default 20260609)
 */
export function runSyntheticCalibration(opts: {
  configs?: CalibrationConfig[];
  count?: number;
  nPred?: number;
  nTruth?: number;
  outcomeDraws?: number;
  coverageLevel?: number;
  seed?: number;
} = {}): SyntheticCalibrationResult {
  const configs = opts.configs ?? syntheticConfigs(opts.count ?? 40);
  const nPred = opts.nPred ?? 4000;
  const nTruth = opts.nTruth ?? 20000;
  const outcomeDraws = opts.outcomeDraws ?? 200;
  const coverageLevel = opts.coverageLevel ?? 0.9;
  const seed = opts.seed ?? 20260609;

  const drawRng = mulberry32(seed ^ 0x9e3779b9);
  let covered = 0;
  const playoffForecasts: BrierForecast[] = [];
  const champForecasts: BrierForecast[] = [];

  configs.forEach((config, i) => {
    // Two INDEPENDENT seeds: one for the prediction, one for the "truth".
    const pred = predict(config, seed + i * 2 + 1, nPred);
    const truth = predict(config, seed + i * 2 + 2, nTruth);

    const ci = wilsonInterval(pred.playoffProbability, nPred, coverageLevel);
    if (truth.playoffProbability >= ci.lower && truth.playoffProbability <= ci.upper) covered++;

    // Reliability: score the prediction against outcomes drawn from the truth.
    for (let d = 0; d < outcomeDraws; d++) {
      playoffForecasts.push({
        prob: pred.playoffProbability,
        outcome: drawRng() < truth.playoffProbability ? 1 : 0,
      });
      champForecasts.push({
        prob: pred.championshipProbability,
        outcome: drawRng() < truth.championshipProbability ? 1 : 0,
      });
    }
  });

  return {
    nConfigs: configs.length,
    nForecasts: playoffForecasts.length,
    coverage: covered / configs.length,
    coverageLevel,
    playoffBrier: brierScore(playoffForecasts).score,
    playoffEce: expectedCalibrationError(playoffForecasts, 10).ece,
    championshipBrier: brierScore(champForecasts).score,
    championshipEce: expectedCalibrationError(champForecasts, 10).ece,
    reliabilityBins: reliabilityDiagram(playoffForecasts, 10),
  };
}

export interface ForecastScore {
  n: number;
  brier: number;
  ece: number;
  reliabilityBins: ReliabilityBin[];
}

/**
 * Score a set of REAL forecasts (predicted probability + realized binary
 * outcome). This is the real-data backtest entry point — supply preseason
 * playoff/championship predictions paired with actual completed-season outcomes
 * (e.g. from finished Sleeper leagues). Reuses the same Brier/reliability
 * machinery as the synthetic harness so the two are directly comparable.
 */
export function scoreForecasts(forecasts: readonly BrierForecast[]): ForecastScore {
  return {
    n: forecasts.length,
    brier: brierScore(forecasts).score,
    ece: expectedCalibrationError(forecasts, 10).ece,
    reliabilityBins: reliabilityDiagram(forecasts, 10),
  };
}
