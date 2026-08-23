/**
 * P2-6 magnitude check: how much did the raw between-team sigma over-disperse
 * the simulated field?
 *
 * A team's season mean is estimated from W weekly games, so the observed spread
 * of season means carries a sampling term:
 *
 *     Var(observed means) = Var(true strength) + Var(weekly) / W
 *
 * `buildLeagueModels` used the raw standard deviation, so the simulator drew
 * opponents from an inflated spread AND added weekly noise on top -- counting
 * within-team variance twice.
 *
 * This script generates leagues with a KNOWN true between-team sigma, so the
 * old and new estimators can be compared against the truth rather than against
 * each other.
 *
 * Run: npm run measure:sigma
 */
import { buildLeagueModels } from "../src/lib/stats/seasonCalibration";
import { mulberry32 } from "../src/lib/rng";

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function simulateLeague(
  rng: () => number,
  { numTeams, weeks, fieldMean, trueBetween, within }: {
    numTeams: number; weeks: number; fieldMean: number; trueBetween: number; within: number;
  }
): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < numTeams; t += 1) {
    const strength = fieldMean + gaussian(rng) * trueBetween;
    const wk: number[] = [];
    for (let w = 0; w < weeks; w += 1) wk.push(strength + gaussian(rng) * within);
    out.push(wk);
  }
  return out;
}

/** The estimator that shipped before the fix, reproduced for comparison. */
function rawBetweenSigma(weeklyByTeam: number[][]): number {
  const means = weeklyByTeam.map((w) => w.reduce((a, b) => a + b, 0) / w.length);
  const m = means.reduce((a, b) => a + b, 0) / means.length;
  const v = means.reduce((a, b) => a + (b - m) ** 2, 0) / (means.length - 1);
  return Math.sqrt(v);
}

function main() {
  const TRUE_BETWEEN = 14;
  const WITHIN = 25;
  const WEEKS = 14;
  const NUM_TEAMS = 12;
  const REPLICATES = 4000;

  const rng = mulberry32(20260823);
  let rawSum = 0;
  let fixedSum = 0;
  for (let r = 0; r < REPLICATES; r += 1) {
    const league = simulateLeague(rng, {
      numTeams: NUM_TEAMS,
      weeks: WEEKS,
      fieldMean: 110,
      trueBetween: TRUE_BETWEEN,
      within: WITHIN
    });
    rawSum += rawBetweenSigma(league);
    fixedSum += buildLeagueModels(league).field.betweenTeamSigma;
  }
  const raw = rawSum / REPLICATES;
  const fixed = fixedSum / REPLICATES;

  console.log(`true between-team sigma      ${TRUE_BETWEEN.toFixed(3)}`);
  console.log(`within-team sigma            ${WITHIN.toFixed(3)}  (${WEEKS} weeks, ${NUM_TEAMS} teams)`);
  console.log(`sampling term sqrt(w^2/W)    ${Math.sqrt((WITHIN ** 2) / WEEKS).toFixed(3)}`);
  console.log();
  console.log(`OLD estimator (raw stdev)    ${raw.toFixed(3)}   bias ${((raw / TRUE_BETWEEN - 1) * 100).toFixed(1)}%`);
  console.log(`NEW estimator (components)   ${fixed.toFixed(3)}   bias ${((fixed / TRUE_BETWEEN - 1) * 100).toFixed(1)}%`);
  console.log();
  console.log(`${REPLICATES} simulated leagues, seeded -- rerun reproduces exactly.`);
}

main();
