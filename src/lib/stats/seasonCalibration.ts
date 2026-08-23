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
  mean,
  reliabilityDiagram,
  stdev,
  wilsonInterval,
  type BrierForecast,
  type ReliabilityBin,
} from "./distribution";

export interface LeagueModels {
  field: FieldModel;
  teams: TeamStrength[];
}

/**
 * Build a `TeamStrength` per team and a league `FieldModel` from each team's
 * REAL weekly scores (e.g. a completed Sleeper season). Team mean/sigma are the
 * mean/sd of that team's weekly points; the field mean is the league average,
 * its between-team sigma the spread of team season-means, its within-team sigma
 * the average weekly sd. Used by the real-data season backtest.
 */
export function buildLeagueModels(weeklyByTeam: number[][]): LeagueModels {
  const teams: TeamStrength[] = weeklyByTeam.map((w) => ({
    meanWeekly: w.length ? mean(w) : 0,
    sigmaWeekly: w.length > 1 ? stdev(w) : 0,
  }));
  const seasonMeans = teams.map((t) => t.meanWeekly);
  const fieldMean = seasonMeans.length ? mean(seasonMeans) : 0;
  const withinVals = teams.map((t) => t.sigmaWeekly).filter((s) => s > 0);
  const withinTeamSigma = withinVals.length ? mean(withinVals) : 1;

  /**
   * BETWEEN-TEAM SIGMA, WITH THE SAMPLING TERM REMOVED (audit 2026-08-22, P2-6).
   *
   * This was `stdev(seasonMeans)`, which is not the spread of team STRENGTH. A
   * team's season mean is itself estimated from W weekly games, so
   *
   *     Var(observed season means) = Var(true strength) + Var(weekly) / W
   *
   * and the raw standard deviation therefore includes a within-team sampling
   * term that has nothing to do with how different the teams actually are. The
   * simulator then drew each opponent's strength from that inflated spread AND
   * added weekly noise on top, so within-team variance was counted twice: the
   * simulated field was more spread out than the real league, which pushes
   * playoff and championship probabilities away from the base rate — the
   * direction that makes a model look more decisive than it is.
   *
   * The correction is the standard variance-components one: subtract the
   * sampling term, floored at zero, because a negative variance estimate means
   * "no detectable between-team spread", not a negative one.
   */
  const weeksPerTeam = weeklyByTeam.length
    ? mean(weeklyByTeam.map((w) => w.length).filter((n) => n > 0))
    : 0;
  const rawBetweenVar = seasonMeans.length > 1 ? stdev(seasonMeans) ** 2 : 1;
  const samplingVar = weeksPerTeam > 0 ? (withinTeamSigma ** 2) / weeksPerTeam : 0;
  const betweenTeamSigma =
    seasonMeans.length > 1 ? Math.sqrt(Math.max(0, rawBetweenVar - samplingVar)) : 1;
  return {
    field: {
      meanWeekly: fieldMean,
      // No `|| 1` on between-team sigma. It was there when a zero could only
      // come from a degenerate input, but the variance-components estimate
      // above makes zero a LEGITIMATE result: it is what "these teams are not
      // detectably different" looks like. Coercing it to 1 would substitute a
      // fabricated spread for a measured one, and `seasonSim` only ever
      // MULTIPLIES by it, so zero is safe. Audit 2026-08-22, P2-6.
      betweenTeamSigma,
      // Within-team sigma keeps its floor: a zero there means every team
      // scored the identical number every week, which is a broken input rather
      // than a finding, and it would make every simulated season a tie.
      withinTeamSigma: withinTeamSigma || 1,
    },
    teams,
  };
}

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
