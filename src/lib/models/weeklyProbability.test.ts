import { describe, expect, it } from "vitest";
import {
  WEEKLY_PROB_MODELS,
  WEEKLY_PROB_PROVENANCE,
  USEFUL_SKILL_FLOOR,
  hasUsefulSkill,
  weeklyProbDisclosure,
  weeklyStartProbability,
  formatWeeklyProb,
  type WeeklyPosition
} from "./weeklyProbability";

/**
 * The frozen weekly start/sit model.
 *
 * `scripts/verify-weekly-prob.ts` proves the constants REPRODUCE from the
 * committed snapshot — that is the statistical check, and it needs the 36 MB of
 * data, so it runs as its own gate rather than in the unit suite. What is tested
 * here is everything a reader of the number depends on that refitting cannot
 * show: that the model is ordered and bounded, that absence is reported as
 * absence rather than as a coin flip, and that the disclosure states the limits
 * a reader would otherwise have to guess at.
 */

const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];

describe("the shipped constants are internally coherent", () => {
  it.each(POSITIONS)("%s has a positive coefficient, so more points never means less probability", (pos) => {
    expect(WEEKLY_PROB_MODELS[pos].coefficient).toBeGreaterThan(0);
  });

  it.each(POSITIONS)("%s reports an out-of-fold Brier better than its own climatology", (pos) => {
    const m = WEEKLY_PROB_MODELS[pos];
    expect(m.oofBrier).toBeLessThan(m.climatology);
    expect(m.brierSkillScore).toBeGreaterThan(0);
  });

  it.each(POSITIONS)("%s's skill score is consistent with its Brier and climatology", (pos) => {
    // Guards a hand-edit of one number without the others: the three are not
    // independent, and a typo in any of them shows up here.
    const m = WEEKLY_PROB_MODELS[pos];
    expect(m.brierSkillScore).toBeCloseTo(1 - m.oofBrier / m.climatology, 10);
  });

  it.each(POSITIONS)("%s's climatology equals p(1-p) for its own base rate", (pos) => {
    // The Brier of always forecasting the base rate IS the base-rate variance.
    // If these disagree, the reported climatology is not the bar it claims.
    const m = WEEKLY_PROB_MODELS[pos];
    expect(m.climatology).toBeCloseTo(m.baseRate * (1 - m.baseRate), 6);
  });

  it.each(POSITIONS)("%s's reliability bins account for every row it was scored on", (pos) => {
    const m = WEEKLY_PROB_MODELS[pos];
    expect(m.reliabilityBins.reduce((s, b) => s + b.n, 0)).toBe(m.n);
  });

  it("carries provenance naming the snapshot, its fingerprint and the published results", () => {
    expect(WEEKLY_PROB_PROVENANCE.fingerprint).toBe("bba1d103");
    expect(WEEKLY_PROB_PROVENANCE.snapshot).toContain("brier-prospective");
    expect(WEEKLY_PROB_PROVENANCE.results).toBe("docs/brier-results.md");
  });

  it("was fitted on the number of rows it says it was", () => {
    const total = POSITIONS.reduce((s, p) => s + WEEKLY_PROB_MODELS[p].n, 0);
    expect(total).toBe(WEEKLY_PROB_PROVENANCE.totalRows);
  });
});

