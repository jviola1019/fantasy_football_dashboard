import type { SimulationResult } from "./simulation";

export interface OutcomeHeat {
  /**
   * Row-major grid of CONDITIONAL probabilities P(outcome | wins): rows =
   * outcome tiers, cols = win totals. Each COLUMN sums to ~1.
   */
  data: number[][];
  xLabels: string[];
  yLabels: string[];
  /** Largest cell value (≤1) — callers normalise the colour ramp by this. */
  maxCell: number;
  caption: string;
}

/**
 * Build an outcome heatmap from the season sim's joint (wins × outcome)
 * distribution, shown CONDITIONALLY: each cell is P(playoff outcome | that win
 * total), so every column sums to ~100% and answers "if I finish with W wins,
 * what are my odds of each outcome?".
 *
 * Why conditional and not joint: the joint P(W wins AND outcome) makes a 14-0
 * column look dim simply because going 14-0 is RARE — which reads, wrongly, as
 * "winning more lowers your title odds". Conditioning on the win total removes
 * that illusion: the Champion share rises monotonically left→right with wins,
 * which is the real, intuitive relationship. (The marginal "how likely is each
 * win total" lives in the separate wins-distribution chart.)
 *
 * Columns are the win totals carrying the most marginal mass (≤6, ascending);
 * rows are the four outcome tiers with the deepest run on top. Shared by the
 * Nexus Simulator's Outcome Multiverse and Market Intelligence's Outcome
 * Probability Landscape. Returns null when there is no mass to chart.
 */
export function buildOutcomeHeat(dist: SimulationResult["distribution"]): OutcomeHeat | null {
  const { wins, joint, tiers } = dist;
  const totalMass = wins.reduce((s, p) => s + p, 0);
  if (totalMass <= 0) return null;

  // Win-total columns: the (≤6) totals with the most marginal mass, ascending.
  // 6 covers the central ~99% of a season's win distribution and keeps the
  // fixed-cell Heatmap2D readable at 3-up desktop widths.
  const cols = wins
    .map((p, w) => ({ w, p }))
    .filter((x) => x.p > 0.001)
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((x) => x.w)
    .sort((a, b) => a - b);
  if (cols.length === 0) return null;

  // Rows: deepest tier first (Champion → Finalist → Playoffs → Missed).
  // Each cell is conditioned on its column's win total: joint[w][ti] / P(W=w).
  const rowOrder = tiers.map((_, i) => i).reverse();
  const data = rowOrder.map((ti) =>
    cols.map((w) => {
      const marginal = wins[w] ?? 0;
      return marginal > 0 ? (joint[w]?.[ti] ?? 0) / marginal : 0;
    })
  );
  const yLabels = rowOrder.map((ti) => tiers[ti] ?? "");
  const xLabels = cols.map((w) => `${w} W`);
  const maxCell = Math.max(0.0001, ...data.flat());

  // Plain-English takeaway: at the MODAL win total (most likely record), what's
  // the dominant outcome and its conditional probability.
  const modalW = cols.reduce((best, w) => ((wins[w] ?? 0) > (wins[best] ?? 0) ? w : best), cols[0]!);
  const modalMarginal = wins[modalW] ?? 0;
  let bestTi = rowOrder[0]!;
  let bestP = -1;
  for (const ti of rowOrder) {
    const p = modalMarginal > 0 ? (joint[modalW]?.[ti] ?? 0) / modalMarginal : 0;
    if (p > bestP) {
      bestP = p;
      bestTi = ti;
    }
  }
  const caption =
    `P(playoff outcome | regular-season wins) over the simulated seasons — columns = final win total, ` +
    `each column sums to 100%. Most likely record is ${modalW} wins → ${tiers[bestTi]} (${Math.round(bestP * 100)}%).`;

  return { data, xLabels, yLabels, maxCell, caption };
}
