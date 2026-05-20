import type { PlayerMarketRecord } from "./governance";
import { reputationEdge, marketInefficiency, narrativeVelocity, chaosExposure, liquidityScore } from "./models";
import { runNexusSimulation, type SimulationResult } from "./simulation";
import { avg, clamp, gradeFromScore } from "./utils";

const BASE_PARAMS = { seed: 20260513, iterations: 2500, rosterSlots: 6, riskTolerance: 0.58 } as const;

export type CommandMetrics = {
  reputationEdge: number;
  marketInefficiency: number;
  narrativeVelocity: number;
  leagueAdvantage: number;
  chaosExposure: number;
};

export type MarketMetrics = {
  inefficiencyPct: number;
  liquidityScore: number;
  arbitrageCount: number;
  priceDiscoveryPct: number;
  marketRegime: string;
  topInefficiencies: PlayerMarketRecord[];
};

export type ScenarioRow = {
  championship: number;
  topThree: number;
  playoffs: number;
  pointsFor: number;
  pointsAgainst: number;
  finalRank: number;
};

export type ScenarioComparison = {
  bestCase: ScenarioRow;
  baseline: ScenarioRow;
  worstCase: ScenarioRow;
};

export type PositionGrades = {
  overall: string;
  positions: Array<{ pos: string; grade: string }>;
};

export function deriveCommandMetrics(players: PlayerMarketRecord[]): CommandMetrics {
  const avgEdge = avg(players.map(reputationEdge));
  const leagueAdv = players.length ? clamp(50 + avgEdge * 2.8, 0, 100) : NaN;
  return {
    reputationEdge: avgEdge,
    marketInefficiency: avg(players.map(marketInefficiency)),
    narrativeVelocity: avg(players.map(narrativeVelocity)),
    leagueAdvantage: Math.round(leagueAdv),
    chaosExposure: avg(players.map(chaosExposure)),
  };
}

export function deriveNarrativeMovers(players: PlayerMarketRecord[]) {
  const sorted = [...players].sort((a, b) => narrativeVelocity(b) - narrativeVelocity(a));
  return {
    gainers: sorted.filter((p) => narrativeVelocity(p) > 0).slice(0, 5),
    decliners: [...sorted].reverse().filter((p) => narrativeVelocity(p) < 0).slice(0, 5),
  };
}

