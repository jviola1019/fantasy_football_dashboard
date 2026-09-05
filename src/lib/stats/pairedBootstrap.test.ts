import { describe, expect, it } from "vitest";
import { pairedBootstrap } from "./pairedBootstrap";
import { mulberry32 } from "../rng";

describe("pairedBootstrap", () => {
  it("signs the difference so NEGATIVE means B is better", () => {
    // These are LOSSES. A "difference" that silently meant "improvement" is how
    // a sign error ships, so the direction is pinned first.
    const a = [0.5, 0.5, 0.5, 0.5];
    const b = [0.2, 0.2, 0.2, 0.2];
    expect(pairedBootstrap(a, b).meanDifference).toBeCloseTo(-0.3, 10);
    expect(pairedBootstrap(b, a).meanDifference).toBeCloseTo(0.3, 10);
  });

  it("finds a real, consistent improvement significant", () => {
    const rand = mulberry32(1);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      const base = rand();
      a.push(base);
      b.push(base - 0.05);
    }
    const out = pairedBootstrap(a, b);
    expect(out.meanDifference).toBeLessThan(0);
    expect(out.upper).toBeLessThan(0);
    expect(out.pValue).toBeLessThan(0.01);
  });

  it("does NOT find a difference when there is none — the null case", () => {
    // The property that makes a positive result mean anything. Two models with
    // identical expected loss must not be separated.
    const rand = mulberry32(2);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 800; i += 1) {
      a.push(rand());
      b.push(rand());
    }
    expect(pairedBootstrap(a, b).pValue).toBeGreaterThan(0.05);
  });

  it("is not fooled by huge shared row-to-row variance — the point of pairing", () => {
    // Rows differ wildly in difficulty. Unpaired, a 0.02 mean gap is invisible
    // under that variance; paired, it is obvious. This is why the module exists.
    const rand = mulberry32(3);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const difficulty = rand() * 10;
      a.push(difficulty);
      b.push(difficulty - 0.02);
    }
    const out = pairedBootstrap(a, b);
    expect(out.pValue).toBeLessThan(0.01);
    // And the estimate is the small real gap, not swamped by the difficulty.
    expect(out.meanDifference).toBeCloseTo(-0.02, 6);
  });

  it("never returns a p-value of exactly zero", () => {
    // 2000 resamples cannot support "p = 0", and printing it would overstate
    // what the method knows.
    const a = Array.from({ length: 200 }, () => 1);
    const b = Array.from({ length: 200 }, () => 0);
    expect(pairedBootstrap(a, b).pValue).toBeGreaterThan(0);
  });

  it("brackets the estimate with its interval", () => {
    const rand = mulberry32(4);
    const a = Array.from({ length: 300 }, () => rand());
    const b = Array.from({ length: 300 }, () => rand() - 0.1);
    const out = pairedBootstrap(a, b);
    expect(out.lower).toBeLessThanOrEqual(out.meanDifference);
    expect(out.upper).toBeGreaterThanOrEqual(out.meanDifference);
  });

  it("is deterministic given its seed", () => {
    const rand = mulberry32(5);
    const a = Array.from({ length: 200 }, () => rand());
    const b = Array.from({ length: 200 }, () => rand());
    expect(pairedBootstrap(a, b)).toEqual(pairedBootstrap(a, b));
  });

  it("refuses misaligned inputs rather than comparing wrong rows", () => {
    expect(() => pairedBootstrap([1, 2, 3], [1, 2])).toThrow(/3 vs 2/);
  });

  it("returns a neutral result for empty input rather than NaN p-values", () => {
    const out = pairedBootstrap([], []);
    expect(out.n).toBe(0);
    expect(out.pValue).toBe(1);
  });
});
