import type { PlayerMarketRecord, SourceMeta } from "./governance";
import { averageStartableTrueValue } from "./fantasypros/enrich";
import {
  selectProjectionForFormat,
  type WeeklyProjectionByFormat
} from "./leagues/scoringPoints";
import type { ScoringFormat } from "./trade/format";
import {
  runSeasonSimulation,
  OUTCOME_TIERS,
  type FieldModel,
  type TeamStrength
} from "./seasonSim";

export { mulberry32 } from "./rng";

export type SimulationParams = {
  seed: number;
  iterations: number;
  /** Number of starting lineup slots used to build the team's weekly score. */
  rosterSlots: number;
  /** 0..1. Scales the team's week-to-week variance (higher = boom/bust). */
  riskTolerance: number;
  /**
   * Real weekly projections per player id, when the projections cron has fired.
   *
   * Carries ALL THREE scoring variants (audit 2026-08-20 §7). The numeric is
   * selected here, from {@link SimulationParams.scoringFormat} — the same field
   * that sets the opponent baseline — so the user's starters and the opponent
   * field are structurally guaranteed to share one point unit. Passing a
   * pre-collapsed `Map<string, number>` is exactly what made that guarantee
   * unenforceable before.
   */
  weeklyProjections?: Map<string, WeeklyProjectionByFormat> | null;
  /**
   * League scoring format. BOTH the opponent-field baseline (audit F-010) and
   * the per-starter projection unit (audit 2026-08-20 §7) are derived from it,
   * so the field and the user's own starters are measured on the same scale.
   * Defaults to PPR, which is the value the model was originally calibrated
   * against.
   */
  scoringFormat?: "STD" | "HALF" | "PPR";
  /** League size for the simulated season. Default 12. */
  numTeams?: number;
  /** Teams that make the playoffs. Default 6. */
  playoffTeams?: number;
  /** Regular-season weeks (round-robin length). Default 14. */
  regularSeasonWeeks?: number;
};

export type SimulationResult = {
  seed: number;
  params: SimulationParams;
  championshipProbability: number;
  playoffProbability: number;
  catastrophicRisk: number;
  regretIndex: number;
  keyDrivers: Array<{ id: string; name: string; contribution: number }>;
  assumptions: string[];
  source: SourceMeta;
  /**
   * Real simulated season-outcome distribution for the user's team. `wins[W]`
   * is P(W regular-season wins); `joint[W][tier]` is the JOINT P(W wins AND
   * final tier) with tiers ordered as {@link OUTCOME_TIERS}. Powers the Outcome
   * Multiverse heatmap with genuine (not fabricated) frequencies.
   */
  distribution: {
    wins: number[];
    joint: number[][];
    tiers: readonly string[];
    weeks: number;
  };
};

// ── Player → weekly-points model ────────────────────────────────────────────
// Quantities are WEEKLY FANTASY POINTS. A league-average startable player
// scores ~avgStarterPts; value above/below the median trueValue scales
// linearly. These anchors make a median roster land at the field mean, which is
// the calibration anchor (median roster ≈ playoffTeams/numTeams playoff odds).
//
// Audit 2026-08-06 F-010: this was a single PPR-calibrated constant (11.5) used
// for the OPPONENT FIELD, while the user's own starters were scored with
// `pickProjectionPoints` in the league's ACTUAL format. In a standard league the
// team was therefore measured in STD points against a PPR-sized field, biasing
// playoff and championship odds DOWN; a TE-premium or high-scoring league biased
// them up. The two sides of the comparison have to share a scale.
const AVG_STARTER_PTS_PPR = 11.5;

/**
 * Field baseline per scoring format.
 *
 * An average starting-lineup player catches roughly two passes a game, which is
 * worth 2 points in full PPR, 1 in half and 0 in standard — so the baseline
 * moves by ~1 point per half-point of reception scoring. PPR is left at exactly
 * 11.5 so the calibration that already exists for PPR leagues is unchanged, and
 * only the previously-wrong formats move.
 */
export function avgStarterPtsFor(scoringFormat: "STD" | "HALF" | "PPR"): number {
  if (scoringFormat === "PPR") return AVG_STARTER_PTS_PPR;
  if (scoringFormat === "HALF") return AVG_STARTER_PTS_PPR - 1;
  return AVG_STARTER_PTS_PPR - 2;
}

const TV_SLOPE = 0.18; // weekly pts per trueValue point away from the anchor
const PLAYER_SIGMA_BASE = 4;
const PLAYER_SIGMA_SLOPE = 0.08; // weekly sd per volatility point
const MEDIAN_PLAYER_SIGMA = PLAYER_SIGMA_BASE + PLAYER_SIGMA_SLOPE * 35;

