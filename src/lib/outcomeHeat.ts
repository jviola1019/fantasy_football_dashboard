import type { SimulationResult } from "./simulation";

export interface OutcomeHeat {
  /** Row-major grid of joint probabilities (rows = outcome tiers, cols = win totals). */
  data: number[][];
  xLabels: string[];
  yLabels: string[];
  /** Largest cell value — callers normalise the colour ramp by this. */
  maxCell: number;
  caption: string;
}

/**
 * Build an outcome heatmap from the season sim's joint (wins × outcome)
 * distribution. Columns are the win totals carrying the most probability mass
 * (up to 8, shown ascending); rows are the four outcome tiers with the deepest
 * run on top. Each cell is the TRUE joint probability of that (wins, outcome)
 * pair — so the grid sums to ~100% and cell intensity reflects real likelihood.
 *
 * Shared by the Nexus Simulator's Outcome Multiverse and Market Intelligence's
 * Outcome Probability Landscape so neither falls back to the old risk-tolerance
 * sweep (whose rows came out dead-flat — Playoffs 100/100/100, Chaos 0/0/0 —
 * for any non-marginal team). Returns null when there is no mass to chart.
 */
export function buildOutcomeHeat(dist: SimulationResult["distribution"]): OutcomeHeat | null {
  const { wins, joint, tiers } = dist;
  const totalMass = wins.reduce((s, p) => s + p, 0);
  if (totalMass <= 0) return null;

  // Win-total columns: the (≤6) totals with the most marginal mass, ascending.
  // Capped at 6 (was 8) so the fixed-cell Heatmap2D stays readable at 3-up
  // desktop widths; 6 covers the central ~99% of a season's win distribution.
  const cols = wins
    .map((p, w) => ({ w, p }))
    .filter((x) => x.p > 0.001)
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((x) => x.w)
    .sort((a, b) => a - b);
  if (cols.length === 0) return null;

  // Rows: deepest tier first (Champion → Finalist → Playoffs → Missed).
  const rowOrder = tiers.map((_, i) => i).reverse();
  const data = rowOrder.map((ti) => cols.map((w) => joint[w]?.[ti] ?? 0));
  const yLabels = rowOrder.map((ti) => tiers[ti] ?? "");
  const xLabels = cols.map((w) => `${w} W`);
  const maxCell = Math.max(0.0001, ...data.flat());

  // Name the single most-likely (wins, outcome) pair so the chart has a plain-
  // English takeaway rather than only a grid of percentages.
  let bestW = cols[0]!;
  let bestTi = rowOrder[0]!;
  let bestP = -1;
  for (const w of cols) {
    for (const ti of rowOrder) {
      const p = joint[w]?.[ti] ?? 0;
      if (p > bestP) {
        bestP = p;
        bestW = w;
        bestTi = ti;
      }
    }
  }
  const caption =
    `P(regular-season wins × playoff outcome) over the simulated seasons — columns = wins, ` +
    `cell = true % of seasons. Most likely: ${bestW} wins → ${tiers[bestTi]} (${Math.round(bestP * 100)}%).`;

  return { data, xLabels, yLabels, maxCell, caption };
}
