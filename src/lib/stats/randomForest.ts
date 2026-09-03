/**
 * A REGRESSION random forest with out-of-bag scoring and permutation importance.
 *
 * WHY THIS EXISTS, AND WHY IT IS DELIBERATELY THIN.
 *
 * Every model in this product is linear — a logistic on one variable, a weighted
 * z-score on two. That is a defensible floor and it is also an untested
 * assumption: a variable can carry real signal a linear fit cannot see, and the
 * honest way to find out is to let a model that can represent interactions and
 * non-monotone effects try, then check whether it does better OUT OF SAMPLE.
 *
 * IT DOES NOT IMPLEMENT A TREE. `src/lib/models/trees.ts` already has an exact
 * greedy grower, written for protocol 7 and tested there, and its own header
 * says why sharing it matters: "one splitting implementation to test, not two
 * that can drift apart". The first version of this file grew its own CART and
 * was caught by `npm run audit:reachability` listing `models/trees.ts` — the
 * same duplication that gave `fingerprintRows` two answers.
 *
 * SQUARED-ERROR REGRESSION IS THE SAME MACHINERY. `growTree` optimises a
 * gradient/hessian objective. With `g = −y`, `h = 1` and `lambda = 0`:
 *
 *   leaf value  = −G/(H+λ) = Σy/n                    ... the mean, as required
 *   split gain  = ½(G_L²/n_L + G_R²/n_R − G²/n)      ... variance reduction
 *
 * — identical to the textbook regression criterion up to the constant ½, which
 * cannot change an argmax. So this module supplies the bootstrap, the
 * out-of-bag bookkeeping and the importance measure, and nothing else.
 *
 * WHAT IT IS FOR. Variable SCREENING, not shipping. Nothing in the product calls
 * it; `scripts/validate-variables.ts` does. A forest's predictions are not
 * something this product would show a user without a calibration study of their
 * own, and the guardrails are explicit that an uncalibrated model must not be
 * presented as production-safe.
 *
 * TWO THINGS A NAIVE IMPLEMENTATION GETS WRONG.
 *
 * 1. **Out-of-bag scoring, not training-set scoring.** Each tree sees a
 *    bootstrap sample; each row is scored only by the trees that did NOT see
 *    it. Training-set R² on a forest is near 1 by construction.
 * 2. **Permutation importance, measured out of bag.** Split-count and impurity
 *    gain are biased toward high-cardinality and high-variance features — a
 *    known and severe artefact. Permuting a column and re-scoring OOB measures
 *    what the model actually loses without it.
 *
 * Bootstrap draws, feature subsets and permutations all come from `mulberry32`,
 * so a reported importance reproduces exactly from its seed.
 */
import { mulberry32 } from "../rng";
import { growTree, predictTree, type TreeNode } from "../models/trees";

export interface ForestOptions {
  /** Number of trees. More is monotonically better and slower; 200 is ample here. */
  nTrees?: number;
  /** Features considered per split. Default `ceil(p/3)`, the regression convention. */
  mtry?: number;
  /** Minimum rows in a leaf. Guards against fitting single observations. */
  minSamplesLeaf?: number;
  /** Maximum depth. Unbounded trees are fine in a forest but slow. */
  maxDepth?: number;
  seed?: number;
}

export interface ForestResult {
  /** Out-of-bag prediction per row. `null` where no tree left the row out. */
  oobPredictions: (number | null)[];
  /** OOB R², i.e. 1 − SSE/SST over the rows that have an OOB prediction. */
  oobR2: number;
  /** Rows that received an OOB prediction. */
  oobCount: number;
  /** Permutation importance per feature: the DROP in OOB R² when it is shuffled. */
  importance: number[];
  nTrees: number;
  mtry: number;
}

/**
 * Fit a forest and report only out-of-bag quantities.
 *
 * There is intentionally no `predict` on the result. Everything this is used for
 * is measured out of bag, and exposing an in-sample predictor would invite
 * exactly the training-set R² this is built to avoid reporting.
 */
export function randomForestRegress(
  X: readonly (readonly number[])[],
  y: readonly number[],
  options: ForestOptions = {}
): ForestResult {
  const n = X.length;
  if (n === 0 || y.length !== n) {
    throw new Error(`randomForestRegress: X has ${n} rows and y has ${y.length}`);
  }
  const p = X[0]!.length;
  const nTrees = options.nTrees ?? 200;
  const mtry = options.mtry ?? Math.max(1, Math.ceil(p / 3));
  const treeOpts = {
    maxDepth: options.maxDepth ?? 12,
    minSamplesLeaf: options.minSamplesLeaf ?? 5,
    // No shrinkage: with lambda 0 the leaf value is exactly the mean of the
    // rows in it, which is what a regression forest must predict.
    lambda: 0,
    maxFeatures: mtry
  };
  const rand = mulberry32(options.seed ?? 20260902);

  // Squared-error regression in the gradient/hessian form the shared grower
  // expects — see the module header for the algebra.
  const g = y.map((v) => -v);
  const h = new Array<number>(n).fill(1);

  const trees: TreeNode[] = [];
  const oobRows: number[][] = [];
  for (let t = 0; t < nTrees; t += 1) {
    const bag: number[] = [];
    const inBag = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const j = Math.floor(rand() * n);
      bag.push(j);
      inBag[j] = 1;
    }
    const oob: number[] = [];
    for (let i = 0; i < n; i += 1) if (!inBag[i]) oob.push(i);
    trees.push(growTree(X, g, h, bag, treeOpts, rand));
    oobRows.push(oob);
  }

  /** Average the OOB trees' predictions for each row, over a (possibly permuted) X. */
  const scoreOob = (data: readonly (readonly number[])[]): (number | null)[] => {
    const sums = new Float64Array(n);
    const counts = new Int32Array(n);
    for (let t = 0; t < trees.length; t += 1) {
      for (const i of oobRows[t]!) {
        sums[i] += predictTree(trees[t]!, data[i]!);
        counts[i] += 1;
      }
    }
    return Array.from({ length: n }, (_, i) => (counts[i]! > 0 ? sums[i]! / counts[i]! : null));
  };

  const r2 = (preds: (number | null)[]): { r2: number; count: number } => {
    const idx: number[] = [];
    for (let i = 0; i < n; i += 1) if (preds[i] !== null) idx.push(i);
    if (idx.length < 2) return { r2: Number.NaN, count: idx.length };
    let ybar = 0;
    for (const i of idx) ybar += y[i]!;
    ybar /= idx.length;
    let sse = 0;
    let sst = 0;
    for (const i of idx) {
      const d = y[i]! - preds[i]!;
      sse += d * d;
      const c = y[i]! - ybar;
      sst += c * c;
    }
    // SST of zero means y never varies. R² is undefined there, not 1 —
    // reporting 1 would claim a perfect model of a constant column.
    return { r2: sst > 0 ? 1 - sse / sst : Number.NaN, count: idx.length };
  };

  const base = scoreOob(X);
  const baseR2 = r2(base);

  // Permutation importance, out of bag. Each feature is shuffled independently
  // with the same generator, so feature-to-feature comparison is fair and the
  // whole result reproduces from the seed.
  const importance: number[] = [];
  for (let f = 0; f < p; f += 1) {
    const permuted = X.map((row) => [...row]);
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let i = 0; i < n; i += 1) permuted[i]![f] = X[order[i]!]![f]!;
    importance.push(baseR2.r2 - r2(scoreOob(permuted)).r2);
  }

  return {
    oobPredictions: base,
    oobR2: baseR2.r2,
    oobCount: baseR2.count,
    importance,
    nTrees,
    mtry
  };
}
