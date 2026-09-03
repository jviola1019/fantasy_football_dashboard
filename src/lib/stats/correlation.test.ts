import { describe, expect, it } from "vitest";
import { rankAverage, pearson, spearman, partialSpearman, spearmanPValue } from "./correlation";

describe("rankAverage", () => {
  it("ranks from 1 and averages ties", () => {
    expect(rankAverage([10, 20, 30])).toEqual([1, 2, 3]);
    // Two-way tie at the bottom: ranks 1 and 2 both become 1.5.
    expect(rankAverage([5, 5, 9])).toEqual([1.5, 1.5, 3]);
    // Everything tied: every rank is the mean rank.
    expect(rankAverage([7, 7, 7, 7])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it("handles the tie pattern this data actually has", () => {
    // Half a fantasy dataset has zero carries. Assigning those arbitrary
    // distinct ranks would invent an ordering that is not in the data.
    const carries = [0, 0, 0, 0, 3, 12];
    expect(rankAverage(carries)).toEqual([2.5, 2.5, 2.5, 2.5, 5, 6]);
  });
});

describe("pearson", () => {
  it("is 1 and −1 for exact linear relationships", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("matches a hand-computed value", () => {
    // x = [1,2,3,4,5], y = [2,4,5,4,5].
    //   dx = 10, dy = 6, cov numerator = 6  ->  r = 6/sqrt(60) = 0.774597.
    // Worked by hand here because a self-referential expectation (asserting
    // whatever the function returns) would test nothing at all.
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(6 / Math.sqrt(60), 12);
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.774597, 6);
  });

  it("returns 0 for a constant column rather than NaN", () => {
    // A NaN here would propagate silently into an importance table.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });

  it("refuses mismatched lengths instead of correlating whatever lines up", () => {
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });
});

describe("spearman", () => {
  it("is 1 for any monotone increasing relationship, linear or not", () => {
    // The reason to use it: exponential growth is perfectly rank-ordered.
    const x = [1, 2, 3, 4, 5, 6];
    expect(spearman(x, x.map((v) => Math.exp(v)))).toBeCloseTo(1, 12);
    expect(pearson(x, x.map((v) => Math.exp(v)))).toBeLessThan(0.95);
  });

  it("is unmoved by an outlier that would dominate Pearson", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [1, 2, 3, 4, 1000];
    expect(spearman(x, y)).toBeCloseTo(1, 12);
  });
});

describe("partialSpearman", () => {
  it("is ~0 when x only correlates with y through c", () => {
    // x and y are both driven by c and share nothing else. A plain correlation
    // would report a strong relationship; the partial must not.
    const c = Array.from({ length: 200 }, (_, i) => i);
    const x = c.map((v) => v * 2);
    const y = c.map((v) => v * 3);
    expect(Math.abs(spearman(x, y))).toBeCloseTo(1, 6);
    expect(Math.abs(partialSpearman(x, y, c))).toBeLessThan(1e-6);
  });

  it("keeps a relationship that survives the control", () => {
    const n = 300;
    const c: number[] = [];
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const ci = i;
      const extra = (i % 7) - 3; // independent of c's ordering
      c.push(ci);
      x.push(ci + extra * 20);
      y.push(ci + extra * 20);
    }
    // x and y share the `extra` component, which c cannot explain.
    expect(partialSpearman(x, y, c)).toBeGreaterThan(0.3);
  });

  it("returns 0 rather than dividing by zero when the control explains everything", () => {
    const c = [1, 2, 3, 4, 5];
    expect(partialSpearman(c, c, c)).toBe(0);
  });
});

describe("spearmanPValue", () => {
  it("is small for a strong correlation on a large sample", () => {
    expect(spearmanPValue(0.5, 500)).toBeLessThan(1e-6);
  });

  it("is near 1 for no correlation", () => {
    expect(spearmanPValue(0, 500)).toBeCloseTo(1, 6);
  });

  it("is monotone in |r| and in n", () => {
    expect(spearmanPValue(0.3, 500)).toBeLessThan(spearmanPValue(0.2, 500));
    expect(spearmanPValue(0.2, 1000)).toBeLessThan(spearmanPValue(0.2, 200));
    expect(spearmanPValue(-0.4, 300)).toBeCloseTo(spearmanPValue(0.4, 300), 12);
  });

  it("matches the published critical value for r at n=100", () => {
    // Two-sided 0.05 critical value for Spearman at n=100 is ≈0.197.
    expect(spearmanPValue(0.197, 100)).toBeCloseTo(0.05, 2);
  });

  it("refuses to report significance it cannot support", () => {
    expect(spearmanPValue(0.9, 3)).toBe(1);
    expect(spearmanPValue(Number.NaN, 500)).toBe(1);
  });
});
