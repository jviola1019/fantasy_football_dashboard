import { describe, expect, it } from "vitest";
import {
  BAND_LABEL,
  BAND_TONE,
  classifyScenario,
  MODEL_FAILURE_DETAIL,
  MODEL_FAILURE_HEADLINE,
  scenarioReading,
  structuralBaseline,
  type ScenarioBand
} from "./scenarioBand";

/** The scenario percentage sitting exactly at odds ratio `or` from `basePct`. */
function atOddsRatio(basePct: number, or: number): number {
  const b = basePct / 100;
  const odds = (b / (1 - b)) * or;
  return (odds / (1 + odds)) * 100;
}

describe("structuralBaseline", () => {
  it("is arithmetic about the league, not a model output", () => {
    expect(structuralBaseline(10, 6)).toMatchObject({ playoffs: 60, championship: 10 });
    expect(structuralBaseline(12, 6)).toMatchObject({ playoffs: 50 });
    expect(structuralBaseline(12, 6).championship).toBeCloseTo(100 / 12, 10);
    expect(structuralBaseline(8, 4)).toMatchObject({ playoffs: 50, championship: 12.5 });
  });

  it("clamps a nonsense league shape instead of emitting an impossible rate", () => {
    expect(structuralBaseline(10, 99).playoffs).toBe(100);
    expect(structuralBaseline(1, 1).numTeams).toBe(2);
    expect(structuralBaseline(10, 0).playoffTeams).toBe(1);
  });

  it("never returns a rate outside (0, 100]", () => {
    for (const teams of [2, 4, 8, 10, 12, 14, 16, 20]) {
      for (const berths of [0, 1, 2, 6, 8, 99]) {
        const b = structuralBaseline(teams, berths);
        expect(b.playoffs).toBeGreaterThan(0);
        expect(b.playoffs).toBeLessThanOrEqual(100);
        expect(b.championship).toBeGreaterThan(0);
        expect(b.championship).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("classifyScenario", () => {
  const baseline = 60;

  it("buckets by ODDS RATIO so the scale is comparable across outcomes", () => {
    // The same odds ratio against a 10% championship baseline and a 60% playoff
    // baseline must land in the same bucket.
    const or = 0.4;
    expect(classifyScenario(atOddsRatio(10, or), 10)).toBe(
      classifyScenario(atOddsRatio(60, or), 60)
    );
    expect(classifyScenario(atOddsRatio(10, or), 10)).toBe("below");
  });

  it("maps the documented odds-ratio boundaries", () => {
    expect(classifyScenario(baseline, baseline)).toBe("near");
    // Just inside 1.5x either way.
    expect(classifyScenario(atOddsRatio(baseline, 1.49), baseline)).toBe("near");
    expect(classifyScenario(atOddsRatio(baseline, 1 / 1.49), baseline)).toBe("near");
    // Between 1.5x and 3x.
    expect(classifyScenario(atOddsRatio(baseline, 1.6), baseline)).toBe("above");
    expect(classifyScenario(atOddsRatio(baseline, 2.9), baseline)).toBe("above");
    expect(classifyScenario(atOddsRatio(baseline, 1 / 1.6), baseline)).toBe("below");
    expect(classifyScenario(atOddsRatio(baseline, 1 / 2.9), baseline)).toBe("below");
    // 3x or more.
    expect(classifyScenario(atOddsRatio(baseline, 3.1), baseline)).toBe("far-above");
    expect(classifyScenario(atOddsRatio(baseline, 1 / 3.1), baseline)).toBe("far-below");
  });

  it("does NOT saturate against the 100% ceiling", () => {
    // The flaw a plain probability ratio has: with a 60% baseline the maximum
    // achievable ratio is 1.67, so ~100% could never reach the top bucket.
    expect(100 / 60).toBeLessThan(2);
    expect(classifyScenario(99.9, 60)).toBe("far-above");
    expect(classifyScenario(100, 60)).toBe("far-above");
    expect(classifyScenario(0, 60)).toBe("far-below");
    expect(classifyScenario(99.9, 90)).toBe("far-above");
  });

  it("is symmetric in log-odds about the baseline", () => {
    for (const base of [10, 25, 50, 60, 75]) {
      for (const or of [1.2, 2, 5, 20]) {
        const up = classifyScenario(atOddsRatio(base, or), base);
        const down = classifyScenario(atOddsRatio(base, 1 / or), base);
        expect(up.replace("above", "X")).toBe(down.replace("below", "X"));
      }
    }
  });

  it("is monotone non-decreasing in the scenario value", () => {
    const order: ScenarioBand[] = ["far-below", "below", "near", "above", "far-above"];
    let last = -1;
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const idx = order.indexOf(classifyScenario(pct, baseline));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  it("degrades to near rather than inventing a band from bad inputs", () => {
    expect(classifyScenario(50, 0)).toBe("near");
    expect(classifyScenario(50, -1)).toBe("near");
    expect(classifyScenario(50, 100)).toBe("near");
    expect(classifyScenario(Number.NaN, 60)).toBe("near");
    expect(classifyScenario(50, Number.NaN)).toBe("near");
    expect(classifyScenario(Number.POSITIVE_INFINITY, 60)).toBe("near");
  });

  it("treats a negative scenario value as zero", () => {
    expect(classifyScenario(-10, 60)).toBe("far-below");
  });
});

describe("band presentation is honest by construction", () => {
  it("every label names the baseline, so it cannot read as a standalone claim", () => {
    for (const label of Object.values(BAND_LABEL)) {
      expect(label.toLowerCase()).toContain("baseline");
    }
  });

  it("no label uses forecast-probability language", () => {
    const forbidden = ["likely", "unlikely", "probable", "chance", "odds", "expected", "will"];
    for (const label of Object.values(BAND_LABEL)) {
      for (const word of forbidden) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("tone encodes distance from baseline, not good vs bad", () => {
    // Both tails are extreme. An uncalibrated model must not tell the user that
    // above-baseline is good news.
    expect(BAND_TONE["far-below"]).toBe(BAND_TONE["far-above"]);
    expect(BAND_TONE.below).toBe(BAND_TONE.above);
    expect(BAND_TONE.near).toBe("neutral");
  });
});

describe("the failure disclosure is a single source of truth", () => {
  it("headline states the distinction the audit requires", () => {
    expect(MODEL_FAILURE_HEADLINE.toLowerCase()).toContain("scenario");
    expect(MODEL_FAILURE_HEADLINE.toLowerCase()).toContain("not a forecast");
  });

  it("detail carries the measured evidence, not a vague hedge", () => {
    // Pinned to the EXTERNAL holdout (160 team-seasons, 13 unseen leagues), not
    // the 5 correlated development leagues.
    expect(MODEL_FAILURE_DETAIL).toContain("160 team-seasons");
    expect(MODEL_FAILURE_DETAIL).toContain("13 leagues it had never seen");
    expect(MODEL_FAILURE_DETAIL).toContain("AUC 0.56");
    expect(MODEL_FAILURE_DETAIL).toContain("[0.46, 0.63]");
    expect(MODEL_FAILURE_DETAIL).toContain("Brier skill");
    expect(MODEL_FAILURE_DETAIL).toContain("[-0.26, -0.09]");
  });

  it("does NOT repeat the 'worse than chance' claim the holdout refuted", () => {
    // The development sample showed AUC 0.2546 with a CI entirely below 0.5 and
    // that was reported as a significant inversion. The holdout does not
    // reproduce it (AUC 0.5569, CI [0.4630, 0.6300] straddling 0.5), so the
    // claim must not survive in user-facing copy. Overstating a model's failure
    // is still misstating it.
    expect(MODEL_FAILURE_DETAIL.toLowerCase()).not.toContain("worse than chance");
    expect(MODEL_FAILURE_DETAIL).not.toContain("0.25");
  });

  it("still states the failure that DID replicate", () => {
    // Calibration. Significantly worse than the league's own base rate.
    expect(MODEL_FAILURE_DETAIL).toMatch(/worse than simply using your league's own base rate/);
  });

  it("never claims the model is calibrated, validated, or predictive", () => {
    const banned = [
      "calibrated",
      "validated",
      "predictive edge",
      "expected true probability",
      "production-safe"
    ];
    const text = `${MODEL_FAILURE_HEADLINE} ${MODEL_FAILURE_DETAIL}`.toLowerCase();
    for (const phrase of banned) {
      expect(text).not.toContain(phrase);
    }
  });
});

describe("scenarioReading", () => {
  it("leads with the trustworthy number and keeps the raw value for disclosure", () => {
    const r = scenarioReading(12.4, 10);
    expect(r.baselinePct).toBe(10);
    expect(r.scenarioPct).toBe(12.4);
    // 12.4% against a 10% baseline is a 1.27x odds ratio — inside "near". A
    // model with ECE 0.30 has not earned a 2.4pp call.
    expect(r.band).toBe("near");
    expect(r.label).toBe(BAND_LABEL.near);
  });

  it("a wildly overconfident scenario reads as extreme, not as success", () => {
    // The pre-anchor-fix model predicted ~100% playoff odds for every team.
    const r = scenarioReading(99.9, 60);
    expect(r.band).toBe("far-above");
    expect(r.tone).toBe("extreme");
  });
});
