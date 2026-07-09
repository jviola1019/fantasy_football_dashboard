import type { PlayerMarketRecord } from "./governance";
import { reputationEdge, marketInefficiency, narrativeVelocity, chaosExposure, liquidityScore } from "./models";
import { runNexusSimulation, deriveSeasonInputs, type SimulationResult } from "./simulation";
import { avg, clamp, gradeFromScore } from "./utils";

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
  const meanIneff = avg(players.map(marketInefficiency));
  return {
    inefficiencyPct: meanIneff,
    liquidityScore: avg(players.map(liquidityScore)),
    arbitrageCount: players.filter((p) => Math.abs(reputationEdge(p)) > 8).length,
    // Honest: the average week-to-week variance (volatility, 0-100), not a
    // rescaled "price discovery %". Surfaced as a "Volatility Index".
    priceDiscoveryPct: avg(players.map((p) => p.volatility)),
    // An empty pool has no market signal — don't assert "Efficient" on no data.
    marketRegime: players.length === 0 ? "Unknown" : meanIneff > 15 ? "Inefficient" : "Efficient",
    topInefficiencies: [...players]
      .sort((a, b) => Math.abs(reputationEdge(b)) - Math.abs(reputationEdge(a)))
      .slice(0, 5),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Estimated P(top-3 finish), shared by the Scenarios table and the Outcome
 * Multiverse so the same label can never show two different numbers (audit
 * 2026-07-08 F-07 — they previously used ×3.4 and ×2.0 respectively).
 *
 * The bracket sim measures Missed/Playoffs/Finalist/Champion but has no
 * third-place game, so "top 3" is NOT a simulated frequency: it is a rank-
 * scaling estimate ≈ 3× the championship frequency, floored at championship
 * (winning implies top-3) and capped at playoffs (top-3 implies a playoff
 * berth). Disclosed in the Scenarios UI as an estimate.
 */
export function estimateTopThree(championship: number, playoffs: number): number {
  return clamp(championship * 3.0, championship, playoffs);
}

function simToRow(
  sim: SimulationResult,
  weeklyFor: number,
  weeklyAgainst: number,
  weeks: number,
  scale = 1.0
): ScenarioRow {
  // Every probability is clamped to [0, 100]. The three tiers are also forced
  // into the only ordering that is logically possible: winning the title
  // implies a top-3 finish, which implies making the playoffs. Without this a
  // best-case scale could print e.g. "Top 3: 114.8%".
  const championship = clamp(sim.championshipProbability * scale, 0, 100);
  // A title run is always also a playoff run, so playoffs must be >= championship
  // even after independent best/worst-case `scale` multipliers. Enforcing this
  // first keeps the [championship, playoffs] clamp range well-ordered — otherwise
  // (playoffs < championship) the clamp would return topThree < championship and
  // break the "champ ⊆ top3 ⊆ playoffs" invariant this block exists to guarantee.
  const playoffs = Math.max(championship, clamp(sim.playoffProbability * scale, 0, 100));
  const topThree = estimateTopThree(championship, playoffs);

  return {
    championship: round1(championship),
    topThree: round1(topThree),
    playoffs: round1(playoffs),
    // Real season points: the team's expected weekly score (sum of starter
    // weekly means from the season model) × weeks, scaled for the scenario.
    // Points-against is the league-average opponent total (you face an average
    // schedule), so it does NOT scale with your own strength.
    pointsFor: Math.round(weeklyFor * weeks * scale),
    pointsAgainst: Math.round(weeklyAgainst * weeks),
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

  // Made playoffs but not 1st, split into "top 3" and "rest of playoffs" using
  // the same shared estimator as the Scenarios table (audit F-07).
  const aboveChamp = Math.max(0, playoff - champ);
  const topThree = Math.min(aboveChamp, Math.max(0, estimateTopThree(champ, playoff) - champ));
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
  // Best/worst share the baseline's REAL league format (numTeams / playoffTeams /
  // regularSeasonWeeks / weeklyProjections / seed / iterations) and differ ONLY by
  // riskTolerance — so the three scenario columns are apples-to-apples. (Previously
  // these used a hardcoded default-league BASE_PARAMS, which silently simulated the
  // best/worst rows against a different league than the baseline.)
  const best = runNexusSimulation(players, { ...baseline.params, riskTolerance: 0.9 });
  const worst = runNexusSimulation(players, { ...baseline.params, riskTolerance: 0.15 });
  // Anchor points to the real weekly model ONCE (from the baseline params) so
  // all three scenarios share the same team/field and differ only by the
  // best/worst scale — not by an incidental difference in starter count.
  const { team, field } = deriveSeasonInputs(players, baseline.params);
  const weeks = Math.max(1, baseline.params.regularSeasonWeeks ?? 14);
  return {
    bestCase: simToRow(best, team.meanWeekly, field.meanWeekly, weeks, 1.12),
    baseline: simToRow(baseline, team.meanWeekly, field.meanWeekly, weeks, 1.0),
    worstCase: simToRow(worst, team.meanWeekly, field.meanWeekly, weeks, 0.87),
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

/**
 * Aggregate roster-value index — the sum of players' perceivedValue (a unitless
 * 0–100 ECR-derived score), NOT a dollar figure. The old version multiplied by
 * 1000 and rendered "$X.XXM", inventing a currency magnitude the data never
 * had. Returns a compact unitless number string (e.g. "1.2k").
 */
export function deriveAggregateValueIndex(players: PlayerMarketRecord[]): string {
  const total = players.reduce((s, p) => s + p.perceivedValue, 0);
  if (!Number.isFinite(total) || total <= 0) return "—";
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(Math.round(total));
}

/**
 * Start/sit VALUE comparison. All three numbers are the unitless 0–100
 * ECR-derived value index (trueValue), NOT projected fantasy points —
 * `bestAlt` is the best OTHER same-position player on the roster, not a
 * league replacement level. The UI must label these as value scores
 * (audit 2026-07-08 F-01: they were headed "Projected points").
 */
export function deriveStartSitEdge(players: PlayerMarketRecord[]): Array<{ player: PlayerMarketRecord; value: number; bestAlt: number; edge: number }> {
  const sorted = [...players].sort((a, b) => reputationEdge(b) - reputationEdge(a));
  return sorted.slice(0, 5).map((player) => {
    const samePos = players.filter((p) => p.position === player.position && p.id !== player.id);
    const bestAlt = samePos.length ? samePos.sort((a, b) => b.trueValue - a.trueValue)[0].trueValue : player.perceivedValue;
    return {
      player,
      value: player.trueValue,
      bestAlt,
      edge: Math.round((player.trueValue - bestAlt) * 10) / 10,
    };
  });
}

export function deriveRisingStars(players: PlayerMarketRecord[]) {
  return [...players].sort((a, b) => narrativeVelocity(b) - narrativeVelocity(a)).slice(0, 5);
}

export function deriveStoryCollisions(players: PlayerMarketRecord[]) {
  return [...players]
    .sort((a, b) => Math.abs(b.trendingMomentum) - Math.abs(a.trendingMomentum))
    .slice(0, 2)
    .map((p) => ({
      player: p,
      story: `${p.name} ${p.trendingMomentum > 0 ? "Surge" : "Fade"} Meets ${p.volatility > 50 ? "High Volatility" : "Stability"} Window`,
      impact: Math.abs(p.trendingMomentum) > 45 ? "High" : "Medium",
    }));
}

export function chaosScore(players: PlayerMarketRecord[]): number {
  return avg(players.map(chaosExposure));
}
