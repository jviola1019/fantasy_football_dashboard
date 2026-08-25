/**
 * Decision trees, a random forest and gradient boosting — implemented here
 * rather than pulled in.
 *
 * WHY NOT A LIBRARY. Every displayed number in this product has to be
 * reproducible from a seed (CLAUDE.md: never `Math.random` for displayed data,
 * simulation output must remain reproducible). Adding xgboost or lightgbm means
 * a native binary whose RNG and thread scheduling this repo does not control,
 * for models that are a few hundred lines of well-understood arithmetic. The
 * arithmetic is also the part worth testing, and a dependency cannot be
 * unit-tested for correctness the way this can.
 *
 * WHAT THIS IS. Newton boosting with logistic loss — the same formulation
 * XGBoost uses: at each round, fit a regression tree to the gradient/hessian
 * ratio of the current margins, with leaf values solved in closed form as
 * −G/(H+λ). Exact greedy splitting over sorted feature values.
 *
 * Frozen protocol 7 fixes every hyperparameter a priori. Nothing here is tuned.
 */
import { mulberry32 } from "@/lib/rng";

export interface TreeOptions {
  maxDepth: number;
  minSamplesLeaf: number;
  /** L2 penalty on leaf weights. Boosting only; ignored by the forest. */
  lambda: number;
  /** Features considered per split; undefined means all of them. */
  maxFeatures?: number;
}

interface Split {
  feature: number;
  threshold: number;
  gain: number;
}

