import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  brierScore,
  chiSquare1PValue,
  cohensD,
  connectingLetters,
  expectedCalibrationError,
  kFoldCV,
  mean,
  oneWayAnova,
  quantile,
  reliabilityDiagram,
  stdev,
  welchTTest,
  wilsonInterval
} from "./distribution";

describe("wilsonInterval", () => {
  it("brackets the estimate and is tight for large n", () => {
    const ci = wilsonInterval(0.5, 10_000, 0.9);
    expect(ci.lower).toBeLessThan(0.5);
    expect(ci.upper).toBeGreaterThan(0.5);
    expect(ci.width).toBeLessThan(0.02); // ~0.016 at n=10k
    expect(ci.width).toBeGreaterThan(0); // a real, non-degenerate band
  });

  it("stays inside [0,1] at the extremes (never impossible)", () => {
    const atOne = wilsonInterval(1, 100, 0.9);
    expect(atOne.upper).toBeLessThanOrEqual(1);
    expect(atOne.lower).toBeGreaterThanOrEqual(0);
    expect(atOne.lower).toBeLessThan(1); // Wilson pulls the bound in from 1
    const atZero = wilsonInterval(0, 100, 0.9);
    expect(atZero.lower).toBeGreaterThanOrEqual(0);
    expect(atZero.upper).toBeGreaterThan(0);
  });

  it("narrows as n grows (more sims ⇒ less sampling error)", () => {
    const small = wilsonInterval(0.4, 100, 0.9);
    const large = wilsonInterval(0.4, 10_000, 0.9);
    expect(large.width).toBeLessThan(small.width);
  });

  it("degrades honestly to [0,1] when n is non-positive", () => {
    const ci = wilsonInterval(0.5, 0, 0.9);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(1);
  });
});

describe("expectedCalibrationError", () => {
  it("is ~0 for perfectly calibrated forecasts", () => {
    // Bin at 0.0 all-zero outcomes, bin at 1.0 all-one outcomes, bin at 0.5 half/half.
    const forecasts = [
      ...Array.from({ length: 50 }, () => ({ prob: 0.0, outcome: 0 as const })),
      ...Array.from({ length: 50 }, () => ({ prob: 1.0, outcome: 1 as const })),
      ...Array.from({ length: 25 }, () => ({ prob: 0.5, outcome: 1 as const })),
      ...Array.from({ length: 25 }, () => ({ prob: 0.5, outcome: 0 as const }))
    ];
    const c = expectedCalibrationError(forecasts, 10);
    expect(c.ece).toBeCloseTo(0, 6);
    expect(c.mce).toBeCloseTo(0, 6);
    expect(c.reliabilityBinned).toBeCloseTo(0, 6);
  });

  it("equals the gap for a confidently wrong forecast (all 0.9, outcomes 50%)", () => {
    const forecasts = [
      ...Array.from({ length: 50 }, () => ({ prob: 0.9, outcome: 1 as const })),
      ...Array.from({ length: 50 }, () => ({ prob: 0.9, outcome: 0 as const }))
    ];
    const c = expectedCalibrationError(forecasts, 10);
    // Single occupied bin: mean forecast 0.9, observed 0.5 → |gap| = 0.4.
    expect(c.ece).toBeCloseTo(0.4, 6);
    expect(c.mce).toBeCloseTo(0.4, 6);
    expect(c.reliabilityBinned).toBeCloseTo(0.16, 6); // gap^2
  });

  it("weights bins by occupancy for ECE (vs unweighted MCE)", () => {
    // Big well-calibrated bin + tiny badly-calibrated bin → ECE small, MCE large.
    const forecasts = [
      ...Array.from({ length: 98 }, (_, i) => ({ prob: 0.5, outcome: (i % 2) as 0 | 1 })),
      { prob: 0.95, outcome: 0 as const },
      { prob: 0.95, outcome: 0 as const }
    ];
    const c = expectedCalibrationError(forecasts, 10);
    expect(c.mce).toBeGreaterThan(0.9); // the 0.95 bin: |0 - 0.95| ≈ 0.95
    expect(c.ece).toBeLessThan(0.05); // but it's only 2/100 of the mass
  });
});

