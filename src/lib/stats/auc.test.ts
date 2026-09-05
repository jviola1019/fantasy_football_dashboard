import { describe, expect, it } from "vitest";
import { rocAuc } from "./auc";
import { mulberry32 } from "../rng";

describe("rocAuc", () => {
  it("is 1 for a perfect ranking and 0 for a perfectly inverted one", () => {
    const y: (0 | 1)[] = [0, 0, 1, 1];
    expect(rocAuc([1, 2, 3, 4], y)).toBe(1);
    expect(rocAuc([4, 3, 2, 1], y)).toBe(0);
  });

  it("is 0.5 when every score is tied", () => {
    // A model that cannot separate anything has coin-flip discrimination, and
    // midranks are what deliver that without a special case.
    expect(rocAuc([7, 7, 7, 7], [0, 1, 0, 1])).toBe(0.5);
  });

  it("scores a tie as exactly half a correct ordering", () => {
    // One positive, one negative, tied: half. Worked by hand so the tie
    // convention is pinned rather than inherited from an implementation.
    expect(rocAuc([5, 5], [0, 1])).toBe(0.5);
    // Two clean pairs plus one tied pair: (1 + 1 + 0.5 + 0.5)/4.
    expect(rocAuc([1, 2, 2, 3], [0, 0, 1, 1])).toBeCloseTo(0.875, 10);
  });

  it("matches the brute-force pair count on random data", () => {
    // The definition itself: P(random positive outranks random negative), ties
    // counting half. Checked against every pair rather than trusted.
    const rand = mulberry32(20260903);
    for (let trial = 0; trial < 60; trial += 1) {
      const n = 8 + Math.floor(rand() * 30);
      const scores = Array.from({ length: n }, () => Math.round(rand() * 5));
      const y = Array.from({ length: n }, () => (rand() < 0.5 ? 0 : 1) as 0 | 1);
      if (!y.includes(0) || !y.includes(1)) continue;
      let wins = 0;
      let pairs = 0;
      for (let a = 0; a < n; a += 1) {
        for (let b = 0; b < n; b += 1) {
          if (y[a] === 1 && y[b] === 0) {
            pairs += 1;
            if (scores[a]! > scores[b]!) wins += 1;
            else if (scores[a]! === scores[b]!) wins += 0.5;
          }
        }
      }
      expect(rocAuc(scores, y), `trial ${trial}`).toBeCloseTo(wins / pairs, 10);
    }
  });

  it("is invariant to any monotone rescaling of the scores", () => {
    // The property that makes AUC blind to calibration — and the reason it is
    // reported BESIDE Brier and never instead of it.
    const rand = mulberry32(11);
    const scores = Array.from({ length: 200 }, () => rand() * 10);
    const y = scores.map((s) => (s > 5 ? 1 : 0) as 0 | 1);
    const squashed = scores.map((s) => 1 / (1 + Math.exp(-(s - 5))));
    const shifted = scores.map((s) => s * 3 + 100);
    expect(rocAuc(squashed, y)).toBeCloseTo(rocAuc(scores, y), 12);
    expect(rocAuc(shifted, y)).toBeCloseTo(rocAuc(scores, y), 12);
  });

  it("returns NaN when a class is missing rather than a misleading 0.5", () => {
    // 0.5 would read as "no discrimination" when the truth is "the question has
    // no answer on this sample", and it would pass silently into a report.
    expect(Number.isNaN(rocAuc([1, 2, 3], [1, 1, 1]))).toBe(true);
    expect(Number.isNaN(rocAuc([1, 2, 3], [0, 0, 0]))).toBe(true);
    expect(Number.isNaN(rocAuc([], []))).toBe(true);
  });

  it("refuses misaligned inputs", () => {
    expect(() => rocAuc([1, 2, 3], [0, 1])).toThrow(/3 scores and 2/);
  });

  it("recovers an ANALYTICALLY known AUC — the strongest canary available", () => {
    // Positives score 1 + U(0,2), negatives score U(0,2). AUC is then
    // P(1 + U1 > U2) = P(U2 - U1 < 1), and U2 - U1 is triangular on [-2, 2],
    // so the right tail beyond 1 has area 1/8 and the true AUC is exactly
    // 0.875. Asserting a derived constant catches a subtly wrong rank sum that
    // a loose "above chance" bound would wave through.
    const rand = mulberry32(3);
    const y: (0 | 1)[] = [];
    const s: number[] = [];
    for (let i = 0; i < 40000; i += 1) {
      const positive = rand() < 0.4;
      y.push(positive ? 1 : 0);
      s.push((positive ? 1 : 0) + rand() * 2);
    }
    expect(rocAuc(s, y)).toBeCloseTo(0.875, 2);
  });
});
