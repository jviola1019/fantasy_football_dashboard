/**
 * Rank correlation, with one home.
 *
 * `pearson`, `rankAverage`, `spearman` and `partialSpearman` were defined inside
 * `scripts/holdout-evaluate-4.ts`, which meant the statistic that decided
 * whether usage ships lived in a file nothing else could import. The next
 * analysis either re-implemented them or did without.
 *
 * That is the shape of the `fingerprintRows` defect: two callers computing the
 * same quantity, disagreeing, and nothing noticing because neither could see the
 * other. A comparison statistic with two implementations is worse than one,
 * because it looks authoritative while comparing nothing.
 */

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Ranks, averaging ties.
 *
 * Ties matter here rather than being a nicety: fantasy data is full of them —
 * every player with zero carries shares a rank — and assigning them arbitrary
 * distinct ranks would manufacture an ordering the data does not contain.
 */
export function rankAverage(xs: readonly number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]!]! === xs[idx[i]!]!) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[idx[k]!] = avg;
    i = j + 1;
  }
  return out;
}

/** Pearson product-moment correlation. Returns 0 when either side is constant. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) {
    throw new Error(`pearson: length mismatch ${xs.length} vs ${ys.length}`);
  }
  if (xs.length < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let n = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    n += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
}

/** Spearman rank correlation. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return pearson(rankAverage(xs), rankAverage(ys));
}

/**
 * Partial Spearman of `x` with `y`, controlling for `c`.
 *
 * This is the statistic that answers "does x tell us anything BEYOND c". A plain
 * correlation of usage with next-half scoring is dominated by "good players get
 * more usage and also score more", which says nothing about incremental value —
 * and reporting it as though it did is how a redundant variable gets shipped.
 */
export function partialSpearman(
  x: readonly number[],
  y: readonly number[],
  c: readonly number[]
): number {
  const rxy = spearman(x, y);
  const rxc = spearman(x, c);
  const ryc = spearman(y, c);
  const den = Math.sqrt((1 - rxc * rxc) * (1 - ryc * ryc));
  return den > 1e-12 ? (rxy - rxc * ryc) / den : 0;
}

/**
 * Two-sided p-value for a Spearman correlation, via the t approximation.
 *
 * `t = r·sqrt((n−2)/(1−r²))` on n−2 df, and the normal tail is used for the df
 * here because every sample this is applied to has hundreds of rows, where the
 * t and normal tails agree to more decimals than the correlation itself is
 * worth. Stated rather than hidden: at n < 30 this would be optimistic.
 */
export function spearmanPValue(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 4) return 1;
  const rr = Math.min(0.999999, Math.abs(r));
  const t = rr * Math.sqrt((n - 2) / (1 - rr * rr));
  // Two-sided normal tail, Abramowitz & Stegun 26.2.17.
  const z = Math.abs(t);
  const k = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const upper =
    d * k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return Math.min(1, 2 * upper);
}
