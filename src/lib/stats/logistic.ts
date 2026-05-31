/**
 * Logistic regression for binary-outcome calibration.
 *
 * Fit with Newton–Raphson / IRLS (iteratively reweighted least squares) plus an
 * optional L2 (ridge) penalty for numerical stability under separation. Features
 * are z-scored before fitting and the model carries the standardisation so
 * prediction is on the raw feature scale. Used by the Brier backtest to test the
 * CALIBRATION of projections (P(actual ≥ threshold) from projected points), a
 * complement to the rank-discrimination model.
 *
 * Conventions match src/lib/stats/distribution.ts (pure functions, readonly
 * inputs, result interfaces).
 */

/** Numerically stable logistic sigmoid, σ(z) = 1 / (1 + e^−z). */
export function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

export interface Standardization {
  /** z-scored feature matrix. */
  Z: number[][];
  /** Per-column means used. */
  mean: number[];
  /** Per-column population standard deviations used (0 → 1 to avoid div-by-0). */
  std: number[];
}

/**
 * Column-wise z-score standardisation using population standard deviation. A
 * zero-variance column is mapped to all-zeros with sd recorded as 1, so the
 * transform is well-defined and invertible for prediction.
 */
export function standardize(X: readonly (readonly number[])[]): Standardization {
  const n = X.length;
  const d = n > 0 ? X[0]!.length : 0;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j]! += row[j]!;
  for (let j = 0; j < d; j++) mean[j]! /= Math.max(1, n);
  for (const row of X) {
    for (let j = 0; j < d; j++) {
      const dv = row[j]! - mean[j]!;
      std[j]! += dv * dv;
    }
  }
  for (let j = 0; j < d; j++) {
    std[j] = Math.sqrt(std[j]! / Math.max(1, n));
    if (std[j] === 0 || !Number.isFinite(std[j]!)) std[j] = 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - mean[j]!) / std[j]!));
  return { Z, mean, std };
}

export interface LogisticModel {
  /** Raw-scale intercept (bias). */
  intercept: number;
  /** Raw-scale coefficient per feature. */
  coefficients: number[];
}

export interface LogisticFitOptions {
  /** L2 (ridge) penalty on non-intercept coefficients. Default 1e-4. */
  l2?: number;
  /** Max Newton–Raphson iterations. Default 100. */
  maxIter?: number;
  /** Convergence tolerance on the max coefficient update. Default 1e-8. */
  tol?: number;
}

/** Solve A x = b for a small dense system via Gauss elimination w/ partial pivot. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const m = b.length;
  // Augmented matrix (copy so callers' data is untouched).
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < m; col++) {
    // Partial pivot: largest |value| in this column at/below the diagonal.
    let pivot = col;
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }
    const diag = M[col]![col]!;
    if (diag === 0 || !Number.isFinite(diag)) continue; // singular column — skip
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const factor = M[r]![col]! / diag;
      if (factor === 0) continue;
      for (let c = col; c <= m; c++) M[r]![c]! -= factor * M[col]![c]!;
    }
  }
  return M.map((row, i) => {
    const diag = row[i]!;
    return diag === 0 || !Number.isFinite(diag) ? 0 : row[m]! / diag;
  });
}

/**
 * Fit a binary logistic regression by Newton–Raphson (IRLS) with an L2 ridge
 * penalty on the slopes (not the intercept). Features are standardised before
 * fitting for conditioning; the returned model is on the RAW feature scale.
 * Deterministic and dependency-free. Returns the maximum-likelihood (or
 * ridge-penalised ML) estimate.
 */
