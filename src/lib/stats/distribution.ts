import { mulberry32 } from "../simulation";

/** Arithmetic mean. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Sample standard deviation (n - 1 denominator). */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  let sse = 0;
  for (const v of values) {
    const d = v - m;
    sse += d * d;
  }
  return Math.sqrt(sse / (values.length - 1));
}

/**
 * Empirical quantile (type 7 — linear interpolation between order statistics),
 * matching R's default `quantile()`. `p` is in [0, 1].
 */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  if (p <= 0) return Math.min(...values);
  if (p >= 1) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export interface ConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  /** Width of the CI = upper - lower. Useful for sanity assertions. */
  width: number;
  /** Two-sided confidence level used to build the CI, e.g. 0.95. */
  level: number;
}

/**
 * Non-parametric bootstrap confidence interval for the mean of `samples`.
 * Deterministic given a seed — uses the same Mulberry32 RNG as the simulation
 * engine so the dashboard's CIs are reproducible and audit-friendly.
 *
 * @param samples observed values
 * @param level two-sided coverage (0 < level < 1), e.g. 0.95
 * @param iterations number of bootstrap resamples; default 1000
 * @param seed PRNG seed; default 20260518
 */
export function bootstrapCI(
  samples: readonly number[],
  level = 0.95,
  iterations = 1000,
  seed = 20260518
): ConfidenceInterval {
  if (samples.length === 0) {
    return { estimate: Number.NaN, lower: Number.NaN, upper: Number.NaN, width: Number.NaN, level };
  }
  const rng = mulberry32(seed);
  const n = samples.length;
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      s += samples[idx]!;
    }
    means[i] = s / n;
  }
  const alpha = (1 - level) / 2;
  return {
    estimate: mean(samples),
    lower: quantile(means, alpha),
    upper: quantile(means, 1 - alpha),
    width: quantile(means, 1 - alpha) - quantile(means, alpha),
    level
  };
}

export interface WelchTTestResult {
  /** Welch's t statistic. */
  t: number;
  /** Welch-Satterthwaite approximate degrees of freedom. */
  df: number;
  /** Two-sided p-value approximated via normal-tail bound. */
  pTwoSided: number;
  meanDelta: number;
}

/**
 * Welch's two-sample t-test (unequal variances), two-sided.
 *
 * Returns an approximate p-value using the normal-tail bound (valid for large
 * df — typical for Monte Carlo with N >= 200). For small N use a t-distribution
 * lookup; we deliberately keep this dependency-free.
 */
export function welchTTest(a: readonly number[], b: readonly number[]): WelchTTestResult {
  if (a.length < 2 || b.length < 2) {
    return { t: Number.NaN, df: Number.NaN, pTwoSided: Number.NaN, meanDelta: Number.NaN };
  }
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a, ma);
  const vb = variance(b, mb);
  const na = a.length;
  const nb = b.length;
  const seDiff = Math.sqrt(va / na + vb / nb);
  if (seDiff === 0) {
    // Both samples have zero variance. If their means also coincide, the test is
    // trivially "no difference". If the means differ, the true t is infinite —
    // report ±Infinity and p ≈ 0 so callers don't silently see "no effect".
    const delta = ma - mb;
    if (delta === 0) return { t: 0, df: na + nb - 2, pTwoSided: 1, meanDelta: 0 };
    return {
      t: delta > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      df: na + nb - 2,
      pTwoSided: 0,
      meanDelta: delta
    };
  }
  const t = (ma - mb) / seDiff;
  const dfNum = Math.pow(va / na + vb / nb, 2);
  const dfDen = Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1);
  const df = dfNum / dfDen;
  return { t, df, pTwoSided: 2 * normalSf(Math.abs(t)), meanDelta: ma - mb };
}

/**
 * Cohen's d effect size (pooled standard deviation). Magnitudes:
 * 0.2 ≈ small, 0.5 ≈ medium, 0.8 ≈ large.
 */
export function cohensD(a: readonly number[], b: readonly number[]): number {
  if (a.length < 2 || b.length < 2) return Number.NaN;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a, ma);
  const vb = variance(b, mb);
  const pooled = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
  if (pooled === 0) return 0;
  return (ma - mb) / pooled;
}

function variance(values: readonly number[], m: number): number {
  let sse = 0;
  for (const v of values) {
    const d = v - m;
    sse += d * d;
  }
  return sse / (values.length - 1);
}

