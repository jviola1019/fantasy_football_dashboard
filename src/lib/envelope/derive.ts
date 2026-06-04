import type { RAEEnvelope } from "@/lib/governance";
import { runNexusSimulation, type SimulationResult } from "@/lib/simulation";
import {
  deriveCommandMetrics,
  deriveMarketMetrics,
  deriveScenarioComparison,
  type CommandMetrics,
  type MarketMetrics,
  type ScenarioComparison
} from "@/lib/derivedMetrics";

export const SIM_BASE = { seed: 20260513, iterations: 2500, riskTolerance: 0.58 } as const;

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

  return { players, universePool, freeAgentPool, marketPool, sim, commandMetrics, marketMetrics, scenarios };
}