describe("weeklyStartProbability", () => {
  it.each(POSITIONS)("%s increases monotonically in the projection", (pos) => {
    const probs = [0, 5, 10, 20, 40].map((p) => weeklyStartProbability(pos, p)!);
    for (let i = 1; i < probs.length; i += 1) {
      expect(probs[i]!).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it.each(POSITIONS)("%s stays strictly inside (0, 1) across the realistic range", (pos) => {
    // 0-60 PPR points spans everything the 2025 season actually produced.
    for (let p = 0; p <= 60; p += 5) {
      const v = weeklyStartProbability(pos, p)!;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("saturates to exactly 1 at an absurd projection, which is why the FORMATTER caps", () => {
    // Documented rather than clamped. `sigmoid` reaching 1 in float64 is correct
    // arithmetic; clamping the model would corrupt a calibrated probability to
    // fix a presentation problem. `formatWeeklyProb` is where the cap belongs.
    expect(weeklyStartProbability("RB", 1e6)).toBe(1);
  });

  it("puts a player projected exactly at the threshold well under 50%", () => {
    // A real and slightly counter-intuitive property of the fit, worth pinning:
    // a projection is a central estimate and weekly scoring is right-skewed, so
    // hitting your projection exactly leaves you short of the line more often
    // than not. If this ever reads ~50% the fit has been replaced by something
    // that just re-expresses the threshold.
    for (const pos of POSITIONS) {
      const at = weeklyStartProbability(pos, WEEKLY_PROB_MODELS[pos].threshold)!;
      expect(at).toBeGreaterThan(0.3);
      expect(at).toBeLessThan(0.45);
    }
  });

  it("returns null for a position that was never fitted, rather than a guess", () => {
    // K and DEF have no evidence behind them. A curve invented for them would be
    // fabrication, and 0.5 would be a fabrication that looks like modesty.
    expect(weeklyStartProbability("K", 12)).toBeNull();
    expect(weeklyStartProbability("DEF", 12)).toBeNull();
    expect(weeklyStartProbability("", 12)).toBeNull();
  });

  it("returns null for a missing or unusable projection", () => {
    expect(weeklyStartProbability("RB", null)).toBeNull();
    expect(weeklyStartProbability("RB", undefined)).toBeNull();
    expect(weeklyStartProbability("RB", Number.NaN)).toBeNull();
    expect(weeklyStartProbability("RB", Number.POSITIVE_INFINITY)).toBeNull();
    // A negative projection is not a forecast the fit ever saw.
    expect(weeklyStartProbability("RB", -1)).toBeNull();
  });

  it("accepts a zero projection, which is a real forecast", () => {
    expect(weeklyStartProbability("RB", 0)).toBeGreaterThan(0);
  });
});

describe("the QB caveat is enforced, not left to the caller", () => {
  it("classifies QB as below the useful-skill floor and the rest above it", () => {
    // Risk R5. QB's measured skill is +3.7% against RB/WR/TE's +21.2/+18.5/+17.6.
    // Presenting them side by side without this distinction implies an
    // equivalence the data does not support.
    expect(hasUsefulSkill("QB")).toBe(false);
    expect(hasUsefulSkill("RB")).toBe(true);
    expect(hasUsefulSkill("WR")).toBe(true);
    expect(hasUsefulSkill("TE")).toBe(true);
  });

  it("keeps the floor clear of every position, so none sits on the line", () => {
    // A threshold a position is within a whisker of is a threshold that will
    // flip on noise. QB is well below and the others are well above.
    expect(WEEKLY_PROB_MODELS.QB.brierSkillScore).toBeLessThan(USEFUL_SKILL_FLOOR - 0.05);
    for (const pos of ["RB", "WR", "TE"] as const) {
      expect(WEEKLY_PROB_MODELS[pos].brierSkillScore).toBeGreaterThan(USEFUL_SKILL_FLOOR + 0.05);
    }
  });
});

describe("the disclosure states the limits rather than gesturing at them", () => {
  it.each(POSITIONS)("%s names its sample size, Brier, calibration error and skill", (pos) => {
    const d = weeklyProbDisclosure(pos);
    const m = WEEKLY_PROB_MODELS[pos];
    const joined = d.limits.join(" ");
    expect(joined).toContain(String(m.n));
    expect(joined).toContain(m.oofBrier.toFixed(4));
    expect(joined).toContain(`${(m.oofEce * 100).toFixed(1)}%`);
    expect(joined).toContain(`${(m.brierSkillScore * 100).toFixed(1)}%`);
  });

  it.each(POSITIONS)("%s says what the model is NOT", (pos) => {
    const joined = weeklyProbDisclosure(pos).limits.join(" ");
    expect(joined).toContain("does not produce the projection");
    expect(joined).toContain("one season");
  });

  it("adds an explicit warning for QB, and only for QB", () => {
    expect(weeklyProbDisclosure("QB").limits.join(" ")).toContain("should carry little weight");
    for (const pos of ["RB", "WR", "TE"] as const) {
      expect(weeklyProbDisclosure(pos).limits.join(" ")).not.toContain("should carry little weight");
    }
  });

  it("points at the evidence by file and by fingerprint", () => {
    const d = weeklyProbDisclosure("RB");
    expect(d.evidence).toContain("docs/brier-results.md");
    expect(d.evidence).toContain("bba1d103");
  });

  it("headlines the actual question the number answers", () => {
    expect(weeklyProbDisclosure("RB").headline).toBe("P(RB clears 10 PPR points)");
  });
});

describe("formatWeeklyProb never claims certainty", () => {
  it("caps a saturated probability rather than printing 100%", () => {
    expect(formatWeeklyProb(1)).toBe(">99%");
    expect(formatWeeklyProb(0.999)).toBe(">99%");
    expect(formatWeeklyProb(0.9951)).toBe(">99%");
  });

  it("floors an impossible-looking one rather than printing 0%", () => {
    expect(formatWeeklyProb(0)).toBe("<1%");
    expect(formatWeeklyProb(0.004)).toBe("<1%");
  });

  it("rounds normally in between", () => {
    expect(formatWeeklyProb(0.371)).toBe("37%");
    expect(formatWeeklyProb(0.5)).toBe("50%");
    expect(formatWeeklyProb(0.985)).toBe("99%");
  });

  it("never emits 0% or 100% for any probability at all", () => {
    for (let i = 0; i <= 1000; i += 1) {
      const out = formatWeeklyProb(i / 1000);
      expect(out).not.toBe("0%");
      expect(out).not.toBe("100%");
    }
  });
});