/**
 * The trueValue that maps onto an average starter's points.
 *
 * Was `MEDIAN_TV = 50`, and that was a unit error rather than a tuning choice.
 * `trueValue = 50` is REPLACEMENT LEVEL (see ecrToTrueValue) while
 * `avgStarterPtsFor()` is the average STARTER's points, so the transform
 * equated a replacement player with an average starter and inflated every real
 * roster by the whole replacement-to-starter gap.
 *
 * Caught by scripts/backtest-valuation.ts on five completed leagues: every team
 * averaged 164 weekly points against a 115 field — every team 42% above
 * average, which cannot be true of every team simultaneously — so all 50
 * team-seasons predicted ~100% playoff odds. Brier 0.4000 against a 0.2400
 * climatology baseline; AUC exactly 0.5000, i.e. no discrimination at all.
 *
 * The replacement model now supplies the correct anchor, derived in closed form
 * from the depth cushion (79.2 at cushion 1.2), so the two sides of the
 * comparison share a scale and the documented calibration anchor — a
 * league-average roster makes the playoffs about playoffTeams/numTeams of the
 * time — actually holds. Pinned by simulation.calibration.test.ts.
 */
const STARTER_ANCHOR_TV = averageStartableTrueValue();

/**
 * A starter's weekly mean, in the league's own point unit.
 *
 * Two paths, and the whole point of audit 2026-08-20 §7 is that BOTH are in the
 * same unit:
 *
 *  1. Live — the real projection for `scoringFormat`. `selectProjectionForFormat`
 *     returns null rather than handing back a differently-scaled number, so a
 *     standard-scoring league never receives PPR points.
 *  2. Structural — `avgStarterPts`, which `avgStarterPtsFor(scoringFormat)`
 *     already scaled to the same format, offset by trueValue.
 *
 * So a player with no same-unit projection degrades to path 2 in the correct
 * unit, instead of importing the wrong one.
 */
function starterWeeklyMean(
  p: PlayerMarketRecord,
  weekly: Map<string, WeeklyProjectionByFormat> | null,
  scoringFormat: ScoringFormat,
  avgStarterPts: number
): number {
  const raw = weekly?.get(p.id);
  if (raw) {
    const selected = selectProjectionForFormat(raw, scoringFormat);
    if (selected) return Math.max(0, selected.points);
  }
  return Math.max(0, avgStarterPts + (p.trueValue - STARTER_ANCHOR_TV) * TV_SLOPE);
}