export interface OneWayAnovaResult {
  /** Number of groups (a.k.a. "treatments"). */
  k: number;
  /** Total number of observations across all groups. */
  n: number;
  /** F-statistic = MS_between / MS_within. */
  F: number;
  /** Degrees of freedom between groups (k - 1). */
  dfBetween: number;
  /** Degrees of freedom within groups (n - k). */
  dfWithin: number;
  /** Approximate two-sided p-value via normal-tail bound on sqrt(F). */
  pValue: number;
  /** Mean of each group, in input order. */
  groupMeans: number[];
  /** Grand mean across all observations. */
  grandMean: number;
}

/**
 * One-way analysis of variance. Tests the null hypothesis that the means of
 * every input group are equal. Returns an F-statistic, degrees of freedom,
 * and an approximate p-value.
 *
 * The p-value uses a normal-tail bound on sqrt(F), which is reasonable for
 * large dfWithin (typical for Monte Carlo with N >= 100 per group). For
 * small samples a real F-distribution CDF would be more accurate; we keep
 * this dependency-free.
 */
export function oneWayAnova(groups: readonly (readonly number[])[]): OneWayAnovaResult {
  const k = groups.length;
  if (k < 2) {
    return {
      k,
      n: groups.reduce((s, g) => s + g.length, 0),
      F: Number.NaN,
      dfBetween: Number.NaN,
      dfWithin: Number.NaN,
      pValue: Number.NaN,
      groupMeans: groups.map((g) => mean(g)),
      grandMean: Number.NaN
    };
  }
  const groupMeans = groups.map((g) => mean(g));
  let n = 0;
  let totalSum = 0;
  for (const g of groups) {
    n += g.length;
    for (const v of g) totalSum += v;
  }
  if (n < k + 1) {
    return {
      k,
      n,
      F: Number.NaN,
      dfBetween: k - 1,
      dfWithin: n - k,
      pValue: Number.NaN,
      groupMeans,
      grandMean: n > 0 ? totalSum / n : Number.NaN
    };
  }
  const grandMean = totalSum / n;
  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    const g = groups[i]!;
    const gm = groupMeans[i]!;
    ssBetween += g.length * (gm - grandMean) ** 2;
    for (const v of g) {
      const d = v - gm;
      ssWithin += d * d;
    }
  }
  const dfBetween = k - 1;
  const dfWithin = n - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  if (msWithin === 0) {
    // Every observation matches its group mean. If the group means also
    // coincide, F is indeterminate (0/0) — report NaN. Otherwise the test
    // is trivially significant, F is +Infinity, p ~ 0.
    const allEqualMeans = groupMeans.every((m) => Math.abs(m - grandMean) < 1e-12);
    return {
      k,
      n,
      F: allEqualMeans ? Number.NaN : Number.POSITIVE_INFINITY,
      dfBetween,
      dfWithin,
      pValue: allEqualMeans ? Number.NaN : 0,
      groupMeans,
      grandMean
    };
  }
  const F = msBetween / msWithin;
  // sqrt(F) is approximately t-distributed when k=2; for k>2 the bound below
  // is conservative but works for the "is anything different" signal CI needs.
  const pValue = F > 0 ? 2 * normalSf(Math.sqrt(F)) : 1;
  return { k, n, F, dfBetween, dfWithin, pValue, groupMeans, grandMean };
}

/**
 * Tukey-style "connecting letters" report for k groups. Computes pairwise
 * Welch t-tests with Bonferroni correction at the given alpha, then assigns
 * each group a string of letters such that two groups share a letter iff
 * they are NOT significantly different. Groups that share no letter are
 * significantly different at the corrected alpha.
 *
 * Letter assignment uses the classical greedy algorithm: order groups by
 * descending mean, then for each "letter" pass mark every group that is
 * statistically indistinguishable from the highest unmarked group.
 *
 * Output order matches input order. Use this for JMP / SAS-style reporting
 * of multi-group comparisons (e.g. "Risk tolerance 0.15 [a], 0.55 [b],
 * 0.95 [c]" means all three tolerances produce significantly different
 * championship distributions).
 */
