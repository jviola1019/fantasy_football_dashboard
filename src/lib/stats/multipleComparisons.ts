/**
 * Holm–Bonferroni step-down correction, and the cluster bootstrap.
 *
 * Extracted 2026-08-25 for protocol 7. `holm` existed as four byte-similar
 * copies in `holdout-evaluate-{2,3,4,5}.ts`, and protocol 7 would have been a
 * fifth. Those four are deliberately left alone: they are executed-protocol
 * archives whose results must keep reproducing byte-identically from the
 * committed code, so editing them to import this would trade a real guarantee
 * for tidiness. New work uses this.
 */

export interface HolmTest {
  id: string;
  p: number;
}

export interface HolmResult extends HolmTest {
  /** The α this test had to clear, given its rank. */
  threshold: number;
  reject: boolean;
}

/**
 * Step-down Holm–Bonferroni at family-wise error rate `alpha`.
 *
 * Sort ascending by p; test i must clear α/(m−i); the first failure stops the
 * procedure and everything after it is retained regardless of its own p-value.
 * That last part is what makes it Holm rather than "Bonferroni per test", and
 * omitting it inflates the family-wise error rate — so it is pinned by a test.
 */
export function holmBonferroni(tests: readonly HolmTest[], alpha = 0.05): HolmResult[] {
  const ordered = [...tests].sort((a, b) => a.p - b.p);
  const m = ordered.length;
  const out: HolmResult[] = [];
  let stillRejecting = true;
  ordered.forEach((t, i) => {
    const threshold = alpha / (m - i);
    const reject = stillRejecting && t.p <= threshold;
    if (!reject) stillRejecting = false;
    out.push({ ...t, threshold, reject });
  });
  return out;
}

export interface BootstrapInterval {
  point: number;
  lower: number;
  upper: number;
  /** Two-sided p-value from the sign of the resampled distribution. */
  p: number;
  resamples: number;
}

/**
 * Percentile bootstrap over CLUSTERS, not rows.
 *
 * Rows from one player are not independent — a player's weeks share his talent,
 * his offence and his role. Resampling rows would treat 17 correlated
 * observations as 17 independent ones and produce an interval far too narrow,
 * which is how a null result gets reported as significant. Resampling whole
 * players keeps the dependence intact.
 *
 * `statistic` is handed the row indices of one resample and returns the value.
 *
 * The p-value is the standard two-sided bootstrap proportion: twice the smaller
 * tail, clamped to [1/(B+1), 1], so it can never be reported as exactly zero —
 * B resamples cannot evidence a p below that.
 */
export function clusterBootstrap(
  clusters: readonly string[],
  statistic: (indices: readonly number[]) => number,
  options: { resamples: number; rand: () => number; alpha?: number }
): BootstrapInterval {
  const alpha = options.alpha ?? 0.05;

  const byCluster = new Map<string, number[]>();
  clusters.forEach((c, i) => {
    const list = byCluster.get(c);
    if (list) list.push(i);
    else byCluster.set(c, [i]);
  });
  const keys = [...byCluster.keys()];

  const point = statistic(clusters.map((_, i) => i));

  const draws: number[] = [];
  for (let b = 0; b < options.resamples; b += 1) {
    const idx: number[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      const key = keys[Math.floor(options.rand() * keys.length)]!;
      idx.push(...byCluster.get(key)!);
    }
    const value = statistic(idx);
    if (Number.isFinite(value)) draws.push(value);
  }

  if (draws.length === 0) {
    return { point, lower: Number.NaN, upper: Number.NaN, p: 1, resamples: 0 };
  }

  draws.sort((a, b) => a - b);
  const at = (q: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))]!;

  const below = draws.filter((d) => d < 0).length;
  const above = draws.filter((d) => d > 0).length;
  const smaller = Math.min(below, above);
  const p = Math.min(1, Math.max(1 / (draws.length + 1), (2 * smaller) / draws.length));

  return {
    point,
    lower: at(alpha / 2),
    upper: at(1 - alpha / 2),
    p,
    resamples: draws.length
  };
}
