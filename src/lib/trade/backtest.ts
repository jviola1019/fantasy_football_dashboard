export interface SeasonPlayer {
  name: string;
  position: string;
  fantasyPoints: number;
}

/** Replacement-rank baseline per position for a 12-team, 1QB league. */
export const REPLACEMENT_RANKS: Record<string, number> = { QB: 13, RB: 25, WR: 37, TE: 13 };

function rank(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  order.forEach(([, originalIndex], sortedIndex) => {
    ranks[originalIndex] = sortedIndex + 1;
  });
  return ranks;
}

/** Spearman rank correlation between two equal-length numeric arrays. */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) return 0;
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (n + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i]! - mean;
    const dy = ry[i]! - mean;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

/**
 * Standardize a numeric array to z-scores: `(v - mean) / sampleStdev`.
 *
 * Used to pool realized VOR and trade value across NFL seasons. Absolute VOR is
 * not comparable season to season — scoring environments and injury years
 * differ — so each season's values are z-scored *within that season* before the
 * pairs are pooled. A constant input (zero variance) yields all zeros rather
 * than NaN, so degenerate buckets do not poison the pooled correlation.
 */
export function zScores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  if (n < 2) return values.map(() => 0);
  let sse = 0;
  for (const v of values) {
    const d = v - mean;
    sse += d * d;
  }
  const sd = Math.sqrt(sse / (n - 1));
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Compute realized Value Over Replacement per player. The replacement baseline
 * for a position is the points of the player at 0-based index `ranks[position]`
 * in the points-descending list (i.e. the (ranks[position]+1)-th best at that
 * position), or the lowest-scoring player if the list is shorter. The exact
 * offset is applied identically on both sides of the backtest, so it shifts the
 * baseline by one rank but does not bias the correlation.
 */
export function realizedVor(
  players: SeasonPlayer[],
  ranks: Record<string, number>
): Map<string, number> {
  const byPos = new Map<string, SeasonPlayer[]>();
  for (const p of players) {
    const list = byPos.get(p.position) ?? [];
    list.push(p);
    byPos.set(p.position, list);
  }
  const vor = new Map<string, number>();
  for (const [pos, list] of byPos) {
    const sorted = [...list].sort((a, b) => b.fantasyPoints - a.fantasyPoints);
    const idx = Math.min(ranks[pos] ?? sorted.length, sorted.length - 1);
    const baseline = sorted[idx]!.fantasyPoints;
    for (const p of sorted) vor.set(p.name, p.fantasyPoints - baseline);
  }
  return vor;
}