export function connectingLetters(
  groups: readonly (readonly number[])[],
  alpha = 0.05
): string[] {
  const k = groups.length;
  if (k === 0) return [];
  if (k === 1) return ["a"];
  // Bonferroni-corrected pairwise alpha.
  const pairCount = (k * (k - 1)) / 2;
  const correctedAlpha = alpha / pairCount;
  // Pre-compute pairwise non-significance: notDiff[i][j] = true iff groups
  // i and j are NOT significantly different at the corrected alpha.
  const notDiff: boolean[][] = Array.from({ length: k }, () => new Array(k).fill(false));
  for (let i = 0; i < k; i++) {
    notDiff[i]![i] = true;
    for (let j = i + 1; j < k; j++) {
      const res = welchTTest(groups[i]!, groups[j]!);
      const same = !Number.isFinite(res.pTwoSided) || res.pTwoSided > correctedAlpha;
      notDiff[i]![j] = same;
      notDiff[j]![i] = same;
    }
  }
  // Order indexes by descending group mean; ties broken by original index.
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => {
    const ma = mean(groups[a]!);
    const mb = mean(groups[b]!);
    if (mb !== ma) return mb - ma;
    return a - b;
  });
  // Letter pass: in descending-mean order, each unlabeled group starts a new
  // letter; every subsequent group not significantly different from it
  // (transitively) gets that letter appended.
  const letters: string[] = new Array(k).fill("");
  let nextChar = 97; // "a"
  const labeled = new Set<number>();
  for (const seed of order) {
    if (labeled.has(seed)) continue;
    const letter = String.fromCharCode(nextChar++);
    letters[seed] += letter;
    labeled.add(seed);
    for (const other of order) {
      if (other === seed) continue;
      if (notDiff[seed]![other]) {
        letters[other] += letter;
        labeled.add(other);
      }
    }
  }
  // Any group still unlabeled is significantly different from everything ahead
  // of it; give it its own letter.
  for (let i = 0; i < k; i++) {
    if (letters[i] === "") {
      letters[i] = String.fromCharCode(nextChar++);
    }
  }
  return letters;
}

// ─── Brier score + Murphy decomposition ──────────────────────────────────────

export interface BrierForecast {
  /** Predicted probability of the binary outcome occurring, in [0, 1]. */
  prob: number;
  /** Actual outcome: 1 = event occurred, 0 = did not occur. */
  outcome: 0 | 1;
}

export interface BrierResult {
  /** Brier score = mean((prob − outcome)²). Lower is better; 0 is perfect. */
  score: number;
  /** Number of forecasts. */
  n: number;
  /** Murphy decomposition — reliability (calibration error). Lower is better. */
  reliability: number;
  /** Murphy decomposition — resolution (sharpness beyond climatology). Higher is better. */
  resolution: number;
  /**
   * Murphy decomposition — uncertainty (irreducible entropy of the base rate).
   * Brier score = reliability − resolution + uncertainty.
   */
  uncertainty: number;
}

/**
 * Compute the Brier score and Murphy decomposition for a set of binary
 * probability forecasts.
 *
 * Murphy decomposition:
 *   Brier = reliability − resolution + uncertainty
 * where:
 *   uncertainty  = clim * (1 − clim)   (base-rate variance)
 *   resolution   = Σ_k n_k/N * (ȳ_k − clim)²
 *   reliability  = Σ_k n_k/N * (f_k − ȳ_k)²
 *
 * Each bin k groups all forecasts with the same unique probability f_k;
 * for continuous probabilities this is a per-unique-value decomposition.
 * For binned reliability diagrams use `reliabilityDiagram` instead.
 */
export function brierScore(forecasts: ReadonlyArray<BrierForecast>): BrierResult {
  const n = forecasts.length;
  if (n === 0) {
    return { score: Number.NaN, n: 0, reliability: Number.NaN, resolution: Number.NaN, uncertainty: Number.NaN };
  }
  let sumSq = 0;
  let sumOutcomes = 0;
  for (const f of forecasts) {
    const diff = f.prob - f.outcome;
    sumSq += diff * diff;
    sumOutcomes += f.outcome;
  }
  const score = sumSq / n;
  const clim = sumOutcomes / n; // base rate (climatological probability)
  const uncertainty = clim * (1 - clim);

  // Group forecasts by unique probability value for Murphy decomposition.
  const bins = new Map<number, { sumOutcomes: number; count: number }>();
  for (const f of forecasts) {
    const key = f.prob;
    const bin = bins.get(key) ?? { sumOutcomes: 0, count: 0 };
    bin.sumOutcomes += f.outcome;
    bin.count += 1;
    bins.set(key, bin);
  }

  let reliability = 0;
  let resolution = 0;
  for (const [prob, { sumOutcomes: so, count }] of bins) {
    const obsMean = so / count; // observed frequency in this bin
    reliability += (count / n) * (prob - obsMean) ** 2;
    resolution += (count / n) * (obsMean - clim) ** 2;
  }

  return { score, n, reliability, resolution, uncertainty };
}

