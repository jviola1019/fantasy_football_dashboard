import type { RAEEnvelope } from "@/lib/governance";
import { runNexusSimulation, type SimulationResult, type SimulationParams } from "@/lib/simulation";
import type { WeeklyProjectionByFormat } from "@/lib/leagues/scoringPoints";
import { bootstrapCI, type ConfidenceInterval } from "@/lib/stats/distribution";
import {
  deriveCommandMetrics,
  deriveMarketMetrics,
  deriveScenarioComparison,
  type CommandMetrics,
  type MarketMetrics,
  type ScenarioComparison
} from "@/lib/derivedMetrics";

export const SIM_BASE = { seed: 20260513, iterations: 2500, riskTolerance: 0.58 } as const;

// Bootstrap-band replication settings (kept here so the work runs ONCE on the
// server inside deriveAppData rather than 20× on the client during NexusSimulator
// hydration — the former /analytics TBT hotspot).
const BAND_REPLICATES = 20;
const BAND_ITERATIONS = 800;

export interface ReplicationRange {
  championship: ConfidenceInterval;
  playoff: ConfidenceInterval;
}

/**
 * The MONTE-CARLO REPLICATION RANGE of the season simulation's championship and
 * playoff frequencies: how much the number moves when the same model is re-run
 * on the same inputs under a different pseudo-random seed.
 *
 * Renamed from `deriveConfidenceBands` (audit 2026-08-22, P0-4). Two defects
 * were reproduced by `scripts/measure-scenario-bands.ts` before this change:
 *
 * 1. **It was called a confidence interval and is not one.** Every input, every
 *    parameter and the model itself are held fixed across replicates, so the
 *    only thing that varies is the random draw. On the fixture league the range
 *    is 1.45pp (playoffs) and 0.86pp (championship), while the shipped chain's
 *    MEASURED out-of-sample calibration error is 16.13pp — the interval is
 *    ~11x too narrow to stand for the error we have actually measured. A
 *    reader who takes it as a confidence interval is being told the forecast is
 *    an order of magnitude more certain than the backtest says it is.
 *
 *    (The audit's own estimate of "~30x, ECE 28-30pp" was wrong; the measured
 *    figures are in reports/2026-08-20/AUDIT-LEDGER.md and protocol 2.)
 *
 * 2. **The interval did not contain its own point estimate.** The displayed
 *    number came from ONE run at `SIM_BASE.iterations`; the band was
 *    bootstrapped over `BAND_REPLICATES` runs at the smaller `BAND_ITERATIONS`.
 *    Two different estimators, so nothing forced agreement — and the fixture
 *    league printed `Playoffs 69.6% [68.1 - 69.6]`, an estimate sitting outside
 *    its own interval.
 *
 * The fix for (2) is to use the replicate spread for what it can measure — the
 * HALF-WIDTH — and centre it on the estimate actually being displayed. The
 * range then always contains its point by construction, and it still reports
 * exactly the quantity it is able to observe.
 */
export function deriveReplicationRange(
  players: RAEEnvelope["records"],
  simParams: SimulationParams,
  /** The estimates actually shown to the reader, from the full-iteration run. */
  point: { championship: number; playoff: number }
): ReplicationRange | null {
  if (players.length === 0) return null;
  const champ: number[] = [];
  const playoff: number[] = [];
  for (let i = 0; i < BAND_REPLICATES; i++) {
    const r = runNexusSimulation(players, { ...simParams, seed: simParams.seed + i, iterations: BAND_ITERATIONS });
    champ.push(r.championshipProbability);
    playoff.push(r.playoffProbability);
  }
  return {
    championship: centreOn(bootstrapCI(champ, 0.95, 500, 1019), point.championship),
    playoff: centreOn(bootstrapCI(playoff, 0.95, 500, 1019), point.playoff)
  };
}

/**
 * Re-centre a bootstrap interval on the estimate being displayed, preserving
 * its width. Clamped to [0, 100] because a probability outside that range is
 * not a thing that can be shown.
 */
function centreOn(ci: ConfidenceInterval, estimate: number): ConfidenceInterval {
  const half = ci.width / 2;
  const lower = Math.max(0, estimate - half);
  const upper = Math.min(100, estimate + half);
  return { estimate, lower, upper, width: upper - lower, level: ci.level };
}