/** A fitted binary tree. Leaves carry a real-valued output. */
export interface TreeNode {
  leaf: boolean;
  value: number;
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

/**
 * Best split by the XGBoost gain criterion:
 *
 *   gain = ½ [ G_L²/(H_L+λ) + G_R²/(H_R+λ) − G²/(H+λ) ]
 *
 * Returns null when no split improves on the parent, which is what makes a leaf.
 */
function bestSplit(
  X: readonly (readonly number[])[],
  g: readonly number[],
  h: readonly number[],
  idx: readonly number[],
  features: readonly number[],
  opts: TreeOptions
): Split | null {
  let G = 0;
  let H = 0;
  for (const i of idx) {
    G += g[i]!;
    H += h[i]!;
  }
  const parent = (G * G) / (H + opts.lambda);

  let best: Split | null = null;
  for (const f of features) {
    // Sort this node's rows by the feature, then sweep every threshold once.
    const order = [...idx].sort((a, b) => X[a]![f]! - X[b]![f]!);
    let GL = 0;
    let HL = 0;
    for (let k = 0; k < order.length - 1; k += 1) {
      const i = order[k]!;
      GL += g[i]!;
      HL += h[i]!;
      const vi = X[i]![f]!;
      const vj = X[order[k + 1]!]![f]!;
      // Only a real boundary is a candidate: identical values cannot be split.
      if (vi === vj) continue;
      const nLeft = k + 1;
      const nRight = order.length - nLeft;
      if (nLeft < opts.minSamplesLeaf || nRight < opts.minSamplesLeaf) continue;
      const GR = G - GL;
      const HR = H - HL;
      const gain =
        0.5 * ((GL * GL) / (HL + opts.lambda) + (GR * GR) / (HR + opts.lambda) - parent);
      if (gain > 0 && (best === null || gain > best.gain)) {
        best = { feature: f, threshold: (vi + vj) / 2, gain };
      }
    }
  }
  return best;
}

function leafValue(g: readonly number[], h: readonly number[], idx: readonly number[], lambda: number): number {
  let G = 0;
  let H = 0;
  for (const i of idx) {
    G += g[i]!;
    H += h[i]!;
  }
  return -G / (H + lambda);
}

/**
 * Grow one regression tree against gradients and hessians.
 *
 * `rand` selects the per-split feature subset for the forest; boosting passes a
 * generator too so a run is reproducible from its seed either way.
 */
export function growTree(
  X: readonly (readonly number[])[],
  g: readonly number[],
  h: readonly number[],
  idx: readonly number[],
  opts: TreeOptions,
  rand: () => number,
  depth = 0
): TreeNode {
  const nFeatures = X[0]?.length ?? 0;
  if (depth >= opts.maxDepth || idx.length < 2 * opts.minSamplesLeaf) {
    return { leaf: true, value: leafValue(g, h, idx, opts.lambda) };
  }

  let features = Array.from({ length: nFeatures }, (_, i) => i);
  if (opts.maxFeatures != null && opts.maxFeatures < nFeatures) {
    // Fisher–Yates on a copy, driven by the seeded generator.
    for (let i = features.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [features[i], features[j]] = [features[j]!, features[i]!];
    }
    features = features.slice(0, opts.maxFeatures);
  }

  const split = bestSplit(X, g, h, idx, features, opts);
  if (!split) return { leaf: true, value: leafValue(g, h, idx, opts.lambda) };

  const left: number[] = [];
  const right: number[] = [];
  for (const i of idx) {
    if (X[i]![split.feature]! <= split.threshold) left.push(i);
    else right.push(i);
  }
  // bestSplit already enforced minSamplesLeaf, but a degenerate partition here
  // would silently produce an empty child whose leaf value is -0/λ = 0 — a
  // confident prediction manufactured from no data.
  if (left.length === 0 || right.length === 0) {
    return { leaf: true, value: leafValue(g, h, idx, opts.lambda) };
  }

  return {
    leaf: false,
    value: 0,
    feature: split.feature,
    threshold: split.threshold,
    left: growTree(X, g, h, left, opts, rand, depth + 1),
    right: growTree(X, g, h, right, opts, rand, depth + 1)
  };
}

export function predictTree(node: TreeNode, x: readonly number[]): number {
  let cur = node;
  while (!cur.leaf) {
    cur = x[cur.feature!]! <= cur.threshold! ? cur.left! : cur.right!;
  }
  return cur.value;
}

const clampProb = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/* ------------------------------------------------------------------ */
/* Gradient boosting                                                   */
/* ------------------------------------------------------------------ */

export interface BoostOptions extends TreeOptions {
  rounds: number;
  learningRate: number;
  /** Fraction of rows sampled per round. 1 disables subsampling. */
  subsample: number;
  seed: number;
}

export interface BoostedModel {
  base: number;
  trees: TreeNode[];
  learningRate: number;
}

/**
 * Newton boosting with logistic loss.
 *
 * At each round the gradient is (p − y) and the hessian p(1 − p); the tree is
 * fitted to those and its leaves solved as −G/(H+λ). The base margin is the
 * log-odds of the training base rate, so round zero already predicts
 * climatology — a boosted model with zero rounds is exactly the base-rate
 * forecast, which is the honest starting point.
 */
export function fitGradientBoosting(
  X: readonly (readonly number[])[],
  y: readonly (0 | 1)[],
  opts: BoostOptions
): BoostedModel {
  const n = X.length;
  const rand = mulberry32(opts.seed);
  const positives = y.reduce<number>((a, b) => a + b, 0);
  const rate = clampProb(positives / Math.max(1, n));
  const base = Math.log(rate / (1 - rate));

  const margins = new Array<number>(n).fill(base);
  const trees: TreeNode[] = [];

  for (let round = 0; round < opts.rounds; round += 1) {
    const g = new Array<number>(n);
    const h = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const p = clampProb(sigmoid(margins[i]!));
      g[i] = p - y[i]!;
      h[i] = p * (1 - p);
    }

    let idx = Array.from({ length: n }, (_, i) => i);
    if (opts.subsample < 1) {
      idx = idx.filter(() => rand() < opts.subsample);
      if (idx.length < 2 * opts.minSamplesLeaf) continue;
    }

    const tree = growTree(X, g, h, idx, opts, rand);
    trees.push(tree);
    // Update EVERY row, not just the sampled ones — subsampling chooses what the
    // tree is fitted on, not who it applies to.
    for (let i = 0; i < n; i += 1) {
      margins[i] = margins[i]! + opts.learningRate * predictTree(tree, X[i]!);
    }
  }