describe("stats helpers", () => {
  describe("mean / stdev / quantile", () => {
    it("computes mean of a textbook sample", () => {
      expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(5, 10);
    });

    it("computes sample stdev (n-1) of a textbook sample", () => {
      // var = 32/7 ≈ 4.5714; stdev ≈ 2.13809
      expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
    });

    it("returns NaN for stdev with < 2 samples", () => {
      expect(stdev([1])).toBeNaN();
      expect(stdev([])).toBeNaN();
    });

    it("quantile matches R type-7 reference values", () => {
      // R: quantile(c(1,2,3,4,5,6,7,8,9,10), c(0.25, 0.5, 0.75)) -> 3.25, 5.5, 7.75
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(quantile(data, 0.25)).toBeCloseTo(3.25, 6);
      expect(quantile(data, 0.5)).toBeCloseTo(5.5, 6);
      expect(quantile(data, 0.75)).toBeCloseTo(7.75, 6);
    });
  });

  describe("bootstrapCI", () => {
    it("CI covers the point estimate", () => {
      const samples = Array.from({ length: 200 }, (_, i) => i + 1);
      const ci = bootstrapCI(samples, 0.95, 1000, 42);
      expect(ci.estimate).toBeCloseTo(100.5, 6);
      expect(ci.lower).toBeLessThanOrEqual(ci.estimate);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.estimate);
      expect(ci.width).toBeCloseTo(ci.upper - ci.lower, 10);
    });

    it("is deterministic given the same seed", () => {
      const samples = [5, 10, 15, 20, 25, 30];
      const a = bootstrapCI(samples, 0.95, 500, 7);
      const b = bootstrapCI(samples, 0.95, 500, 7);
      expect(a).toEqual(b);
    });

    it("a wider confidence level produces a wider interval", () => {
      const samples = Array.from({ length: 100 }, (_, i) => i);
      const ninety = bootstrapCI(samples, 0.9, 1000, 11);
      const ninetyNine = bootstrapCI(samples, 0.99, 1000, 11);
      expect(ninetyNine.width).toBeGreaterThan(ninety.width);
    });

    it("handles empty input without throwing", () => {
      const ci = bootstrapCI([], 0.95, 100, 1);
      expect(ci.estimate).toBeNaN();
      expect(ci.lower).toBeNaN();
    });
  });

  describe("welchTTest", () => {
    it("detects a large mean difference with p < 0.001", () => {
      const a = Array.from({ length: 200 }, () => 100);
      const b = Array.from({ length: 200 }, () => 50);
      const result = welchTTest(a, b);
      expect(result.meanDelta).toBeCloseTo(50, 6);
      expect(result.pTwoSided).toBeLessThan(0.001);
    });

    it("returns p close to 1 for identical samples", () => {
      const a = [1, 2, 3, 4, 5];
      const b = [1, 2, 3, 4, 5];
      const result = welchTTest(a, b);
      expect(Math.abs(result.t)).toBeLessThan(1e-9);
      expect(result.pTwoSided).toBeGreaterThan(0.99);
    });

    it("returns NaN with degenerate input", () => {
      const result = welchTTest([1], [2]);
      expect(result.t).toBeNaN();
    });
  });

  describe("cohensD", () => {
    it("reports a large effect size (>= 0.8) for separated distributions", () => {
      // a ~ N(0, 1), b ~ N(2, 1) → d ≈ 2
      const a = Array.from({ length: 100 }, (_, i) => (i / 100) * 4 - 2);
      const b = Array.from({ length: 100 }, (_, i) => (i / 100) * 4 + 0);
      const d = cohensD(a, b);
      expect(Math.abs(d)).toBeGreaterThanOrEqual(0.8);
    });

    it("returns 0 for identical samples", () => {
      const a = [1, 2, 3, 4, 5];
      const b = [1, 2, 3, 4, 5];
      expect(cohensD(a, b)).toBeCloseTo(0, 10);
    });
  });

  describe("oneWayAnova", () => {
    it("detects a clear difference between three well-separated groups", () => {
      // Three groups, means 10 / 20 / 30, small within-group variance.
      const g1 = [10, 11, 9, 10, 12, 8, 10, 11];
      const g2 = [20, 21, 19, 20, 22, 18, 20, 21];
      const g3 = [30, 31, 29, 30, 32, 28, 30, 31];
      const res = oneWayAnova([g1, g2, g3]);
      expect(res.k).toBe(3);
      expect(res.n).toBe(24);
      expect(res.dfBetween).toBe(2);
      expect(res.dfWithin).toBe(21);
      expect(res.F).toBeGreaterThan(50); // strongly significant
      expect(res.pValue).toBeLessThan(0.001);
      expect(res.groupMeans.map((m) => Math.round(m))).toEqual([10, 20, 30]);
    });

    it("returns p near 1 when all groups share the same distribution", () => {
      const g = (seed: number) => [seed, seed + 1, seed - 1, seed + 0.5, seed - 0.5];
      const res = oneWayAnova([g(10), g(10), g(10)]);
      // F should be 0 (all group means identical), p = 1.
      expect(res.F).toBeCloseTo(0, 6);
      expect(res.pValue).toBeCloseTo(1, 4);
    });

    it("returns NaN for fewer than two groups", () => {
      expect(oneWayAnova([[1, 2, 3]]).F).toBeNaN();
      expect(oneWayAnova([]).F).toBeNaN();
    });

    it("handles a degenerate case where within-group variance is zero", () => {
      // All values inside each group identical; group means differ.
      const res = oneWayAnova([
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3]
      ]);
      expect(res.F).toBe(Number.POSITIVE_INFINITY);
      expect(res.pValue).toBe(0);
    });
  });

  describe("connectingLetters", () => {
    it("assigns the same letter to two indistinguishable groups", () => {
      // g1 and g2 sampled from the same distribution; g3 is shifted far away.
      const g1 = [10, 11, 9, 10, 12, 8, 10, 11, 9, 11, 10, 9];
      const g2 = [10, 11, 9, 10, 12, 8, 10, 11, 9, 11, 10, 9];
      const g3 = [100, 101, 99, 100, 102, 98, 100, 101, 99, 101, 100, 99];
      const letters = connectingLetters([g1, g2, g3]);
      // g1 and g2 share a letter; g3 does not share any letter with them.
      const set1 = new Set(letters[0]!);
      const set2 = new Set(letters[1]!);
      const set3 = new Set(letters[2]!);
      const shares12 = [...set1].some((c) => set2.has(c));
      const shares13 = [...set1].some((c) => set3.has(c));
      const shares23 = [...set2].some((c) => set3.has(c));
      expect(shares12).toBe(true);
      expect(shares13).toBe(false);
      expect(shares23).toBe(false);
    });

    it("gives every group its own letter when all are distinct", () => {
      const g1 = Array.from({ length: 30 }, (_, i) => 10 + i * 0.01);
      const g2 = Array.from({ length: 30 }, (_, i) => 30 + i * 0.01);
      const g3 = Array.from({ length: 30 }, (_, i) => 60 + i * 0.01);
      const letters = connectingLetters([g1, g2, g3]);
      // No two of these share any letter.
      const seen = new Map<string, number>();
      for (const l of letters) {
        for (const c of l) seen.set(c, (seen.get(c) ?? 0) + 1);
      }
      for (const count of seen.values()) {
        expect(count).toBe(1);
      }
    });

    it("gives all groups the same letter when nothing is significant", () => {
      // Three small noisy groups, indistinguishable.
      const g = (seed: number) => Array.from({ length: 8 }, (_, i) => seed + i * 0.01);
      const letters = connectingLetters([g(10), g(10), g(10)]);
      const shared = letters.every((l) => l.includes(letters[0]![0]!));
      expect(shared).toBe(true);
    });

    it("returns single letter for a single group", () => {
      expect(connectingLetters([[1, 2, 3]])).toEqual(["a"]);
    });

    it("returns empty for zero groups", () => {
      expect(connectingLetters([])).toEqual([]);
    });
  });
});

