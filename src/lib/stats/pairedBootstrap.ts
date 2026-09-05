/**
 * Is model B's per-row loss lower than model A's, or is the gap noise?
 *
 * WHY A PAIRED TEST, AND WHY BOOTSTRAP.
 *
 * Comparing two models by their Brier scores gives one number each and no idea
 * whether the difference would survive another season. The comparison is
 * naturally PAIRED — both models score the SAME rows — and pairing removes the
 * enormous row-to-row variance in difficulty that otherwise swamps a small mean
 * difference. Treating the two score vectors as independent samples (a Welch
 * t-test, which this module deliberately does not reuse) throws that away and is
 * far too conservative.
 *
 * Bootstrap rather than a paired t-test because per-row Brier differences are
 * nothing like normal: most rows are near zero, a minority are large, and the
 * distribution is heavily skewed. Resampling makes no shape assumption.
 *
 * WHAT THE p-VALUE MEANS HERE, stated because it is easy to overclaim. It is a
 * two-sided bootstrap p-value for "the mean paired difference is zero",
 * computed by recentring the resampled means on zero and asking how often a gap
 * at least this large appears. It answers "could this dataset have produced this
 * gap by chance", NOT "will this hold next season" — for that, the gauntlet
 * additionally requires the gap to appear out of fold.
 *
 * NEGATIVE `meanDifference` MEANS B IS BETTER, because these are LOSSES. Signed
 * that way round on purpose: a "difference" that silently means "improvement"
 * is how a sign error ships.
 */
import { mulberry32 } from "../rng";

export interface PairedComparison {
  /** mean(b) − mean(a). Negative means B has the lower loss, i.e. B is better. */
  meanDifference: number;
  lower: number;
  upper: number;
  /** Two-sided bootstrap p-value against a mean difference of zero. */
  pValue: number;
  n: number;
  level: number;
}

/**
 * Paired bootstrap over `lossA` and `lossB`, which must be aligned row for row.
 *
 * Resampling draws whole PAIRS, never a row's A-loss beside another row's
 * B-loss — that would rebuild the independent-samples comparison this exists to
 * avoid.
 */
export function pairedBootstrap(
  lossA: readonly number[],
  lossB: readonly number[],
  level = 0.95,
  iterations = 2000,
  seed = 20260903
): PairedComparison {
  if (lossA.length !== lossB.length) {
    throw new Error(`pairedBootstrap: ${lossA.length} vs ${lossB.length} losses`);
  }
  const n = lossA.length;
  if (n === 0) {
    return { meanDifference: Number.NaN, lower: Number.NaN, upper: Number.NaN, pValue: 1, n: 0, level };
  }

  const diff = new Array<number>(n);
  let observed = 0;
  for (let i = 0; i < n; i += 1) {
    diff[i] = lossB[i]! - lossA[i]!;
    observed += diff[i]!;
  }
  observed /= n;

  const rand = mulberry32(seed);
  const means = new Array<number>(iterations);
  for (let it = 0; it < iterations; it += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) s += diff[Math.floor(rand() * n)]!;
    means[it] = s / n;
  }
  means.sort((a, b) => a - b);

  const alpha = (1 - level) / 2;
  const at = (p: number) => means[Math.min(iterations - 1, Math.max(0, Math.floor(p * iterations)))]!;

  // Recentre on the null before counting: the resampled distribution is centred
  // on the OBSERVED mean, so counting tail mass directly would answer a
  // different question and always look significant.
  let atLeastAsExtreme = 0;
  for (const m of means) if (Math.abs(m - observed) >= Math.abs(observed)) atLeastAsExtreme += 1;
  // +1 in both parts so a p-value can never be exactly 0, which would overstate
  // certainty the resample count cannot support.
  const pValue = Math.min(1, (atLeastAsExtreme + 1) / (iterations + 1));

  return { meanDifference: observed, lower: at(alpha), upper: at(1 - alpha), pValue, n, level };
}