  return { base, trees, learningRate: opts.learningRate };
}

export function predictBoostedProba(model: BoostedModel, x: readonly number[]): number {
  let margin = model.base;
  for (const t of model.trees) margin += model.learningRate * predictTree(t, x);
  return clampProb(sigmoid(margin));
}

/* ------------------------------------------------------------------ */
/* Random forest                                                       */
/* ------------------------------------------------------------------ */

export interface ForestOptions extends TreeOptions {
  trees: number;
  seed: number;
}

export interface ForestModel {
  trees: TreeNode[];
}

/**
 * Probability forest: each tree is fitted to the same
 * gradient/hessian machinery with a single Newton step from a 0.5 prior, on a
 * bootstrap resample with a random feature subset per split. Averaging the
 * per-tree probabilities gives the ensemble estimate.
 *
 * Sharing the tree grower with boosting is deliberate: one splitting
 * implementation to test, not two that can drift apart.
 */
export function fitRandomForest(
  X: readonly (readonly number[])[],
  y: readonly (0 | 1)[],
  opts: ForestOptions
): ForestModel {
  const n = X.length;
  const rand = mulberry32(opts.seed);
  const trees: TreeNode[] = [];

  for (let t = 0; t < opts.trees; t += 1) {
    const idx: number[] = [];
    for (let i = 0; i < n; i += 1) idx.push(Math.floor(rand() * n));

    // One Newton step from p = 0.5: g = 0.5 - y, h = 0.25. The leaf value is
    // then a shrunk log-odds of the leaf's class balance.
    const g = y.map((yi) => 0.5 - yi);
    const h = new Array<number>(n).fill(0.25);
    trees.push(growTree(X, g, h, idx, opts, rand));
  }
  return { trees };
}

export function predictForestProba(model: ForestModel, x: readonly number[]): number {
  if (model.trees.length === 0) return 0.5;
  let sum = 0;
  for (const t of model.trees) sum += sigmoid(predictTree(t, x));
  return clampProb(sum / model.trees.length);
}

/* ------------------------------------------------------------------ */
/* Out-of-fold driver, shared by every arm                             */
/* ------------------------------------------------------------------ */

/**
 * Leave-one-fold-out predictions, matching `fitLogisticCV`'s contract exactly so
 * the arms are comparable. Rows in a fold are predicted by a model that never
 * saw that fold.
 *
 * A fold that leaves too little training data yields the TRAINING BASE RATE for
 * its rows, not 0.5 — the max-entropy answer would be a different (and better
 * scoring) forecast than the model would actually make, and P2-2 already caught
 * a constant 0.5 being reported as a measured calibration.
 */
export function fitOutOfFold(
  X: readonly (readonly number[])[],
  y: readonly (0 | 1)[],
  fold: readonly number[],
  fitPredict: (
    trainX: readonly (readonly number[])[],
    trainY: readonly (0 | 1)[],
    testX: readonly (readonly number[])[]
  ) => number[]
): number[] {
  const out = new Array<number>(X.length).fill(0.5);
  const folds = [...new Set(fold)];
  for (const f of folds) {
    const trainIdx: number[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < X.length; i += 1) (fold[i] === f ? testIdx : trainIdx).push(i);
    if (trainIdx.length < 20 || testIdx.length === 0) {
      const rate = trainIdx.length > 0 ? trainIdx.reduce((a, i) => a + y[i]!, 0) / trainIdx.length : 0.5;
      for (const i of testIdx) out[i] = clampProb(rate);
      continue;
    }
    const preds = fitPredict(
      trainIdx.map((i) => X[i]!),
      trainIdx.map((i) => y[i]!),
      testIdx.map((i) => X[i]!)
    );
    testIdx.forEach((i, k) => {
      out[i] = clampProb(preds[k] ?? 0.5);
    });
  }
  return out;
}
