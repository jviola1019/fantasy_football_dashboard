import { mulberry32 } from "./rng";

/**
 * Season Monte Carlo — a real fantasy-football season simulator.
 *
 * Replaces the old "roster strength vs. a magic threshold" heuristic with an
 * actual simulated season: every team plays a round-robin schedule, each weekly
 * matchup is decided by sampled weekly scores, standings seed a single-
 * elimination playoff bracket (with byes for the top seeds), and the champion is
 * the bracket winner. Over many simulated seasons this yields genuinely
 * calibrated playoff / championship probabilities for the user's team.
 *
 * Model (two-level / hierarchical):
 *   - The USER team has a fixed weekly-scoring distribution N(meanWeekly, sigma).
 *   - Each OPPONENT draws a season-long strength ~ N(field.meanWeekly,
 *     betweenTeamSigma) and scores weekly ~ N(thatStrength, withinTeamSigma).
 * A team whose mean equals the field mean finishes at the median, so it makes
 * the playoffs ≈ playoffTeams/numTeams of the time — the calibration anchor.
 *
 * Deterministic and dependency-free (seeded via mulberry32 + Box–Muller).
 */

export interface TeamStrength {
  /** Expected weekly fantasy points for the team's starting lineup. */
  meanWeekly: number;
  /** Week-to-week standard deviation of the team's score. */
  sigmaWeekly: number;
}

export interface FieldModel {
  /** League-average team weekly score. */
  meanWeekly: number;
  /** Spread of season-long team quality across the league. */
  betweenTeamSigma: number;
  /** Typical week-to-week standard deviation of a team's score. */
  withinTeamSigma: number;
}

export interface SeasonSimConfig {
  seed: number;
  iterations: number;
  numTeams: number;
  regularSeasonWeeks: number;
  playoffTeams: number;
}

/**
 * Final-season outcome tiers for the user's team, deepest last. Mutually
 * exclusive and exhaustive — every simulated season lands in exactly one.
 */
export const OUTCOME_TIERS = ["Missed", "Playoffs", "Finalist", "Champion"] as const;
export type OutcomeTier = (typeof OUTCOME_TIERS)[number];

export interface SeasonSimResult {
  /** P(team makes the playoffs). */
  playoffProbability: number;
  /** P(team wins the championship). */
  championshipProbability: number;
  /** P(team earns a first-round bye = a top seed). */
  byeProbability: number;
  /** P(team finishes in the bottom third of the standings). */
  bottomProbability: number;
  /** Expected regular-season wins. */
  expectedWins: number;
  /**
   * Marginal P(team finishes the regular season with exactly W wins), indexed
   * by win total 0..regularSeasonWeeks. Sums to 1.
   */
  winsDistribution: number[];
  /**
   * JOINT P(W wins AND final tier), as `[winTotal][tierIndex]` where the tier
   * order is {@link OUTCOME_TIERS}. The whole matrix sums to 1, so a cell's
   * value is the true probability of that exact (wins, outcome) pair — visual
   * weight in a heatmap then matches real likelihood.
   */
  winOutcomeJoint: number[][];
  iterations: number;
}

/**
 * One standard-normal sample drawn from a uniform [0,1) RNG via Box–Muller.
 * Self-contained per call (consumes two uniforms, returns one normal) so it is
 * deterministic and safe across independent RNG streams.
 */
