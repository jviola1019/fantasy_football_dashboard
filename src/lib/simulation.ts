import type { PlayerMarketRecord, SourceMeta } from "./governance";
import { chaosExposure, reputationEdge } from "./models";

export type SimulationParams = {
  seed: number;
  iterations: number;
  rosterSlots: number;
  riskTolerance: number;
  // When present, each player's trueValue is overridden with their weekly
  // projected pts_ppr before the Monte Carlo loop. Off-season / when the
  // cron has not fired: this field is absent and season-aggregate trueValue
  // is used unchanged.
  weeklyProjections?: Map<string, number> | null;
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

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a function that maps a weekly projected-points value onto the same
 * 0-100 scale as `trueValue`, using a linear min-max match between the two
 * ranges as observed across the players that have a projection. Returns the
 * identity when there are too few projected players to fit a range (the
 * weekly path is then effectively unused). Pure; no RNG.
 */
export function buildProjectionScaler(
  players: PlayerMarketRecord[],
  weeklyProjections: Map<string, number> | null
): (pts: number) => number {
  if (!weeklyProjections || weeklyProjections.size === 0) return (pts) => pts;
  const projVals: number[] = [];
  const tvVals: number[] = [];
  for (const p of players) {
    const wp = weeklyProjections.get(p.id);
    if (wp != null) {
      projVals.push(wp);
      tvVals.push(p.trueValue);
    }
  }
  if (projVals.length < 2) return (pts) => pts;
  const pMin = Math.min(...projVals);
  const pMax = Math.max(...projVals);
  const tMin = Math.min(...tvVals);
  const tMax = Math.max(...tvVals);
  const pSpan = pMax - pMin || 1;
  const tSpan = tMax - tMin || 1;
  return (pts) => tMin + ((pts - pMin) / pSpan) * tSpan;
}

export function runNexusSimulation(players: PlayerMarketRecord[], params: SimulationParams): SimulationResult {
  const rng = mulberry32(params.seed);
  const iterations = Math.max(100, Math.min(params.iterations, 50_000));
  let playoffHits = 0;
  let championshipHits = 0;
  let catastropheHits = 0;
  const drivers = new Map<string, number>();

  // The contention thresholds below (73/83/69) are calibrated to the 0-100
  // `trueValue` scale. Weekly Sleeper projections (`pts_ppr`) are a single-week
  // 0-~30 quantity, so feeding them in raw — or with a fixed ×2 — leaves every
  // roster far below the thresholds and collapses all probabilities to ~0%.
  // Instead, linearly map the projected-points range onto the trueValue range
  // observed across the SAME players, so a top-projected player lands near the
  // top of the trueValue scale and the thresholds stay meaningful on both paths.
  const projToScale = buildProjectionScaler(players, params.weeklyProjections ?? null);

  for (let i = 0; i < iterations; i += 1) {
    const sampled = players
      .map((player) => {
        // Use the (scale-matched) weekly projection when available; otherwise
        // fall back to the season-aggregate trueValue.
        const projectedPts = params.weeklyProjections?.get(player.id);
        const baseValue = projectedPts != null ? projToScale(projectedPts) : player.trueValue;
        const shock = (rng() - 0.5) * player.volatility;
        const score = baseValue + reputationEdge(player) * 0.8 + shock - chaosExposure(player) * (1 - params.riskTolerance) * 0.16;
        return { player, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, params.rosterSlots);

    const rosterScore = sampled.reduce((sum, item) => sum + item.score, 0) / Math.max(1, sampled.length);
    if (rosterScore > 73) playoffHits += 1;
    if (rosterScore > 83) championshipHits += 1;
    if (sampled.some((item) => chaosExposure(item.player) > 62) && rosterScore < 69) catastropheHits += 1;
    for (const item of sampled.slice(0, 3)) drivers.set(item.player.id, (drivers.get(item.player.id) ?? 0) + item.score / iterations);
  }

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

  return {
    seed: params.seed,
    params,
    championshipProbability: pct(championshipHits / iterations),
    playoffProbability: pct(playoffHits / iterations),
    catastrophicRisk: pct(catastropheHits / iterations),
    // regretIndex is a weighted composite (catastrophes + a fraction of
    // playoff misses). The raw weighted sum can exceed the iteration count, so
    // it is normalized by the worst-case weight before being expressed as a
    // percentage — it can never report an impossible >100%.
    regretIndex: pct(
      (catastropheHits + (iterations - playoffHits) * 0.35) / (iterations * 1.35)
    ),
    keyDrivers: Array.from(drivers.entries())
      .map(([id, contribution]) => ({ id, name: players.find((player) => player.id === id)?.name ?? id, contribution: Math.round(contribution * 10) / 10 }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5),
    assumptions: [
      "Monte Carlo shocks are seeded and replayable.",
      "These are a roster-strength contention HEURISTIC, not a season-simulated probability: there is no schedule, opponent, week-by-week scoring, or inter-player correlation. They report the fraction of sampled rosters whose top-N strength clears a contention bar on the 0-100 trueValue scale.",
      "Weekly projections, when connected, are range-matched onto the trueValue scale before thresholding (see buildProjectionScaler).",
      "Risk tolerance linearly reduces chaos penalty; this is documented and intentionally simple."
    ],
    source
  };
}

/**
 * Convert a 0..1 ratio to a one-decimal percentage, clamped to [0, 100].
 * The clamp is a hard guard: a probability or risk index must never render an
 * impossible value, regardless of upstream weighting.
 */
function pct(value: number): number {
  const bounded = Math.min(1, Math.max(0, value));
  return Math.round(bounded * 1000) / 10;
}
