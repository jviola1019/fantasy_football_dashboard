import type { RAEEnvelope } from "@/lib/governance";
import { runNexusSimulation, type SimulationResult, type SimulationParams } from "@/lib/simulation";
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

export interface ConfidenceBands {
  championship: ConfidenceInterval;
  playoff: ConfidenceInterval;
}

/**
 * Bootstrap 95% CIs for the championship/playoff probabilities by re-running the
 * season sim across {@link BAND_REPLICATES} seeds. Deterministic (seeded), pure,
 * and serializable — computed server-side and passed to NexusSimulator, which
 * only applies the cheap data-state `widen()` client-side.
 */
export function deriveConfidenceBands(
  players: RAEEnvelope["records"],
  simParams: SimulationParams
): ConfidenceBands | null {
  if (players.length === 0) return null;
  const champ: number[] = [];
  const playoff: number[] = [];
  for (let i = 0; i < BAND_REPLICATES; i++) {
    const r = runNexusSimulation(players, { ...simParams, seed: simParams.seed + i, iterations: BAND_ITERATIONS });
    champ.push(r.championshipProbability);
    playoff.push(r.playoffProbability);
  }
  return {
    championship: bootstrapCI(champ, 0.95, 500, 1019),
    playoff: bootstrapCI(playoff, 0.95, 500, 1019)
  };
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
  /** Server-computed bootstrap CIs for NexusSimulator (null when no roster). */
  confidenceBands: ConfidenceBands | null;
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
  const weeklyProjections = envelope.weeklyProjections
    ? new Map(Object.entries(envelope.weeklyProjections))
    : null;
  const simParams = {
    ...SIM_BASE,
    rosterSlots,
    numTeams: fmt?.numTeams ?? 12,
    playoffTeams: fmt?.playoffTeams ?? 6,
    regularSeasonWeeks: fmt?.playoffWeekStart ? Math.max(1, fmt.playoffWeekStart - 1) : 14,
    weeklyProjections
  };

  const sim = runNexusSimulation(players, simParams);
  const commandMetrics = deriveCommandMetrics(players);
  const marketMetrics = deriveMarketMetrics(marketPool);
  const scenarios = deriveScenarioComparison(players, sim);
  const confidenceBands = deriveConfidenceBands(players, simParams);

  return {
    players,
    universePool,
    freeAgentPool,
    marketPool,
    sim,
    commandMetrics,
    marketMetrics,
    scenarios,
    confidenceBands,
    leagueFormat: fmt ?? null
  };
}