describe("brierScore", () => {
  it("returns 0 for a perfect forecast", () => {
    const forecasts = [
      { prob: 1, outcome: 1 as const },
      { prob: 0, outcome: 0 as const },
      { prob: 1, outcome: 1 as const }
    ];
    const r = brierScore(forecasts);
    expect(r.score).toBeCloseTo(0);
    expect(r.n).toBe(3);
  });

  it("returns 0.25 for always-0.5 on a coin flip", () => {
    // E[(0.5 - outcome)^2] = 0.25 regardless of outcomes
    const forecasts = Array.from({ length: 100 }, (_, i) => ({
      prob: 0.5,
      outcome: (i % 2) as 0 | 1
    }));
    const r = brierScore(forecasts);
    expect(r.score).toBeCloseTo(0.25, 5);
  });

  it("Murphy decomposition sums to total Brier within ε", () => {
    const forecasts = [
      { prob: 0.8, outcome: 1 as const },
      { prob: 0.7, outcome: 1 as const },
      { prob: 0.3, outcome: 0 as const },
      { prob: 0.2, outcome: 0 as const },
      { prob: 0.6, outcome: 0 as const }
    ];
    const r = brierScore(forecasts);
    // Brier = reliability − resolution + uncertainty
    expect(r.reliability - r.resolution + r.uncertainty).toBeCloseTo(r.score, 8);
  });

  it("returns NaN for empty input", () => {
    const r = brierScore([]);
    expect(r.n).toBe(0);
    expect(r.score).toBeNaN();
  });

  it("worst possible forecast (always wrong) scores 1", () => {
    const forecasts = [
      { prob: 1, outcome: 0 as const },
      { prob: 0, outcome: 1 as const }
    ];
    const r = brierScore(forecasts);
    expect(r.score).toBeCloseTo(1);
  });
});