export function deriveMarketMetrics(players: PlayerMarketRecord[]): MarketMetrics {
  return {
    inefficiencyPct: avg(players.map(marketInefficiency)),
    liquidityScore: avg(players.map(liquidityScore)),
    arbitrageCount: players.filter((p) => Math.abs(reputationEdge(p)) > 8).length,
    priceDiscoveryPct: avg(players.map((p) => p.volatility * 0.18)),
    marketRegime: avg(players.map(marketInefficiency)) > 15 ? "Inefficient" : "Efficient",
    topInefficiencies: [...players]
      .sort((a, b) => Math.abs(reputationEdge(b)) - Math.abs(reputationEdge(a)))
      .slice(0, 5),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function simToRow(sim: SimulationResult, players: PlayerMarketRecord[], scale = 1.0): ScenarioRow {
  const basePoints = players.reduce((s, p) => s + p.trueValue, 0) * 16;

  // Every probability is clamped to [0, 100]. The three tiers are also forced
  // into the only ordering that is logically possible: winning the title
  // implies a top-3 finish, which implies making the playoffs. Without this a
  // best-case scale could print e.g. "Top 3: 114.8%".
  const championship = clamp(sim.championshipProbability * scale, 0, 100);
  const playoffs = clamp(sim.playoffProbability * scale, 0, 100);
  const topThree = clamp(championship * 3.4, championship, playoffs);

  return {
    championship: round1(championship),
    topThree: round1(topThree),
    playoffs: round1(playoffs),
    pointsFor: Math.round(basePoints * scale),
    pointsAgainst: Math.round(basePoints * (2 - scale) * 0.97),
    finalRank: Math.min(12, Math.max(1, Math.round((100 - playoffs) / 11) + 1)),
  };
}

export type OutcomeDistribution = {
  championship: number;
  topThree: number;
  playoffs: number;
  middlePack: number;
  bottomThree: number;
};

/**
 * Partition the season into five mutually exclusive final-standing buckets that
 * always sum to 100 and are each ≥ 0. Derived from the three simulation
 * outputs (championship %, playoff %, catastrophic risk %), then normalized so
 * the dashboard never shows buckets that over- or under-sum.
 */
export function deriveOutcomeDistribution(sim: SimulationResult): OutcomeDistribution {
  const champ = clamp(sim.championshipProbability, 0, 100);
  const playoff = clamp(sim.playoffProbability, 0, 100);
  const bottom = clamp(sim.catastrophicRisk, 0, 100);

  // Made playoffs but not 1st, split into "top 3" and "rest of playoffs".
  const aboveChamp = Math.max(0, playoff - champ);
  const topThree = Math.min(aboveChamp, champ * 2.0);
  const playoffsRest = Math.max(0, aboveChamp - topThree);
  // Missed playoffs and did not bottom out.
  const middlePack = Math.max(0, 100 - champ - topThree - playoffsRest - bottom);

  const raw = [champ, topThree, playoffsRest, middlePack, bottom];
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const norm = raw.map((v) => round1((v / sum) * 100));

  return {
    championship: norm[0]!,
    topThree: norm[1]!,
    playoffs: norm[2]!,
    middlePack: norm[3]!,
    bottomThree: norm[4]!
  };
}

export function deriveScenarioComparison(players: PlayerMarketRecord[], baseline: SimulationResult): ScenarioComparison {
  const best = runNexusSimulation(players, { ...BASE_PARAMS, riskTolerance: 0.9 });
  const worst = runNexusSimulation(players, { ...BASE_PARAMS, riskTolerance: 0.15 });
  return {
    bestCase: simToRow(best, players, 1.12),
    baseline: simToRow(baseline, players, 1.0),
    worstCase: simToRow(worst, players, 0.87),
  };
}

export function derivePositionGrades(players: PlayerMarketRecord[]): PositionGrades {
  const posSlots = ["QB", "RB", "WR", "TE", "FLEX", "DEF"];
  const edgeFor = (filter: (p: PlayerMarketRecord) => boolean) => {
    const group = players.filter(filter);
    return group.length ? avg(group.map(reputationEdge)) : 0;
  };
  const scores: Record<string, number> = {
    QB: edgeFor((p) => p.position === "QB"),
    RB: edgeFor((p) => p.position === "RB"),
    WR: edgeFor((p) => p.position === "WR"),
    TE: edgeFor((p) => p.position === "TE"),
    FLEX: edgeFor((p) => p.position === "RB" || p.position === "WR"),
    DEF: players.length ? (avg(players.map((p) => (p.fragility < 35 ? 6 : -4)))) : 0,
  };
  const overall = avg(players.map(reputationEdge));
  return {
    overall: gradeFromScore(overall),
    positions: posSlots.map((pos) => ({ pos, grade: gradeFromScore(scores[pos] ?? 0) })),
  };
}

export function deriveNarrativeHalfLife(players: PlayerMarketRecord[]): number {
  return avg(players.map((p) => Math.max(2, Math.round(80 - Math.abs(p.narrativePressure)))));
}

export function deriveViralVelocity(players: PlayerMarketRecord[]): string {
  const vel = avg(players.map(narrativeVelocity));
  if (!Number.isFinite(vel)) return "Unknown";
  if (vel > 15) return "High";
  if (vel > 5) return "Medium";
  return "Low";
}

export function deriveLiquidityDepth(players: PlayerMarketRecord[]): string {
  const total = players.reduce((s, p) => s + p.perceivedValue, 0) * 1000;
  return `$${(total / 1_000_000).toFixed(2)}M`;
}

export function deriveStartSitEdge(players: PlayerMarketRecord[]): Array<{ player: PlayerMarketRecord; proj: number; repl: number; edge: number }> {
  const sorted = [...players].sort((a, b) => reputationEdge(b) - reputationEdge(a));
  return sorted.slice(0, 5).map((player) => {
    const samePos = players.filter((p) => p.position === player.position && p.id !== player.id);
    const repl = samePos.length ? samePos.sort((a, b) => b.trueValue - a.trueValue)[0].trueValue : player.perceivedValue;
    return {
      player,
      proj: player.trueValue,
      repl,
      edge: Math.round((player.trueValue - repl) * 10) / 10,
    };
  });
}

export function deriveRisingStars(players: PlayerMarketRecord[]) {
  return [...players].sort((a, b) => narrativeVelocity(b) - narrativeVelocity(a)).slice(0, 5);
}

export function deriveStoryCollisions(players: PlayerMarketRecord[]) {
  return [...players]
    .sort((a, b) => Math.abs(b.narrativePressure) - Math.abs(a.narrativePressure))
    .slice(0, 2)
    .map((p) => ({
      player: p,
      story: `${p.name} ${p.narrativePressure > 0 ? "Surge" : "Fade"} Meets ${p.volatility > 50 ? "High Volatility" : "Stability"} Window`,
      impact: Math.abs(p.narrativePressure) > 45 ? "High" : "Medium",
    }));
}

export function chaosScore(players: PlayerMarketRecord[]): number {
  return avg(players.map(chaosExposure));
}
