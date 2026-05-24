import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  cohensD,
  connectingLetters,
  mean,
  oneWayAnova,
  quantile,
  stdev,
  welchTTest
} from "./distribution";

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