describe("reliabilityDiagram", () => {
  it("returns identity-line bins for a perfectly calibrated forecaster", () => {
    // For each bin centre b, emit 100 forecasts with prob=b and outcome 1 with
    // frequency b. Then every bin's observedFreq ≈ meanForecast ≈ binCenter.
    const forecasts: Array<{ prob: number; outcome: 0 | 1 }> = [];
    for (const b of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const n = 100;
      const hits = Math.round(b * n);
      for (let i = 0; i < n; i++) {
        forecasts.push({ prob: b, outcome: i < hits ? 1 : 0 });
      }
    }
    const diag = reliabilityDiagram(forecasts, 10);
    expect(diag.length).toBeGreaterThan(0);
    for (const bin of diag) {
      // Bin's mean forecast should be within 0.05 of its observed frequency.
      expect(Math.abs(bin.meanForecast - bin.observedFreq)).toBeLessThan(0.06);
    }
  });

  it("returns empty array for empty input", () => {
    expect(reliabilityDiagram([], 10)).toEqual([]);
  });

  it("returns correct bin count (skips empty bins)", () => {
    const forecasts = [{ prob: 0.05, outcome: 1 as const }];
    const diag = reliabilityDiagram(forecasts, 10);
    expect(diag).toHaveLength(1);
    expect(diag[0]!.n).toBe(1);
  });
});

