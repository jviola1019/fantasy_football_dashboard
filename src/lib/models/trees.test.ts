import { describe, expect, it } from "vitest";
import {
  fitGradientBoosting,
  fitOutOfFold,
  fitRandomForest,
  growTree,
  predictBoostedProba,
  predictForestProba,
  predictTree,
  type TreeOptions
} from "./trees";

/**
 * The arithmetic under protocol 7's arms C and D.
 *
 * This is the part a library would hide. A boosted model that is subtly wrong
 * still returns plausible probabilities and still scores a Brier — it just
 * scores the wrong one, and the protocol would then attribute a real difference
 * to the model class when it belonged to a bug. So the leaf solver, the split
 * gain, the determinism and the fold isolation are each pinned against cases
 * worked out by hand.
 */
const OPTS: TreeOptions = { maxDepth: 3, minSamplesLeaf: 1, lambda: 1.0 };
const noRandom = () => 0.5;

describe("leaf values solve the regularised objective in closed form", () => {
  it("returns -G/(H+lambda) for a stump that cannot split", () => {
    // One feature, all identical values → no boundary exists → a single leaf.
    const X = [[1], [1], [1], [1]];
    const g = [0.2, 0.4, -0.1, 0.5];
    const h = [0.25, 0.25, 0.25, 0.25];
    const tree = growTree(X, g, h, [0, 1, 2, 3], OPTS, noRandom);
    expect(tree.leaf).toBe(true);
    const G = 0.2 + 0.4 - 0.1 + 0.5;
    const H = 1.0;
    expect(tree.value).toBeCloseTo(-G / (H + 1.0), 12);
  });

  it("shrinks harder as lambda grows — that is what the penalty is for", () => {
    const X = [[1], [1]];
    const g = [1, 1];
    const h = [0.25, 0.25];
    const small = growTree(X, g, h, [0, 1], { ...OPTS, lambda: 0.1 }, noRandom).value;
    const large = growTree(X, g, h, [0, 1], { ...OPTS, lambda: 100 }, noRandom).value;
    expect(Math.abs(large)).toBeLessThan(Math.abs(small));
  });
});

