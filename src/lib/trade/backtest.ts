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
 * Compute realized Value Over Replacement per player. The replacement baseline
 * for a position is the points of the player at `ranks[position]` (1-indexed),
 * or the lowest-scoring player at that position if the list is shorter.
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