describe("kFoldCV", () => {
  it("computes correct mean and std across k folds", () => {
    // 10 samples, k=5: each fold has 2 test samples.
    const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = kFoldCV(samples, 5, (train, test) => {
      // Score = mean of test set. We know what each fold will be.
      return test.reduce((s, v) => s + v, 0) / test.length;
    });
    expect(result.foldScores).toHaveLength(5);
    // Fold means: [0.5, 2.5, 4.5, 6.5, 8.5] → grand mean = 4.5
    expect(result.meanScore).toBeCloseTo(4.5);
    expect(result.foldScores[0]).toBeCloseTo(0.5);
    expect(result.foldScores[4]).toBeCloseTo(8.5);
  });

  it("k is clamped to sample count (handles k > n)", () => {
    const samples = [1, 2, 3];
    const result = kFoldCV(samples, 10, (_train, test) => test[0]!);
    expect(result.foldScores).toHaveLength(3);
  });

  it("k is clamped to minimum of 2", () => {
    const samples = [1, 2, 3, 4];
    const result = kFoldCV(samples, 1, (_train, test) => test.length);
    expect(result.foldScores).toHaveLength(2);
  });

  it("stdScore is 0 when all folds return the same value", () => {
    const samples = [5, 5, 5, 5, 5, 5];
    const result = kFoldCV(samples, 3, () => 42);
    expect(result.meanScore).toBe(42);
    expect(result.stdScore).toBe(0);
  });

  it("train + test partition covers all samples", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let totalTestSize = 0;
    kFoldCV(samples, 5, (_train, test) => {
      totalTestSize += test.length;
      return 0;
    });
    expect(totalTestSize).toBe(samples.length);
  });
});

describe("chiSquare1PValue", () => {
  /**
   * Exists for the nested likelihood-ratio test in
   * `scripts/test-weekly-covariates.ts`, which decides whether a candidate
   * predictor earns a place in a shipped model. A p-value wrong in the
   * conservative direction quietly kills real signal; wrong the other way ships
   * noise as a coefficient. So it is pinned against published critical values
   * rather than against itself.
   */
  it("matches the standard chi-square(1) critical values", () => {
    expect(chiSquare1PValue(3.841)).toBeCloseTo(0.05, 3);
    expect(chiSquare1PValue(6.635)).toBeCloseTo(0.01, 3);
    expect(chiSquare1PValue(2.706)).toBeCloseTo(0.1, 3);
    expect(chiSquare1PValue(10.828)).toBeCloseTo(0.001, 4);
  });

  it("is the square of the standard normal, which is the identity it relies on", () => {
    // chi2(1) = Z^2, so P(X > z^2) must equal the two-sided normal p for z.
    // Checked against a DIFFERENT normal approximation (A&S 26.2.17) than the
    // one the implementation uses, so this is a check and not a restatement.
    const phi = (x: number) => {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
      const p =
        d *
        t *
        (0.31938153 +
          t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
      return x >= 0 ? 1 - p : p;
    };
    for (const z of [0.5, 1, 1.5, 1.96, 2.5, 3]) {
      expect(chiSquare1PValue(z * z)).toBeCloseTo(2 * (1 - phi(z)), 4);
    }
  });

  it("returns 1 for a statistic that shows no improvement at all", () => {
    // A likelihood ratio of 0 means the extra parameter bought nothing. A
    // slightly negative value can appear from floating-point noise or a ridge
    // penalty and means the same thing; it must not become a small p-value.
    expect(chiSquare1PValue(0)).toBe(1);
    expect(chiSquare1PValue(-1e-9)).toBe(1);
    expect(chiSquare1PValue(Number.NaN)).toBe(1);
  });

  it("is monotonically decreasing, so a bigger statistic is never less significant", () => {
    let prev = 1;
    for (const x of [0.1, 1, 2, 4, 8, 16, 32]) {
      const p = chiSquare1PValue(x);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    expect(prev).toBeLessThan(1e-6);
  });
});
