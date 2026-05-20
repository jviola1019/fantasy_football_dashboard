import { describe, expect, it } from "vitest";
import { bootstrapCI, cohensD, mean, quantile, stdev, welchTTest } from "./distribution";

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
});
