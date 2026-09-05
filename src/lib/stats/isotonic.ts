/**
 * Isotonic regression by pool-adjacent-violators (PAVA).
 *
 * WHY THIS EXISTS.
 *
 * `weeklyProbability.ts` maps a projection to a probability through a LOGISTIC:
 * it assumes the log-odds of clearing the line are LINEAR in projected points.
 * That is an assumption, and it has never been tested against the alternative
 * that matters — a mapping that is still monotone (more projected points can
 * never mean a lower probability) but free to bend wherever the data says.
 *
 * Isotonic regression is exactly that alternative, and it is the right one to
 * try first: it relaxes the shape without relaxing the thing the product
 * actually needs, which is that the curve never goes backwards. A spline or a
 * polynomial would fit better in-sample and could easily produce "a higher
 * projection lowers your chance of clearing", which is unshippable regardless of
 * its Brier score.
 *
 * ── A BUG THIS FILE SHIPPED, AND THE TEST GAP THAT HID IT ──────────────────
 *
 * The first version stored each pooled block under its LARGEST x and then
 * interpolated between those anchors. For any x strictly inside a pooled block
 * that returns a value dragged toward the PREVIOUS block — always too low, never
 * too high. `fitIsotonic([1,2,3,4],[0,1,0,1])` pools points 2 and 3 to 0.5, and
 * `predictIsotonic(fit, 2)` returned **0.25**. Measured on the real projection
 * data it biased every prediction down by 2–5pp and roughly doubled the reported
 * ECE of the isotonic family in `docs/model-gauntlet.md`.
 *
 * Every fixture in the original test file was already monotone, so **no block
 * ever pooled** — the tests exercised the interpolation path and never the case
 * the algorithm exists for. A second defect hid in the same gap: tied x were
 * never pooled at all, leaving `fit.x` multi-valued and prediction picking a
 * branch by binary-search accident.
 *
 * ── THE REPRESENTATION, which is where the fix lives ───────────────────────
 *
 * A block now carries BOTH its edges. Isotonic regression is a step function:
 * constant across the whole span a block covers, moving only between blocks.
 * Storing one anchor per block cannot express that, and any single-anchor choice
 * (left, right, or midpoint) is wrong somewhere. Interpolation happens only
 * across the GAP between one block's right edge and the next block's left edge,
 * where there is genuinely no observation to be constant over.
 *
 * Ties are pooled into one weighted point BEFORE the walk, so `x` is strictly
 * increasing and the fit is single-valued everywhere.
 *
 * THE HONEST CAVEAT, stated here so it travels with the code: isotonic
 * regression is unbiased in-sample almost by construction — it can fit any
 * monotone pattern including noise — so an in-sample comparison against a
 * logistic is meaningless. Only out-of-fold numbers say anything, which is how
 * `scripts/model-gauntlet.ts` uses it.
 */

/** One pooled block: a value held constant across `[xLeft, xRight]`. */
export interface IsotonicBlock {
  xLeft: number;
  xRight: number;
  y: number;
}

export interface IsotonicFit {
  blocks: IsotonicBlock[];
}

/**
 * Fit a non-decreasing step function of `y` on `x`.
 *
 * `weights` lets an observation count for more than one row. Tied x are pooled
 * before the walk regardless, which is what keeps the result single-valued.
 */
export function fitIsotonic(
  x: readonly number[],
  y: readonly number[],
  weights?: readonly number[]
): IsotonicFit {
  if (x.length !== y.length) {
    throw new Error(`fitIsotonic: x has ${x.length} points and y has ${y.length}`);
  }
  if (x.length === 0) return { blocks: [] };

  // 1. Sort, and pool TIED x into a single weighted point. Without this a
  //    repeated x can end up in two blocks with different values, and the "fit"
  //    is multi-valued exactly where the data is densest.
  const order = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]!);
  const px: number[] = [];
  const psum: number[] = [];
  const pwt: number[] = [];
  for (const i of order) {
    const w = weights ? weights[i]! : 1;
    const last = px.length - 1;
    if (last >= 0 && px[last] === x[i]!) {
      psum[last] = psum[last]! + y[i]! * w;
      pwt[last] = pwt[last]! + w;
    } else {
      px.push(x[i]!);
      psum.push(y[i]! * w);
      pwt.push(w);
    }
  }

  // 2. PAVA over the distinct x, carrying both edges of every block.
  const left: number[] = [];
  const right: number[] = [];
  const sum: number[] = [];
  const wt: number[] = [];
  for (let i = 0; i < px.length; i += 1) {
    left.push(px[i]!);
    right.push(px[i]!);
    sum.push(psum[i]!);
    wt.push(pwt[i]!);
    while (left.length > 1) {
      const n = left.length;
      if (sum[n - 2]! / wt[n - 2]! <= sum[n - 1]! / wt[n - 1]!) break;
      sum[n - 2] = sum[n - 2]! + sum[n - 1]!;
      wt[n - 2] = wt[n - 2]! + wt[n - 1]!;
      // The merged block spans from the earlier block's LEFT edge to the later
      // block's RIGHT edge. Keeping both is the whole fix.
      right[n - 2] = right[n - 1]!;
      left.pop();
      right.pop();
      sum.pop();
      wt.pop();
    }
  }

  return {
    blocks: left.map((l, i) => ({ xLeft: l, xRight: right[i]!, y: sum[i]! / wt[i]! }))
  };
}

/**
 * Evaluate the fit at `value`.
 *
 * Constant inside a block, linear across the gap between blocks, clamped
 * outside the observed range. Clamping rather than extrapolating is deliberate:
 * beyond the data there is no evidence about the slope, and extrapolating a
 * fitted line there is how a calibration curve produces probabilities above 1.
 */
export function predictIsotonic(fit: IsotonicFit, value: number): number {
  const { blocks } = fit;
  if (blocks.length === 0) return 0.5;
  if (value <= blocks[0]!.xRight) return blocks[0]!.y;
  const last = blocks[blocks.length - 1]!;
  if (value >= last.xLeft) return last.y;

  // Find the last block whose right edge is at or before `value`.
  let lo = 0;
  let hi = blocks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.xRight <= value) lo = mid;
    else hi = mid;
  }
  const a = blocks[lo]!;
  const b = blocks[hi]!;
  // Inside a block: constant. This is the case the previous implementation got
  // wrong, and it is the common one — pooled blocks are where the data is.
  if (value <= a.xRight) return a.y;
  if (value >= b.xLeft) return b.y;
  const span = b.xLeft - a.xRight;
  if (span <= 0) return b.y;
  return a.y + ((value - a.xRight) / span) * (b.y - a.y);
}
