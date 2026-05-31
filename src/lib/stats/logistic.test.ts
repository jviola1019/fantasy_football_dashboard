import { describe, expect, it } from "vitest";
import { sigmoid, standardize, fitLogistic, predictLogisticProba, fitLogisticCV } from "./logistic";
import { brierScore } from "./distribution";

// Deterministic PRNG (mulberry32) so the synthetic-data tests are reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("sigmoid", () => {
  it("maps 0 to 0.5", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 12);
  });

  it("is numerically stable for large magnitudes (no overflow to NaN)", () => {
    expect(sigmoid(1000)).toBeCloseTo(1, 12);
    expect(sigmoid(-1000)).toBeCloseTo(0, 12);
    expect(Number.isFinite(sigmoid(1000))).toBe(true);
    expect(Number.isFinite(sigmoid(-1000))).toBe(true);
  });

  it("matches the closed form at a known point", () => {
    // 1/(1+e^-2) = 0.8807970779778823
    expect(sigmoid(2)).toBeCloseTo(0.8807970779778823, 12);
  });
});

describe("standardize", () => {
  it("z-scores each column to mean 0, population sd 1", () => {
    const X = [[1, 10], [2, 20], [3, 30]];
    const { Z, mean, std } = standardize(X);
    expect(mean).toEqual([2, 20]);
    // population sd of [1,2,3] = sqrt(2/3) ≈ 0.8164965809
    expect(std[0]).toBeCloseTo(0.816496580927726, 10);
    expect(std[1]).toBeCloseTo(8.16496580927726, 10);
    // standardized column 0 = [-1.2247, 0, 1.2247]
    expect(Z[0]![0]).toBeCloseTo(-1.224744871391589, 10);
    expect(Z[1]![0]).toBeCloseTo(0, 12);
    expect(Z[2]![0]).toBeCloseTo(1.224744871391589, 10);
  });

  it("treats a zero-variance column as sd=1 (no divide-by-zero)", () => {
    const X = [[5], [5], [5]];
    const { Z, std } = standardize(X);
    expect(std[0]).toBe(1);
    expect(Z.map((r) => r[0])).toEqual([0, 0, 0]);
  });
});

describe("fitLogistic", () => {
  it("recovers the true coefficients of a known data-generating model", () => {
    // y ~ Bernoulli(sigmoid(-0.5 + 1.5 x)), x ~ Uniform(-3, 3), N large.
    const r = rng(12345);
    const X: number[][] = [];
    const y: number[] = [];
    const b0 = -0.5;
    const b1 = 1.5;
    for (let i = 0; i < 8000; i++) {
      const x = -3 + 6 * r();
      const p = sigmoid(b0 + b1 * x);
      X.push([x]);
      y.push(r() < p ? 1 : 0);
    }
    const model = fitLogistic(X, y, { l2: 1e-6 });
    expect(model.intercept).toBeCloseTo(b0, 1); // within ~0.05
    expect(model.coefficients[0]).toBeCloseTo(b1, 1);
  });

  it("predictLogisticProba equals sigmoid(intercept + w·x) and stays in [0,1]", () => {
    const model = { intercept: 0.3, coefficients: [1.2, -0.8] };
    const x = [0.5, 2];
    const expected = sigmoid(0.3 + 1.2 * 0.5 + -0.8 * 2);
    expect(predictLogisticProba(model, x)).toBeCloseTo(expected, 12);
    expect(predictLogisticProba(model, x)).toBeGreaterThanOrEqual(0);
    expect(predictLogisticProba(model, x)).toBeLessThanOrEqual(1);
  });

  it("does not diverge to NaN on perfectly separable data (ridge regularizes)", () => {
    // x<0 → 0, x>0 → 1 is perfectly separable; unregularized MLE diverges.
    const X = [[-2], [-1], [-0.5], [0.5], [1], [2]];
    const y = [0, 0, 0, 1, 1, 1];
    const model = fitLogistic(X, y, { l2: 1.0 });
    expect(Number.isFinite(model.intercept)).toBe(true);
    expect(Number.isFinite(model.coefficients[0]!)).toBe(true);
    // Positive slope (higher x → higher P), finite due to ridge.
    expect(model.coefficients[0]!).toBeGreaterThan(0);
    expect(predictLogisticProba(model, [2])).toBeGreaterThan(predictLogisticProba(model, [-2]));
  });

  it("stronger ridge shrinks the slope toward zero", () => {
    const r = rng(99);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = -3 + 6 * r();
      X.push([x]);
      y.push(r() < sigmoid(2 * x) ? 1 : 0);
    }
    const light = fitLogistic(X, y, { l2: 1e-6 });
    const heavy = fitLogistic(X, y, { l2: 50 });
    expect(Math.abs(heavy.coefficients[0]!)).toBeLessThan(Math.abs(light.coefficients[0]!));
  });

  it("is deterministic for the same inputs", () => {
    const X = [[-2], [-1], [1], [2]];
    const y = [0, 0, 1, 1];
    const a = fitLogistic(X, y, { l2: 0.5 });
    const b = fitLogistic(X, y, { l2: 0.5 });
    expect(a).toEqual(b);
  });

  it("produces well-calibrated probabilities (calibration-in-the-large + low Brier)", () => {
    const r = rng(7);
    const train: { X: number[][]; y: number[] } = { X: [], y: [] };
    for (let i = 0; i < 6000; i++) {
      const x = -3 + 6 * r();
      train.X.push([x]);
      train.y.push(r() < sigmoid(-0.3 + 1.1 * x) ? 1 : 0);
    }
    const model = fitLogistic(train.X, train.y, { l2: 1e-6 });
    // Held-out test set from the same DGP.
    const probs: number[] = [];
    const outcomes: (0 | 1)[] = [];
    for (let i = 0; i < 6000; i++) {
      const x = -3 + 6 * r();
      const trueP = sigmoid(-0.3 + 1.1 * x);
      const o: 0 | 1 = r() < trueP ? 1 : 0;
      probs.push(predictLogisticProba(model, [x]));
      outcomes.push(o);
    }
    // Calibration-in-the-large: mean predicted ≈ observed base rate.
    const meanPred = probs.reduce((s, p) => s + p, 0) / probs.length;
    const baseRate = outcomes.reduce<number>((s, o) => s + o, 0) / outcomes.length;
    expect(meanPred).toBeCloseTo(baseRate, 1);
    // Brier of the fitted model is close to the irreducible Brier of the true model.
    const fittedBrier = brierScore(probs.map((p, i) => ({ prob: p, outcome: outcomes[i]! }))).score;
    expect(fittedBrier).toBeLessThan(0.25); // beats coin-flip
  });
});

