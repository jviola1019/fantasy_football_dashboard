import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyStartProbability } from "./WeeklyStartProbability";
import { WEEKLY_PROB_MODELS } from "@/lib/models/weeklyProbability";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";

/**
 * The panel that finally puts the calibrated model on a screen.
 *
 * Rendered here rather than only in Playwright because CI runs against an EMPTY
 * database: the e2e suite can prove the disclosure renders, and cannot reach the
 * populated table at all. The unit mismatch these tests guard is invisible to
 * every other check in the repository — a half-PPR projection fed to a
 * PPR-fitted model produces a perfectly plausible number that means nothing.
 */

const player = (
  id: string,
  name: string,
  position: PlayerMarketRecord["position"]
): PlayerMarketRecord =>
  ({ id, name, position, team: "AAA", trueValue: 50, perceivedValue: 50 }) as unknown as PlayerMarketRecord;

const PLAYERS = [
  player("sleeper:1", "Bijan Robinson", "RB"),
  player("sleeper:2", "Josh Allen", "QB"),
  player("sleeper:3", "A Kicker", "K")
];

const envelope = (over: Partial<RAEEnvelope> = {}) =>
  ({ generatedAt: "2026-09-01T12:00:00.000Z", ...over }) as unknown as RAEEnvelope;

const withProjections = envelope({
  weeklyProjections: {
    // Deliberately different in each unit, so a test can tell which one was used.
    "sleeper:1": { ppr: 18, halfPpr: 15, standard: 12, position: "RB" },
    "sleeper:2": { ppr: 22, halfPpr: 22, standard: 22, position: "QB" },
    "sleeper:3": { ppr: 9, halfPpr: 9, standard: 9, position: "K" }
  },
  weeklyProjectionsMeta: { season: "2026", week: 3, fetchedAt: "2026-09-01T09:15:00.000Z" }
} as Partial<RAEEnvelope>);

describe("the probability is computed from the PPR projection, whatever the league scores", () => {
  const html = renderToStaticMarkup(
    <WeeklyStartProbability players={PLAYERS} envelope={withProjections} />
  );

  it("shows the PPR figure and labels the column as PPR", () => {
    expect(html).toContain("Projected pts (PPR)");
    expect(html).toContain("18.0");
    // 15.0 is the half-PPR value; using it would be the audit §7 unit mismatch.
    expect(html).not.toContain("15.0");
  });

  it("computes the probability the PPR projection implies, not another unit's", () => {
    // RB at 18 PPR points against a 10-point line: sigmoid(-2.7034 + 0.22522*18).
    const m = WEEKLY_PROB_MODELS.RB;
    const expected = Math.round((1 / (1 + Math.exp(-(m.intercept + m.coefficient * 18)))) * 100);
    expect(html).toContain(`${expected}%`);
    // What it would have said from the half-PPR number, which must NOT appear.
    const wrong = Math.round((1 / (1 + Math.exp(-(m.intercept + m.coefficient * 15)))) * 100);
    expect(wrong).not.toBe(expected);
    expect(html).not.toContain(`<b>${wrong}%</b>`);
  });

  it("says why the unit is PPR rather than leaving it to be discovered", () => {
    expect(html).toContain("that is the unit this model was fitted in");
  });

  it("shows each position's own start line", () => {
    expect(html).toContain("Start line");
  });

  it("omits a position that was never fitted rather than inventing a curve", () => {
    // The kicker has a projection and must still get no probability.
    expect(html).not.toContain("A Kicker");
  });
});

describe("QB is marked as the weaker case, in the table and in its disclosure", () => {
  const html = renderToStaticMarkup(
    <WeeklyStartProbability players={PLAYERS} envelope={withProjections} />
  );

  it("flags the low-skill position inline, where the number is read", () => {
    // Risk R5: a reader scanning the table must not take QB as equal to RB.
    expect(html).toContain("low skill at this position");
  });

  it("prints QB's own measured skill, not a generic warning", () => {
    expect(html).toContain(`${(WEEKLY_PROB_MODELS.QB.brierSkillScore * 100).toFixed(1)}% Brier skill`);
  });
});

describe("the disclosure does not depend on this week's data", () => {
  const empty = renderToStaticMarkup(<WeeklyStartProbability players={PLAYERS} envelope={envelope()} />);

  it("still renders every position's calibration when no projections exist", () => {
    // The model is frozen; its measured calibration is as true in June as in
    // October. Hiding it whenever the input is missing would mean the evidence
    // appeared only when the panel happened to have something else to say.
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      expect(empty).toContain(`P(${pos} clears ${WEEKLY_PROB_MODELS[pos].threshold} PPR points)`);
    }
  });

  it("says what is missing, and that it is the INPUT rather than the model", () => {
    expect(empty).toContain("No weekly projection to convert");
    expect(empty).toContain("does not produce the projection");
  });

  it("prints the measured calibration error and Brier skill beside the claim", () => {
    // This is what earns the word "calibrated" past the wording ban in
    // e2e/20-model-failure-disclosure.spec.ts. If either number stops rendering,
    // the phrase must stop with it.
    expect(empty).toContain("calibrated probability");
    expect(empty).toMatch(/[0-9.]+% calibration error/);
    expect(empty).toMatch(/[0-9.]+% Brier skill/);
  });

  it("names the evidence file and the input fingerprint", () => {
    expect(empty).toContain("docs/brier-results.md");
    expect(empty).toContain("bba1d103");
  });

  it("plots the reliability diagram the numbers came from", () => {
    expect(empty).toContain("<figcaption");
    expect(empty).toContain("Reliability diagram over");
  });
});
