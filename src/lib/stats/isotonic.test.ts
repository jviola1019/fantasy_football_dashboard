import { describe, expect, it } from "vitest";
import { fitIsotonic, predictIsotonic, type IsotonicFit } from "./isotonic";
import { mulberry32 } from "../rng";

const values = (fit: IsotonicFit) => fit.blocks.map((b) => b.y);

describe("fitIsotonic", () => {
  it("leaves already-monotone data alone", () => {
    expect(values(fitIsotonic([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]))).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("pools a violating pair into their mean", () => {
    const fit = fitIsotonic([1, 2, 3], [0.1, 0.5, 0.3]);
    expect(values(fit)[values(fit).length - 1]).toBeCloseTo(0.4, 10);
    expect(isNonDecreasing(values(fit))).toBe(true);
  });

  it("pools backwards through a chain of violations", () => {
    // A single backward pass is not enough: merging two blocks can make the
    // merged mean violate the block before it. This input needs the cascade.
    const fit = fitIsotonic([1, 2, 3, 4], [0.9, 0.1, 0.1, 0.1]);
    expect(isNonDecreasing(values(fit))).toBe(true);
    expect(values(fit)[0]).toBeCloseTo(0.3, 10);
  });

  it("keeps BOTH edges of a pooled block", () => {
    // The representation the fix turns on. A block covering x=2..3 has to know
    // it covers both, or prediction inside it cannot be constant.
    const fit = fitIsotonic([1, 2, 3, 4], [0, 1, 0, 1]);
    expect(fit.blocks).toEqual([
      { xLeft: 1, xRight: 1, y: 0 },
      { xLeft: 2, xRight: 3, y: 0.5 },
      { xLeft: 4, xRight: 4, y: 1 }
    ]);
  });

  it("pools TIED x into one block, so the fit is single-valued", () => {
    // Second defect found in review: without this, `x` repeats and prediction
    // picks a branch by binary-search accident. Real projections tie constantly
    // — 915 distinct values across 1,470 WR rows.
    const fit = fitIsotonic([3, 3, 5], [0, 1, 1]);
    expect(fit.blocks).toEqual([
      { xLeft: 3, xRight: 3, y: 0.5 },
      { xLeft: 5, xRight: 5, y: 1 }
    ]);
    const xs = fit.blocks.map((b) => b.xLeft);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("always returns a non-decreasing fit, on random data", () => {
    // The one property the product actually depends on: more projected points
    // can never mean a lower probability of clearing the line.
    const rand = mulberry32(20260903);
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 5 + Math.floor(rand() * 40);
      // Deliberately coarse x so ties are frequent, like real projections.
      const x = Array.from({ length: n }, () => Math.round(rand() * 12));
      const y = Array.from({ length: n }, () => (rand() < 0.5 ? 0 : 1));
      const fit = fitIsotonic(x, y);
      expect(isNonDecreasing(values(fit)), `trial ${trial}`).toBe(true);
      for (let i = 1; i < fit.blocks.length; i += 1) {
        expect(fit.blocks[i]!.xLeft).toBeGreaterThan(fit.blocks[i - 1]!.xRight);
      }
    }
  });

  it("is the L2 optimum, beating a monotone alternative on squared error", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [0.2, 0.8, 0.1, 0.6, 0.4, 0.9];
    const fit = fitIsotonic(x, y);
    const sse = (pred: number[]) => pred.reduce((s, p, i) => s + (p - y[i]!) ** 2, 0);
    let running = -Infinity;
    const naive = y.map((v) => (running = Math.max(running, v)));
    const fitted = x.map((v) => predictIsotonic(fit, v));
    expect(sse(fitted)).toBeLessThanOrEqual(sse(naive) + 1e-12);
  });

  it("respects weights when pooling", () => {
    expect(values(fitIsotonic([1, 2], [1, 0], [1, 1]))[0]).toBeCloseTo(0.5, 10);
    expect(values(fitIsotonic([1, 2], [1, 0], [1, 9]))[0]).toBeLessThan(0.5);
  });

  it("handles empty and single-point input", () => {
    expect(fitIsotonic([], [])).toEqual({ blocks: [] });
    expect(values(fitIsotonic([5], [0.7]))).toEqual([0.7]);
  });

  it("refuses mismatched lengths rather than reading undefined", () => {
    expect(() => fitIsotonic([1, 2], [0.5])).toThrow(/x has 2/);
  });
});

describe("predictIsotonic", () => {
  it("returns the BLOCK'S OWN value inside a pooled block — the shipped bug", () => {
    // Found in correctness review 2026-09-04. The old implementation anchored
    // each block at its largest x and interpolated between anchors, so x=2
    // returned 0.25 instead of the block's own 0.5 — dragged toward the
    // PREVIOUS block. Always too low, never too high, on every pooled block.
    const fit = fitIsotonic([1, 2, 3, 4], [0, 1, 0, 1]);
    expect(predictIsotonic(fit, 2)).toBe(0.5);
    expect(predictIsotonic(fit, 3)).toBe(0.5);
    expect(predictIsotonic(fit, 2.5)).toBe(0.5);
  });

  it("returns the pooled value at a tied x", () => {
    expect(predictIsotonic(fitIsotonic([3, 3, 5], [0, 1, 1]), 3)).toBe(0.5);
  });

  it("is never biased downward on real-shaped data — the regression guard", () => {
    // The property the bug violated, stated as a property rather than a case.
    // Evaluated at every training x, the mean signed error must be ~0. The old
    // implementation scored −0.02 to −0.05 here, with EVERY prediction low.
    const rand = mulberry32(4242);
    const x = Array.from({ length: 2000 }, () => Math.round(rand() * 30));
    const y = x.map((v) => (rand() < 1 / (1 + Math.exp(-(v - 15) / 4)) ? 1 : 0));
    const fit = fitIsotonic(x, y);
    // The exact isotonic value at each x, read straight off the blocks.
    const truth = (v: number) => {
      for (const b of fit.blocks) if (v >= b.xLeft && v <= b.xRight) return b.y;
      return predictIsotonic(fit, v);
    };
    let signed = 0;
    for (const v of x) signed += predictIsotonic(fit, v) - truth(v);
    expect(Math.abs(signed / x.length)).toBeLessThan(1e-12);
  });

  it("interpolates only across the GAP between blocks", () => {
    const fit = fitIsotonic([0, 10, 20, 30], [0.1, 0.3, 0.6, 0.9]);
    // Singleton blocks, so 0..10 is a genuine gap with no observation in it.
    expect(predictIsotonic(fit, 5)).toBeCloseTo(0.2, 10);
    expect(predictIsotonic(fit, 15)).toBeCloseTo(0.45, 10);
  });

  it("clamps rather than extrapolating beyond the observed range", () => {
    const fit = fitIsotonic([0, 10, 20, 30], [0.1, 0.3, 0.6, 0.9]);
    expect(predictIsotonic(fit, -100)).toBe(0.1);
    expect(predictIsotonic(fit, 1e6)).toBe(0.9);
  });

  it("is monotone in its input", () => {
    const fit = fitIsotonic([0, 10, 20, 30, 30, 12], [0.1, 0.3, 0.6, 0.9, 0.2, 0.7]);
    let prev = -Infinity;
    for (let v = -5; v <= 35; v += 0.25) {
      const p = predictIsotonic(fit, v);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it("stays inside [0,1] for binary training outcomes", () => {
    const rand = mulberry32(7);
    const x = Array.from({ length: 300 }, () => rand() * 25);
    const y = x.map((v) => (rand() < 1 / (1 + Math.exp(-(v - 12) / 4)) ? 1 : 0));
    const f = fitIsotonic(x, y);
    for (let v = -10; v <= 40; v += 0.5) {
      const p = predictIsotonic(f, v);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("returns 0.5 for an empty fit rather than NaN", () => {
    expect(predictIsotonic({ blocks: [] }, 12)).toBe(0.5);
  });

  it("is invariant to any monotone rescaling — so recalibrating a 1-feature logistic is NOT a new model", () => {
    // Closes a thread rather than leaving it open. Corrected isotonic has a
    // BETTER out-of-fold ECE than the shipped logistic at WR (0.0157 vs 0.0230),
    // which invites the obvious follow-up: recalibrate the logistic with
    // isotonic and ship that.
    //
    // There is nothing to run. Isotonic regression depends only on the ORDERING
    // of its input, and a one-variable logistic is monotone in its feature, so
    // isotonic-on-the-score and isotonic-on-the-feature are the SAME fit. The
    // "recalibrated logistic" is exactly the isotonic family already in
    // docs/model-gauntlet.md, which loses on Brier at all four positions.
    const rand = mulberry32(11);
    const x = Array.from({ length: 1500 }, () => rand() * 30);
    const y = x.map((v) => (rand() < 1 / (1 + Math.exp(-(v - 15) / 4)) ? 1 : 0));
    const score = x.map((v) => 1 / (1 + Math.exp(-(0.3 * v - 4.2))));

    const onFeature = fitIsotonic(x, y);
    const onScore = fitIsotonic(score, y);
    expect(onScore.blocks.map((b) => b.y)).toEqual(onFeature.blocks.map((b) => b.y));
    for (let i = 0; i < x.length; i += 1) {
      expect(predictIsotonic(onScore, score[i]!)).toBeCloseTo(predictIsotonic(onFeature, x[i]!), 12);
    }
  });

  it("recovers a known monotone curve it was not told about", () => {
    const rand = mulberry32(99);
    const truth = (v: number) => 1 / (1 + Math.exp(-(v - 15) / 3));
    const x = Array.from({ length: 4000 }, () => rand() * 30);
    const y = x.map((v) => (rand() < truth(v) ? 1 : 0));
    const f = fitIsotonic(x, y);
    for (const v of [6, 12, 18, 24]) {
      expect(Math.abs(predictIsotonic(f, v) - truth(v)), `at ${v}`).toBeLessThan(0.08);
    }
  });
});

function isNonDecreasing(vals: readonly number[]): boolean {
  for (let i = 1; i < vals.length; i += 1) if (vals[i]! < vals[i - 1]! - 1e-12) return false;
  return true;
}