// ─── Reliability diagram ─────────────────────────────────────────────────────

export interface ReliabilityBin {
  /** Centre of the forecast-probability bin (e.g. 0.05 for the [0, 0.1) bucket). */
  binCenter: number;
  /** Mean forecast probability of all forecasts in this bin. */
  meanForecast: number;
  /** Observed frequency of the positive outcome in this bin. */
  observedFreq: number;
  /** Number of forecasts in this bin. */
  n: number;
}

/**
 * Build a reliability diagram (calibration curve) by binning forecasts into
 * equal-width probability intervals. A perfectly calibrated forecaster
 * produces a diagram where every point lies on the identity line y = x.
 *
 * @param forecasts  Array of { prob, outcome } pairs.
 * @param bins       Number of equal-width bins in [0, 1]. Default 10.
 */
export function reliabilityDiagram(
  forecasts: ReadonlyArray<BrierForecast>,
  bins = 10
): ReliabilityBin[] {
  const width = 1 / bins;
  const result: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b * width;
    const hi = lo + width;
    const center = lo + width / 2;
    const inBin = forecasts.filter(
      (f) => f.prob >= lo && (b === bins - 1 ? f.prob <= hi : f.prob < hi)
    );
    if (inBin.length === 0) continue;
    const sumProb = inBin.reduce((s, f) => s + f.prob, 0);
    const sumOut = inBin.reduce((s, f) => s + f.outcome, 0);
    result.push({
      binCenter: center,
      meanForecast: sumProb / inBin.length,
      observedFreq: sumOut / inBin.length,
      n: inBin.length
    });
  }
  return result;
}

// ─── k-fold cross-validation ─────────────────────────────────────────────────

export interface KFoldResult {
  /** Mean score across all k folds. */
  meanScore: number;
  /** Sample standard deviation of per-fold scores. */
  stdScore: number;
  /** Per-fold scores in fold order. */
  foldScores: number[];
}

/**
 * k-fold cross-validation. Splits `samples` into k equally-sized folds
 * (the last fold absorbs any remainder), then calls `evaluate(train, test)`
 * for each fold and returns the mean ± std of the resulting scores.
 *
 * The fold split uses the original sample order; callers that need random
 * splits should shuffle before passing. This keeps the function pure and
 * deterministic.
 *
 * @param samples  The full dataset.
 * @param k        Number of folds (must be ≥ 2 and ≤ samples.length).
 * @param evaluate Function called with (trainSet, testSet) that returns a
 *                 numeric score for this fold (e.g. Brier score).
 */
export function kFoldCV<T>(
  samples: T[],
  k: number,
  evaluate: (train: T[], test: T[]) => number
): KFoldResult {
  const n = samples.length;
  const clampedK = Math.max(2, Math.min(k, n));
  const foldSize = Math.floor(n / clampedK);
  const foldScores: number[] = [];

  for (let fold = 0; fold < clampedK; fold++) {
    const testStart = fold * foldSize;
    const testEnd = fold === clampedK - 1 ? n : testStart + foldSize;
    const test = samples.slice(testStart, testEnd);
    const train = [...samples.slice(0, testStart), ...samples.slice(testEnd)];
    foldScores.push(evaluate(train, test));
  }

  const ms = mean(foldScores);
  const sd = foldScores.length >= 2 ? stdev(foldScores) : 0;
  return { meanScore: ms, stdScore: sd, foldScores };
}

/**
 * Upper-tail of the standard normal distribution, via Abramowitz & Stegun 7.1.26
 * approximation of erfc. Accurate to ~1.5e-7. Used so we can compute p-values
 * without depending on a stats library.
 */
function normalSf(x: number): number {
  if (x < 0) return 1 - normalSf(-x);
  // 1 - Phi(x) = 0.5 * erfc(x / sqrt(2))
  const t = 1 / (1 + 0.3275911 * (x / Math.SQRT2));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return 0.5 * (1 - y);
}
