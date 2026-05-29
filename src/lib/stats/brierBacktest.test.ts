// Synthetic 3-team 4-week toy league backtest.
// Verifies that the Brier + k-fold plumbing works end-to-end on known data
// without requiring an HTTP fetch.

import { describe, it, expect } from "vitest";
import { brierScore, kFoldCV, reliabilityDiagram } from "./distribution";
import type { BrierForecast } from "./distribution";

// Synthetic forecasts: 3 teams, 4 weeks, binary "made playoffs" outcome.
// Teams are labelled A (strong), B (medium), C (weak).
// We use known probabilities so the expected Brier is calculable.

function syntheticForecasts(): BrierForecast[] {
  // Week-by-week forecasts + outcomes for 12 team-weeks.
  // prob = simulated championship probability, outcome = 1 if they won.
  return [
    // Week 1: A dominates
    { prob: 0.8, outcome: 1 },
    { prob: 0.5, outcome: 0 },
    { prob: 0.2, outcome: 0 },
    // Week 2: B wins
    { prob: 0.7, outcome: 0 },
    { prob: 0.6, outcome: 1 },
    { prob: 0.3, outcome: 0 },
    // Week 3: C upsets
    { prob: 0.9, outcome: 0 },
    { prob: 0.4, outcome: 0 },
    { prob: 0.1, outcome: 1 },
    // Week 4: A wins again
    { prob: 0.85, outcome: 1 },
    { prob: 0.45, outcome: 0 },
    { prob: 0.25, outcome: 0 }
  ];
}

describe("brierBacktest integration (synthetic toy league)", () => {
  it("computes Brier score for the full 4-week dataset", () => {
    const forecasts = syntheticForecasts();
    const result = brierScore(forecasts);

    expect(result.n).toBe(12);
    // Manual: Σ(prob − outcome)² / 12
    const expected =
      ((0.8 - 1) ** 2 + (0.5 - 0) ** 2 + (0.2 - 0) ** 2 +
        (0.7 - 0) ** 2 + (0.6 - 1) ** 2 + (0.3 - 0) ** 2 +
        (0.9 - 0) ** 2 + (0.4 - 0) ** 2 + (0.1 - 1) ** 2 +
        (0.85 - 1) ** 2 + (0.45 - 0) ** 2 + (0.25 - 0) ** 2) /
      12;
    expect(result.score).toBeCloseTo(expected, 6);
  });

  it("Murphy decomposition sums to total Brier", () => {
    const result = brierScore(syntheticForecasts());
    expect(result.reliability - result.resolution + result.uncertainty).toBeCloseTo(
      result.score,
      8
    );
  });

  it("k-fold CV (4 folds = 4 weeks) produces reasonable per-fold scores", () => {
    // Split by week: each fold is one week's data.
    const byWeek: BrierForecast[][] = [
      syntheticForecasts().slice(0, 3),  // week 1
      syntheticForecasts().slice(3, 6),  // week 2
      syntheticForecasts().slice(6, 9),  // week 3
      syntheticForecasts().slice(9, 12)  // week 4
    ];

    const result = kFoldCV(byWeek, 4, (_train, test) => {
      const flat = test.flat();
      return brierScore(flat).score;
    });

    expect(result.foldScores).toHaveLength(4);
    expect(result.meanScore).toBeGreaterThan(0);
    expect(result.meanScore).toBeLessThan(1);
    // Each fold should have a Brier between 0 and 1
    for (const s of result.foldScores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("reliability diagram groups into correct bins", () => {
    const forecasts = syntheticForecasts();
    const diag = reliabilityDiagram(forecasts, 10);

    // Should have 3–4 non-empty bins given probability range [0.1, 0.9]
    expect(diag.length).toBeGreaterThanOrEqual(3);
    for (const bin of diag) {
      expect(bin.n).toBeGreaterThan(0);
      expect(bin.observedFreq).toBeGreaterThanOrEqual(0);
      expect(bin.observedFreq).toBeLessThanOrEqual(1);
      expect(bin.meanForecast).toBeGreaterThan(0);
    }
  });

  it("Brier is lower with strong model than weak model", () => {
    // Strong model: high prob → always wins, low prob → always loses.
    const strongForecasts: BrierForecast[] = [
      { prob: 0.9, outcome: 1 },
      { prob: 0.1, outcome: 0 },
      { prob: 0.8, outcome: 1 },
      { prob: 0.2, outcome: 0 }
    ];
    // Weak model: coin flip for all.
    const weakForecasts: BrierForecast[] = [
      { prob: 0.5, outcome: 1 },
      { prob: 0.5, outcome: 0 },
      { prob: 0.5, outcome: 1 },
      { prob: 0.5, outcome: 0 }
    ];

    const strongBrier = brierScore(strongForecasts).score;
    const weakBrier = brierScore(weakForecasts).score;
    expect(strongBrier).toBeLessThan(weakBrier);
  });
});