export function fitLogistic(
  X: readonly (readonly number[])[],
  y: readonly number[],
  options: LogisticFitOptions = {}
): LogisticModel {
  const l2 = options.l2 ?? 1e-4;
  const maxIter = options.maxIter ?? 100;
  const tol = options.tol ?? 1e-8;
  const n = X.length;
  const d = n > 0 ? X[0]!.length : 0;
  const { Z, mean, std } = standardize(X);
  const m = d + 1; // + intercept

  const beta = new Array<number>(m).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const g = new Array<number>(m).fill(0); // score (penalised)
    const H = Array.from({ length: m }, () => new Array<number>(m).fill(0)); // X'WX + ridge
    for (let i = 0; i < n; i++) {
      const zi = Z[i]!;
      let eta = beta[0]!;
      for (let j = 0; j < d; j++) eta += beta[j + 1]! * zi[j]!;
      const p = sigmoid(eta);
      const w = Math.max(p * (1 - p), 1e-9);
      const resid = y[i]! - p;
      // xi = [1, zi...]
      g[0]! += resid;
      for (let j = 0; j < d; j++) g[j + 1]! += zi[j]! * resid;
      // Hessian (information) accumulation.
      H[0]![0]! += w;
      for (let j = 0; j < d; j++) {
        H[0]![j + 1]! += w * zi[j]!;
        H[j + 1]![0]! += w * zi[j]!;
        for (let k = 0; k < d; k++) H[j + 1]![k + 1]! += w * zi[j]! * zi[k]!;
      }
    }
    // Ridge on slopes only (index >= 1).
    for (let j = 1; j < m; j++) {
      g[j]! -= l2 * beta[j]!;
      H[j]![j]! += l2;
    }
    const delta = solveLinearSystem(H, g);
    let maxAbs = 0;
    for (let j = 0; j < m; j++) {
      beta[j]! += delta[j]!;
      maxAbs = Math.max(maxAbs, Math.abs(delta[j]!));
    }
    if (maxAbs < tol) break;
  }

  // Convert standardised coefficients back to the raw feature scale:
  //   η = a + Σ c_j (x_j − mean_j)/std_j
  //     = [a − Σ c_j mean_j/std_j] + Σ (c_j/std_j) x_j
  const a = beta[0]!;
  const coefficients = new Array<number>(d);
  let intercept = a;
  for (let j = 0; j < d; j++) {
    const cj = beta[j + 1]!;
    coefficients[j] = cj / std[j]!;
    intercept -= (cj * mean[j]!) / std[j]!;
  }
  return { intercept, coefficients };
}

/** Predicted P(y=1 | x) for a raw-scale feature vector. */
export function predictLogisticProba(model: LogisticModel, x: readonly number[]): number {
  let eta = model.intercept;
  for (let j = 0; j < model.coefficients.length; j++) eta += model.coefficients[j]! * x[j]!;
  return sigmoid(eta);
}

/**
 * Out-of-fold logistic probabilities: each row is predicted by a model trained
 * on all rows NOT in its fold (leave-one-fold-out). This yields honest,
 * leakage-free predicted probabilities for calibration assessment — the row's
 * own outcome never informs its prediction. `foldId[i]` assigns row i to a fold
 * (e.g. the NFL week). If only ONE fold is present there is no out-of-fold
 * training data, so those rows get the max-entropy prior 0.5 (never the in-fold
 * base rate, which would leak); real CV needs >= 2 folds.
 */
export function fitLogisticCV(
  X: readonly (readonly number[])[],
  y: readonly number[],
  foldId: readonly number[],
  options: LogisticFitOptions = {}
): number[] {
  const n = X.length;
  const oof = new Array<number>(n).fill(0);
  const folds = [...new Set(foldId)];
  for (const f of folds) {
    const trainX: number[][] = [];
    const trainY: number[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (foldId[i] === f) testIdx.push(i);
      else {
        trainX.push([...X[i]!]);
        trainY.push(y[i]!);
      }
    }
    if (trainX.length === 0) {
      // Degenerate: this is the only fold, so there is NO out-of-fold training
      // data. Emit the max-entropy prior 0.5 rather than the in-fold base rate —
      // the latter would leak the held-out outcomes back into their own
      // predictions. Real cross-validation requires >= 2 distinct folds.
      for (const i of testIdx) oof[i] = 0.5;
      continue;
    }
    const model = fitLogistic(trainX, trainY, options);
    for (const i of testIdx) oof[i] = predictLogisticProba(model, X[i]!);
  }
  return oof;
}