export function gaussian(rng: () => number): number {
  let u1 = rng();
  if (u1 < 1e-12) u1 = 1e-12; // guard log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Largest power of two ≤ n. */
function largestPow2LE(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/** Smallest power of two ≥ n. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Balanced round-robin schedule (circle method), cycled to fill `weeks`.
 * Returns weeks → list of [home, away] team-index pairs. RNG-free / fixed.
 */
function roundRobinSchedule(numTeams: number, weeks: number): Array<Array<[number, number]>> {
  const arr: number[] = [...Array(numTeams).keys()];
  if (numTeams % 2 !== 0) arr.push(-1); // odd → a bye slot
  const m = arr.length;
  const rounds: Array<Array<[number, number]>> = [];
  let rot = arr.slice();
  for (let r = 0; r < m - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < m / 2; i++) {
      const a = rot[i]!;
      const b = rot[m - 1 - i]!;
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Rotate keeping the first element fixed.
    rot = [rot[0]!, rot[m - 1]!, ...rot.slice(1, m - 1)];
  }
  const sched: Array<Array<[number, number]>> = [];
  for (let w = 0; w < weeks; w++) sched.push(rounds[w % rounds.length]!);
  return sched;
}

/**
 * Single-elimination playoff bracket with byes for the top seeds. Re-seeds each
 * round (best remaining vs. worst remaining). `seeded` is the playoff field in
 * seed order (best first). Returns the winning team index.
 */
function simulateBracket(
  seeded: number[],
  means: number[],
  sigmas: number[],
  rng: () => number
): { champion: number; runnerUp: number } {
  const seedRank = new Map<number, number>();
  seeded.forEach((t, i) => seedRank.set(t, i));
  let remaining = seeded.slice();
  let runnerUp = -1;
  while (remaining.length > 1) {
    const n = remaining.length;
    const pow2 = largestPow2LE(n);
    // A power-of-two field plays a full round (everyone pairs up); otherwise a
    // play-in round reduces the field to the next-lower power of two, with the
    // top seeds receiving byes. (Without the `n === pow2` case the play-in count
    // is 0 for a power-of-two field and the loop never shrinks → infinite loop.)
    const numPlaying = n === pow2 ? n : 2 * (n - pow2);
    const byes = remaining.slice(0, n - numPlaying);
    const playing = remaining.slice(n - numPlaying);
    const winners: number[] = [];
    for (let i = 0; i < playing.length / 2; i++) {
      const a = playing[i]!; // higher seed
      const b = playing[playing.length - 1 - i]!; // lower seed
      const sa = means[a]! + gaussian(rng) * sigmas[a]!;
      const sb = means[b]! + gaussian(rng) * sigmas[b]!;
      const winner = sa >= sb ? a : b;
      const loser = sa >= sb ? b : a;
      winners.push(winner);
      // The final is the round where exactly two teams play; its loser is the
      // runner-up. (n === 2 ⇒ pow2 === 2 ⇒ numPlaying === 2, no byes.)
      if (n === 2) runnerUp = loser;
    }
    remaining = [...byes, ...winners].sort((x, y) => seedRank.get(x)! - seedRank.get(y)!);
  }
  return { champion: remaining[0]!, runnerUp };
}

export function runSeasonSimulation(
  team: TeamStrength,
  field: FieldModel,
  config: SeasonSimConfig
): SeasonSimResult {
  const numTeams = Math.max(2, Math.floor(config.numTeams));
  const weeks = Math.max(1, Math.floor(config.regularSeasonWeeks));
  const playoffTeams = Math.max(1, Math.min(Math.floor(config.playoffTeams), numTeams));
  const iterations = Math.max(100, Math.min(Math.floor(config.iterations), 50_000));
  const rng = mulberry32(config.seed);

  const schedule = roundRobinSchedule(numTeams, weeks);
  const byeCount = nextPow2(playoffTeams) - playoffTeams; // top seeds that get a bye
  const bottomThreshold = Math.ceil((numTeams * 2) / 3); // bottom third = seed > 2N/3

  let playoffHits = 0;
  let champHits = 0;
  let byeHits = 0;
  let bottomHits = 0;
  let totalWins = 0;

  // Per-win-total counts (marginal) and joint (wins × outcome-tier) counts.
  // Tier index follows OUTCOME_TIERS: 0 Missed, 1 Playoffs, 2 Finalist, 3 Champion.
  const winsCount = new Array<number>(weeks + 1).fill(0);
  const jointCount: number[][] = Array.from({ length: weeks + 1 }, () => [0, 0, 0, 0]);

  const means = new Array<number>(numTeams);
  const sigmas = new Array<number>(numTeams);

  for (let it = 0; it < iterations; it++) {
    // Team 0 = the user (fixed). Opponents draw a season strength.
    means[0] = team.meanWeekly;
    sigmas[0] = team.sigmaWeekly;
    for (let t = 1; t < numTeams; t++) {
      means[t] = field.meanWeekly + gaussian(rng) * field.betweenTeamSigma;
      sigmas[t] = field.withinTeamSigma;
    }

    const wins = new Array<number>(numTeams).fill(0);
    const pf = new Array<number>(numTeams).fill(0);
    for (const week of schedule) {
      for (const [a, b] of week) {
        const sa = means[a]! + gaussian(rng) * sigmas[a]!;
        const sb = means[b]! + gaussian(rng) * sigmas[b]!;
        pf[a]! += sa;
        pf[b]! += sb;
        if (sa > sb) wins[a]!++;
        else if (sb > sa) wins[b]!++;
        else if (rng() < 0.5) wins[a]!++;
        else wins[b]!++;
      }
    }
    const userWins = wins[0]!;
    totalWins += userWins;
    winsCount[userWins]!++;

    // Seed by (wins desc, points-for desc).
    const order = [...Array(numTeams).keys()].sort((x, y) => wins[y]! - wins[x]! || pf[y]! - pf[x]!);
    const userSeed = order.indexOf(0) + 1;
    if (userSeed <= playoffTeams) playoffHits++;
    if (userSeed <= byeCount) byeHits++;
    if (userSeed > bottomThreshold) bottomHits++;

    // Resolve the user's final outcome tier for the joint (wins × outcome) grid.
    let tier = 0; // Missed
    if (userSeed <= playoffTeams) {
      const { champion, runnerUp } = simulateBracket(order.slice(0, playoffTeams), means, sigmas, rng);
      if (champion === 0) {
        tier = 3; // Champion
        champHits++;
      } else if (runnerUp === 0) {
        tier = 2; // Finalist (lost the championship game)
      } else {
        tier = 1; // Made playoffs, eliminated before the final
      }
    }
    jointCount[userWins]![tier]!++;
  }

  return {
    playoffProbability: playoffHits / iterations,
    championshipProbability: champHits / iterations,
    byeProbability: byeHits / iterations,
    bottomProbability: bottomHits / iterations,
    expectedWins: totalWins / iterations,
    winsDistribution: winsCount.map((c) => c / iterations),
    winOutcomeJoint: jointCount.map((row) => row.map((c) => c / iterations)),
    iterations
  };
}