function starterWeeklySigma(p: PlayerMarketRecord): number {
  return PLAYER_SIGMA_BASE + Math.max(0, p.volatility) * PLAYER_SIGMA_SLOPE;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export interface SeasonInputs {
  team: TeamStrength;
  field: FieldModel;
  /** The chosen starters with their weekly means, best first. */
  starters: Array<{ player: PlayerMarketRecord; weeklyMean: number }>;
}

/**
 * Convert a roster + params into the team and field models the season simulator
 * consumes. The team comes from the user's real starters; the field is anchored
 * to league-average scoring so a median roster is calibrated to ≈
 * playoffTeams/numTeams playoff odds. Risk tolerance scales team variance.
 */
export function deriveSeasonInputs(players: PlayerMarketRecord[], params: SimulationParams): SeasonInputs {
  const rosterSlots = Math.max(1, Math.floor(params.rosterSlots));
  const weekly = params.weeklyProjections ?? null;
  const chosen = [...players].sort((a, b) => b.trueValue - a.trueValue).slice(0, rosterSlots);

  // BOTH sides of the comparison use this same per-starter baseline, which is
  // the property that was broken: the field used it while the team was anchored
  // at replacement level instead.
  const scoringFormat: ScoringFormat = params.scoringFormat ?? "PPR";
  const avgStarterPts = avgStarterPtsFor(scoringFormat);

  let mean = 0;
  let varSum = 0;
  const starters = chosen.map((player) => {
    const m = starterWeeklyMean(player, weekly, scoringFormat, avgStarterPts);
    const s = starterWeeklySigma(player);
    mean += m;
    varSum += s * s;
    return { player, weeklyMean: m };
  });
  starters.sort((a, b) => b.weeklyMean - a.weeklyMean);

  const riskScale = 0.85 + clamp01(params.riskTolerance) * 0.3; // 0→0.85, 1→1.15
  const team: TeamStrength = { meanWeekly: mean, sigmaWeekly: Math.sqrt(varSum) * riskScale };

  // Anchor the field to the ACTUAL number of starters used (not the requested
  // rosterSlots) so the league of opponents is the same size as the user's team.
  // Otherwise a roster with fewer players than rosterSlots (e.g. the 8-player
  // demo fixture) is scored against a larger field and looks artificially weak.
  const usedStarters = Math.max(1, starters.length);
  const fieldMean = usedStarters * avgStarterPts;
  const field: FieldModel = {
    meanWeekly: fieldMean,
    betweenTeamSigma: fieldMean * 0.13,
    withinTeamSigma: Math.sqrt(usedStarters) * MEDIAN_PLAYER_SIGMA
  };

  return { team, field, starters };
}

/**
 * Run a real season Monte Carlo for the roster and return the dashboard's
 * `SimulationResult`. Probabilities are genuine simulated frequencies — the team
 * plays a full round-robin season, standings seed a playoff bracket, and the
 * champion is the bracket winner — not a threshold heuristic.
 */
export function runNexusSimulation(players: PlayerMarketRecord[], params: SimulationParams): SimulationResult {
  const { team, field, starters } = deriveSeasonInputs(players, params);
  const numTeams = Math.max(2, Math.floor(params.numTeams ?? 12));
  const playoffTeams = Math.max(1, Math.min(Math.floor(params.playoffTeams ?? 6), numTeams));
  const regularSeasonWeeks = Math.max(1, Math.floor(params.regularSeasonWeeks ?? 14));

  const season = runSeasonSimulation(team, field, {
    seed: params.seed,
    iterations: params.iterations,
    numTeams,
    regularSeasonWeeks,
    playoffTeams
  });

  const source = players[0]?.sources[0] ?? {
    source: "No player source available",
    fetchedAt: null,
    ttlSeconds: 900,
    freshness: "missing" as const,
    confidence: 0,
    validation: "not-run" as const,
    missingFields: ["players"],
    assumptions: [],
    failure: "Simulation ran without calibrated player data."
  };

  const keyDrivers = starters
    .slice(0, 5)
    .map(({ player, weeklyMean }) => ({ id: player.id, name: player.name, contribution: round1(weeklyMean) }));

  return {
    seed: params.seed,
    params,
    championshipProbability: pct(season.championshipProbability),
    playoffProbability: pct(season.playoffProbability),
    // "Catastrophe" = finishing in the bottom third of the standings.
    catastrophicRisk: pct(season.bottomProbability),
    // "Regret" = the probability of missing the playoffs entirely.
    regretIndex: pct(1 - season.playoffProbability),
    keyDrivers,
    assumptions: [
      `Real season Monte Carlo: ${numTeams}-team league, ${regularSeasonWeeks}-week round-robin, top ${playoffTeams} make a single-elimination bracket (byes for top seeds), over ${season.iterations.toLocaleString()} simulated seasons.`,
      "Each weekly matchup is decided by sampled team scores; the user's team uses its real starters' weekly means/variances and opponents draw a season strength from the league distribution.",
      `Live path: each starter's weekly mean is its real Sleeper projection in this league's ${params.scoringFormat ?? "PPR"} scoring unit (pts_ppr / pts_half_ppr / pts_std selected by league format); a player with no projection in that unit, and the whole off-season path, are mapped from season-aggregate trueValue on the same scale. Risk tolerance scales week-to-week variance.`,
      `Calibration anchor: a league-average roster (trueValue ≈ ${STARTER_ANCHOR_TV.toFixed(0)}, the average STARTABLE player) makes the playoffs ≈ playoffTeams/numTeams of the time. Verified by simulation.calibration.test.ts.`,
      // CLAUDE.md: "if a model lacks calibration, do not present it as
      // production-safe". An out-of-sample backtest now exists, and it failed —
      // so saying nothing here would be the dishonest option.
      "NOT VALIDATED OUT-OF-SAMPLE: backtested on 50 team-seasons across 5 completed leagues (2022-2025), this chain scored Brier 0.310 against a 0.240 climatology baseline and AUC 0.306 — significantly worse than forecasting the league's base rate. Treat these odds as a structured scenario, not a prediction. See reports/2026-08-06/backtest-valuation.md."
    ],
    source,
    distribution: {
      wins: season.winsDistribution,
      joint: season.winOutcomeJoint,
      tiers: OUTCOME_TIERS,
      weeks: regularSeasonWeeks
    }
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Convert a 0..1 probability to a one-decimal percentage, clamped to [0, 100].
 * A probability must never render an impossible value.
 */
function pct(value: number): number {
  const bounded = Math.min(1, Math.max(0, value));
  return Math.round(bounded * 1000) / 10;
}
