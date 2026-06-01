import type { PlayerMarketRecord, SourceMeta } from "./governance";
import {
  runSeasonSimulation,
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
  /** Real weekly pts_ppr per player id, when the projections cron has fired. */
  weeklyProjections?: Map<string, number> | null;
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
};

// ── Player → weekly-points model ────────────────────────────────────────────
// All quantities are in WEEKLY FANTASY POINTS (PPR). A league-average startable
// player scores ~AVG_STARTER_PTS; value above/below the median trueValue scales
// linearly. These anchors make a median roster land at the field mean, which is
// the calibration anchor (median roster ≈ playoffTeams/numTeams playoff odds).
const AVG_STARTER_PTS = 11.5;
const TV_SLOPE = 0.18; // weekly pts per trueValue point away from the median
const MEDIAN_TV = 50;
const PLAYER_SIGMA_BASE = 4;
const PLAYER_SIGMA_SLOPE = 0.08; // weekly sd per volatility point
const MEDIAN_PLAYER_SIGMA = PLAYER_SIGMA_BASE + PLAYER_SIGMA_SLOPE * 35;

function starterWeeklyMean(p: PlayerMarketRecord, weekly: Map<string, number> | null): number {
  const proj = weekly?.get(p.id);
  if (proj != null) return Math.max(0, proj); // real weekly projection (live path)
  return Math.max(0, AVG_STARTER_PTS + (p.trueValue - MEDIAN_TV) * TV_SLOPE);
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

  let mean = 0;
  let varSum = 0;
  const starters = chosen.map((player) => {
    const m = starterWeeklyMean(player, weekly);
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
  const fieldMean = usedStarters * AVG_STARTER_PTS;
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
      "Live path: each starter's weekly mean is its real Sleeper pts_ppr projection; off-season it is mapped from season-aggregate trueValue. Risk tolerance scales week-to-week variance.",
      "Calibration anchor: a league-average roster makes the playoffs ≈ playoffTeams/numTeams of the time (see docs/season-sim.md)."
    ],
    source
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