describe("fitLogisticCV", () => {
  it("returns one out-of-fold probability per row, all in [0,1]", () => {
    const r = rng(3);
    const X: number[][] = [];
    const y: number[] = [];
    const fold: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const x = -3 + 6 * r();
      X.push([x]);
      y.push(r() < sigmoid(0.5 + x) ? 1 : 0);
      fold.push(i % 5); // 5 folds
    }
    const oof = fitLogisticCV(X, y, fold, { l2: 1e-3 });
    expect(oof.length).toBe(y.length);
    for (const p of oof) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("emits the max-entropy prior 0.5 for a degenerate single fold (no in-fold leakage)", () => {
    // All rows in one fold → no out-of-fold training data exists. Must NOT score
    // rows with their own (in-fold) base rate (0.25 here), which would leak the
    // held-out outcomes; the only leakage-free answer is the prior 0.5.
    const X = [[-2], [2], [-1], [1]];
    const y = [0, 0, 0, 1]; // base rate 0.25 ≠ 0.5
    const fold = [0, 0, 0, 0];
    const oof = fitLogisticCV(X, y, fold, { l2: 0.5 });
    expect(oof).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("predicts each fold from a model trained only on the OTHER folds (no leakage)", () => {
    // Two folds with OPPOSITE label-vs-x relationships. If fold A's prediction
    // leaked its own labels it would fit them; trained only on fold B it must
    // follow B's (opposite) relationship instead.
    const X: number[][] = [];
    const y: number[] = [];
    const fold: number[] = [];
    // Fold 0: higher x → label 1.
    for (let i = 0; i < 40; i++) {
      const x = i < 20 ? -2 : 2;
      X.push([x]); y.push(x > 0 ? 1 : 0); fold.push(0);
    }
    // Fold 1: higher x → label 0 (opposite).
    for (let i = 0; i < 40; i++) {
      const x = i < 20 ? -2 : 2;
      X.push([x]); y.push(x > 0 ? 0 : 1); fold.push(1);
    }
    const oof = fitLogisticCV(X, y, fold, { l2: 0.5 });
    // A fold-0 high-x point, predicted by the fold-1 model (opposite slope),
    // should get probability < 0.5 — the opposite of its own label (1).
    const idxFold0HighX = X.findIndex((row, i) => fold[i] === 0 && row[0] === 2);
    expect(oof[idxFold0HighX]!).toBeLessThan(0.5);
  });
});