describe("splitting", () => {
  it("finds the boundary a separable problem puts there", () => {
    // Gradients flip sign at x = 5, so the only useful split is between them.
    const X = [[1], [2], [3], [8], [9], [10]];
    const g = [1, 1, 1, -1, -1, -1];
    const h = new Array(6).fill(0.25);
    const tree = growTree(X, g, h, [0, 1, 2, 3, 4, 5], { ...OPTS, maxDepth: 1 }, noRandom);
    expect(tree.leaf).toBe(false);
    expect(tree.feature).toBe(0);
    expect(tree.threshold!).toBeGreaterThan(3);
    expect(tree.threshold!).toBeLessThan(8);
  });

  it("refuses a split that would leave fewer than minSamplesLeaf on a side", () => {
    const X = [[1], [2], [3], [4]];
    const g = [1, -1, -1, -1];
    const h = new Array(4).fill(0.25);
    // A 1/3 split is the informative one and is forbidden at minSamplesLeaf 2.
    const tree = growTree(X, g, h, [0, 1, 2, 3], { ...OPTS, maxDepth: 1, minSamplesLeaf: 2 }, noRandom);
    if (!tree.leaf) {
      const left = X.filter((row) => row[0]! <= tree.threshold!).length;
      expect(left).toBeGreaterThanOrEqual(2);
      expect(X.length - left).toBeGreaterThanOrEqual(2);
    }
  });

  it("never produces a leaf built from zero rows", () => {
    // An empty child's leaf value is -0/lambda = 0 — a confident prediction
    // manufactured from no data, and it looks entirely normal downstream.
    const X = [[1], [1], [2], [2], [3], [3]];
    const g = [0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
    const h = new Array(6).fill(0.25);
    const tree = growTree(X, g, h, [0, 1, 2, 3, 4, 5], { ...OPTS, maxDepth: 4 }, noRandom);
    const counts: number[] = [];
    const walk = (node: typeof tree, rows: number[]) => {
      if (node.leaf) {
        counts.push(rows.length);
        return;
      }
      walk(node.left!, rows.filter((i) => X[i]![node.feature!]! <= node.threshold!));
      walk(node.right!, rows.filter((i) => X[i]![node.feature!]! > node.threshold!));
    };
    walk(tree, [0, 1, 2, 3, 4, 5]);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe("gradient boosting", () => {
  const separable = () => {
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (let i = 0; i < 100; i += 1) {
      X.push([i]);
      y.push(i < 50 ? 0 : 1);
    }
    return { X, y };
  };

  it("with zero rounds predicts exactly the base rate", () => {
    // The honest starting point: a boosted model that has learned nothing must
    // forecast climatology, not 0.5.
    const { X, y } = separable();
    const model = fitGradientBoosting(X, y, {
      ...OPTS,
      rounds: 0,
      learningRate: 0.1,
      subsample: 1,
      seed: 1
    });
    expect(predictBoostedProba(model, [0])).toBeCloseTo(0.5, 6);

    const skewed: (0 | 1)[] = y.map((_, i) => (i < 80 ? 0 : 1));
    const m2 = fitGradientBoosting(X, skewed, {
      ...OPTS,
      rounds: 0,
      learningRate: 0.1,
      subsample: 1,
      seed: 1
    });
    expect(predictBoostedProba(m2, [0])).toBeCloseTo(0.2, 6);
  });

  it("separates a separable problem", () => {
    const { X, y } = separable();
    const model = fitGradientBoosting(X, y, {
      ...OPTS,
      rounds: 60,
      learningRate: 0.2,
      subsample: 1,
      seed: 7
    });
    expect(predictBoostedProba(model, [5])).toBeLessThan(0.2);
    expect(predictBoostedProba(model, [95])).toBeGreaterThan(0.8);
  });

  it("learns an interaction an additive model cannot — the reason trees are in the protocol at all", () => {
    // y = 1 only where BOTH features are high. An additive model must give
    // intermediate probability at (high, low), because each feature pushes the
    // log-odds up independently. Only an interaction can put that corner near
    // zero, so these four probes distinguish the two model families.
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (let i = 0; i < 400; i += 1) {
      const a = i % 20;
      const b = Math.floor(i / 20) % 20;
      X.push([a, b]);
      y.push(a > 9 && b > 9 ? 1 : 0);
    }
    const model = fitGradientBoosting(X, y, {
      ...OPTS,
      maxDepth: 3,
      rounds: 120,
      learningRate: 0.2,
      subsample: 1,
      seed: 3
    });
    expect(predictBoostedProba(model, [15, 15])).toBeGreaterThan(0.7);
    expect(predictBoostedProba(model, [15, 3])).toBeLessThan(0.3);
    expect(predictBoostedProba(model, [3, 15])).toBeLessThan(0.3);
    expect(predictBoostedProba(model, [3, 3])).toBeLessThan(0.3);
  });

  it("cannot learn symmetric XOR, and that is a property of greedy trees, not a bug", () => {
    // Worth pinning, because the first version of the test above asserted the
    // opposite and it looked like an implementation failure.
    //
    // On perfectly balanced XOR every candidate split has gain exactly zero: each
    // half of either feature contains equal positives and negatives, so G_L and
    // G_R are symmetric and the objective does not improve. No greedy CART can
    // take a first step — XGBoost included. The model correctly declines to
    // invent structure and returns the base rate.
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (let i = 0; i < 200; i += 1) {
      const a = i % 2;
      const b = Math.floor(i / 2) % 2;
      X.push([a, b]);
      y.push((a ^ b) as 0 | 1);
    }
    const model = fitGradientBoosting(X, y, {
      ...OPTS,
      maxDepth: 2,
      rounds: 80,
      learningRate: 0.2,
      subsample: 1,
      seed: 3
    });
    expect(model.trees.every((t) => t.leaf)).toBe(true);
    expect(predictBoostedProba(model, [0, 0])).toBeCloseTo(0.5, 6);
  });

  it("is deterministic from its seed, including with subsampling", () => {
    // CLAUDE.md: simulation output must remain reproducible. Subsampling is the
    // only stochastic part, so this is where determinism would break.
    const { X, y } = separable();
    const cfg = { ...OPTS, rounds: 30, learningRate: 0.1, subsample: 0.7, seed: 20260825 };
    const a = fitGradientBoosting(X, y, cfg);
    const b = fitGradientBoosting(X, y, cfg);
    for (const probe of [[3], [47], [88]]) {
      expect(predictBoostedProba(a, probe)).toBe(predictBoostedProba(b, probe));
    }
  });

  it("a different seed gives a different fit, so the seed is doing something", () => {
    const { X, y } = separable();
    const base = { ...OPTS, rounds: 30, learningRate: 0.1, subsample: 0.5 };
    const a = fitGradientBoosting(X, y, { ...base, seed: 1 });
    const b = fitGradientBoosting(X, y, { ...base, seed: 2 });
    const pa = [10, 30, 60, 90].map((v) => predictBoostedProba(a, [v]));
    const pb = [10, 30, 60, 90].map((v) => predictBoostedProba(b, [v]));
    expect(pa).not.toEqual(pb);
  });

  it("returns probabilities, always", () => {
    const { X, y } = separable();
    const model = fitGradientBoosting(X, y, {
      ...OPTS,
      rounds: 200,
      learningRate: 0.5,
      subsample: 1,
      seed: 5
    });
    for (let v = -50; v <= 150; v += 10) {
      const p = predictBoostedProba(model, [v]);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});

describe("random forest", () => {
  it("recovers a threshold rule", () => {
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (let i = 0; i < 200; i += 1) {
      X.push([i, (i * 7) % 13]); // second feature is noise
      y.push(i < 100 ? 0 : 1);
    }
    const model = fitRandomForest(X, y, {
      ...OPTS,
      maxDepth: 4,
      trees: 40,
      maxFeatures: 1,
      seed: 11
    });
    expect(predictForestProba(model, [10, 3])).toBeLessThan(0.45);
    expect(predictForestProba(model, [190, 3])).toBeGreaterThan(0.55);
  });

  it("is deterministic from its seed", () => {
    const X = Array.from({ length: 80 }, (_, i) => [i]);
    const y = Array.from({ length: 80 }, (_, i) => (i < 40 ? 0 : 1) as 0 | 1);
    const cfg = { ...OPTS, trees: 15, seed: 20260825 };
    expect(predictForestProba(fitRandomForest(X, y, cfg), [60])).toBe(
      predictForestProba(fitRandomForest(X, y, cfg), [60])
    );
  });

  it("returns 0.5 for an empty ensemble rather than dividing by zero", () => {
    expect(predictForestProba({ trees: [] }, [1])).toBe(0.5);
  });
});

describe("fitOutOfFold isolates folds", () => {
  it("never lets a fold's own rows train the model that scores them", () => {
    const X = Array.from({ length: 60 }, (_, i) => [i]);
    const y = Array.from({ length: 60 }, (_, i) => (i % 2) as 0 | 1);
    const fold = Array.from({ length: 60 }, (_, i) => i % 3);

    const seen: number[][] = [];
    fitOutOfFold(X, y, fold, (trainX, _trainY, testX) => {
      seen.push(trainX.map((r) => r[0]!));
      return testX.map(() => 0.5);
    });

    // Each call's training rows must be disjoint from the fold being predicted.
    seen.forEach((trainRows, k) => {
      const heldOut = X.map((r, i) => ({ v: r[0]!, f: fold[i]! })).filter((r) => r.f === k);
      for (const row of heldOut) expect(trainRows).not.toContain(row.v);
    });
  });

  it("falls back to the TRAINING BASE RATE, not 0.5, when a fold cannot train", () => {
    // P2-2 caught a constant 0.5 being reported as a measured calibration. The
    // max-entropy answer is a different forecast from the one the model would
    // make, and it scores better than it deserves to.
    const X = Array.from({ length: 10 }, (_, i) => [i]);
    const y = Array.from({ length: 10 }, (_, i) => (i < 8 ? 1 : 0) as 0 | 1);
    const fold = Array.from({ length: 10 }, (_, i) => (i < 5 ? 0 : 1));
    const out = fitOutOfFold(X, y, fold, (_a, _b, testX) => testX.map(() => 0.99));
    // Both folds have <20 training rows, so every row gets its fold's complement rate.
    expect(out.every((p) => p !== 0.99)).toBe(true);
    expect(out[0]).toBeCloseTo(3 / 5, 6); // fold 0 trained on rows 5..9 → 3 positives
  });

  it("produces one prediction per row, in row order", () => {
    const X = Array.from({ length: 40 }, (_, i) => [i]);
    const y = Array.from({ length: 40 }, (_, i) => (i % 2) as 0 | 1);
    const fold = Array.from({ length: 40 }, (_, i) => (i < 20 ? 0 : 1));
    const out = fitOutOfFold(X, y, fold, (_a, _b, testX) => testX.map((r) => (r[0]! < 20 ? 0.1 : 0.9)));
    expect(out).toHaveLength(40);
    expect(out[0]).toBeCloseTo(0.1, 9);
    expect(out[39]).toBeCloseTo(0.9, 9);
  });
});

describe("predictTree", () => {
  it("sends values equal to the threshold left, consistently with fitting", () => {
    // The split rule is `<= threshold` in both places. If they disagreed, rows
    // on the boundary would train one way and predict the other.
    const tree = {
      leaf: false,
      value: 0,
      feature: 0,
      threshold: 5,
      left: { leaf: true, value: -1 },
      right: { leaf: true, value: 1 }
    };
    expect(predictTree(tree, [5])).toBe(-1);
    expect(predictTree(tree, [5.0001])).toBe(1);
  });
});
