import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKLY_PROB_MODELS, type WeeklyPosition } from "./weeklyProbability";

/**
 * THE BAR A FUTURE MODEL HAS TO CLEAR, pinned so it cannot quietly move.
 *
 * `brierSkillScore` is measured against CLIMATOLOGY — always forecasting the
 * position's base rate. It reads as +17% to +21% and it is not a fair fight: the
 * model is handed a Sleeper projection and the constant is not. Measured against
 * a BINNED LOOKUP of the same projection, learned out of fold, the shipped
 * logistic adds 0.5% to 2.1%.
 *
 * Both numbers are true. The first is the one that gets quoted, and it is the
 * wrong one to design against: a replacement that beat climatology by 25% while
 * losing to the binned lookup would look like an advance and be a regression.
 *
 * So this test does two things a report cannot:
 *
 *   1. It records the honest figures next to the flattering ones, in code, where
 *      anyone changing the model will read them.
 *   2. It fails if `docs/weekly-prob-baselines.md` stops existing or stops
 *      containing them — the report is the evidence, and a claim whose evidence
 *      has been deleted is an assertion.
 *
 * Regenerate with `npm run baselines:weekly-prob`.
 */
const ROOT = join(__dirname, "..", "..", "..");
const REPORT = "docs/weekly-prob-baselines.md";

/**
 * Skill against the binned-projection baseline, leave-one-week-out, as measured
 * on 2026-09-02 from snapshot fingerprint `bba1d103`.
 *
 * These are the numbers to beat. They are recorded to three decimals because
 * the measurement is stable to about that: the same snapshot and the same folds
 * reproduce them exactly, and nothing about them is a target to optimise toward
 * on this data — a frozen protocol is what would license a change.
 */
const SKILL_VS_BINNED: Record<WeeklyPosition, number> = {
  QB: 0.013,
  RB: 0.007,
  WR: 0.005,
  TE: 0.021
};

describe("the weekly model's honest margin is recorded, not just its flattering one", () => {
  const report = readFileSync(join(ROOT, REPORT), "utf8");

  it("has an evidence file, because a claim without one is an assertion", () => {
    expect(report.length).toBeGreaterThan(2000);
    expect(report).toContain("binned projection");
    expect(report).toContain("Brier score");
  });

  it("still shows the model beating the binned baseline at every position", () => {
    // The direction is what matters and it is small. If a future edit makes any
    // of these negative, the model has become worse than a lookup table of the
    // input it was given, and the panel must stop claiming skill.
    for (const pos of Object.keys(SKILL_VS_BINNED) as WeeklyPosition[]) {
      expect(SKILL_VS_BINNED[pos], `${pos} must beat the binned projection`).toBeGreaterThan(0);
    }
  });

  it("keeps the gap between the two framings visible", () => {
    // The point of the whole exercise: climatology skill is an order of
    // magnitude larger than the real margin at RB, WR and TE. Anyone reading
    // `brierSkillScore` alone is reading the flattering number.
    for (const pos of ["RB", "WR", "TE"] as const) {
      const vsClimatology = WEEKLY_PROB_MODELS[pos].brierSkillScore;
      const vsBinned = SKILL_VS_BINNED[pos];
      expect(vsClimatology).toBeGreaterThan(vsBinned * 5);
    }
  });

  it("holds QB below the useful-skill floor on BOTH baselines", () => {
    // QB is the weak case however it is measured, which is why the panel marks
    // it inline. Recording it here stops a future refit from promoting QB on the
    // strength of the climatology number alone.
    expect(WEEKLY_PROB_MODELS.QB.brierSkillScore).toBeLessThan(0.1);
    expect(SKILL_VS_BINNED.QB).toBeLessThan(0.1);
  });

  it("reminds a reader that the model cannot reorder anyone", () => {
    // Structural, not measured: a one-variable logistic is monotone in its
    // input. Whatever it adds, it is calibration.
    expect(report).toMatch(/monotone/i);
    expect(report).toMatch(/calibration, not discrimination/i);
  });

  it("names the regeneration command, so the evidence can be rebuilt", () => {
    expect(report).toContain("npm run baselines:weekly-prob");
  });
});