export interface AppData {
  /** The user's own roster (Command Center / Nexus / Narrative all derive from this). */
  players: RAEEnvelope["records"];
  /** Whole-league draftable universe (pre-draft) → falls back to draftPool → roster. */
  universePool: RAEEnvelope["records"];
  /** Free agents (post-draft) → falls back to the universe. */
  freeAgentPool: RAEEnvelope["records"];
  /** Market-facing pool: universe pre-draft, free agents post-draft, roster otherwise. */
  marketPool: RAEEnvelope["records"];
  sim: SimulationResult;
  commandMetrics: CommandMetrics;
  marketMetrics: MarketMetrics;
  scenarios: ScenarioComparison;
  /**
   * Server-computed Monte-Carlo REPLICATION RANGE for NexusSimulator (null when
   * no roster). Not a confidence interval — see `deriveReplicationRange`.
   */
  replicationRange: ReplicationRange | null;
  /**
   * The connected league's format, or null when no league is connected.
   * Exposed (audit F-010) so panels can derive format-correct targets instead
   * of assuming a 12-team 1QB PPR league.
   */
  leagueFormat: RAEEnvelope["leagueFormat"] | null;
}

/**
 * Single source of truth for the per-render derived values every panel needs —
 * extracted verbatim from the former `RaeApp` body so each route view computes
 * pools/sim/metrics identically. Pure (seeded sim), so it is safe to call from
 * any client route view.
 */
export function deriveAppData(envelope: RAEEnvelope): AppData {
  const players = envelope.records;

  // Sprint 5 pool model: market-facing panels show the whole league universe
  // PRE-draft and only free agents POST-draft; Command Center + Nexus stay on
  // the user's own roster. `unknown` (fixtures) falls back to the roster.
  const draftState = envelope.draftState ?? "unknown";
  const universePool =
    envelope.leagueUniverse && envelope.leagueUniverse.length > 0
      ? envelope.leagueUniverse
      : envelope.draftPool && envelope.draftPool.length > 0
        ? envelope.draftPool
        : players;
  const freeAgentPool =
    envelope.freeAgents && envelope.freeAgents.length > 0 ? envelope.freeAgents : universePool;
  const marketPool =
    draftState === "pre" ? universePool : draftState === "post" ? freeAgentPool : players;

  // Season-sim params from the connected league (falls back to a standard
  // 12-team / 6-playoff / 9-starter league), wired with real weekly projections
  // when the cron has them.
  const fmt = envelope.leagueFormat;
  const rosterSlots = fmt?.starters
    ? Math.max(1, Object.values(fmt.starters).reduce((a, b) => a + b, 0))
    : 9;
  // Record -> Map, still carrying all three scoring variants. The simulator
  // picks the numeric from `scoringFormat` below (audit 2026-08-20 §7), so this
  // layer never decides a unit.
  const weeklyProjections: Map<string, WeeklyProjectionByFormat> | null =
    envelope.weeklyProjections ? new Map(Object.entries(envelope.weeklyProjections)) : null;
  const simParams = {
    ...SIM_BASE,
    rosterSlots,
    numTeams: fmt?.numTeams ?? 12,
    playoffTeams: fmt?.playoffTeams ?? 6,
    regularSeasonWeeks: fmt?.playoffWeekStart ? Math.max(1, fmt.playoffWeekStart - 1) : 14,
    // The opponent field must be scored on the league's scale, not always PPR
    // (audit F-010) — otherwise a standard league's odds are biased down.
    scoringFormat: fmt?.scoringFormat ?? "PPR",
    weeklyProjections
  };

  const sim = runNexusSimulation(players, simParams);
  const commandMetrics = deriveCommandMetrics(players);
  const marketMetrics = deriveMarketMetrics(marketPool);
  const scenarios = deriveScenarioComparison(players, sim);
  const replicationRange = deriveReplicationRange(players, simParams, {
    championship: sim.championshipProbability,
    playoff: sim.playoffProbability
  });

  return {
    players,
    universePool,
    freeAgentPool,
    marketPool,
    sim,
    commandMetrics,
    marketMetrics,
    scenarios,
    replicationRange,
    leagueFormat: fmt ?? null
  };
}
