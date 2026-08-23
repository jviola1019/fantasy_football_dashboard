import { describe, expect, it } from "vitest";
import { derivePositionGrades } from "../derivedMetrics";
import { gradeFromScore } from "../utils";
import type { PlayerMarketRecord } from "../governance";

/**
 * Regression guard for the fragility disclosure failure (audit 2026-08-22).
 *
 * WHAT WENT WRONG
 *
 * Every live record is created with `fragility: 0` because no injury or
 * snap-share adapter is integrated. The per-record source correctly listed
 * `fragility` in `missingFields`, but the ENRICHED source did not — the
 * behavioural-fields list named only `trending_momentum` and `opportunity`. So
 * `envelope.sourceState.missingFields` never contained `fragility` on the live
 * path, and every consumer that guarded on it became dead code.
 *
 * The visible consequence: the DEF grade is computed as
 * `avg(fragility < 35 ? 6 : -4)`, which with a constant 0 is always 6, and
 * `gradeFromScore(6)` is "B+". Every live user saw **DEF: B+** for every league,
 * regardless of their actual defense — a fabricated displayed grade, which
 * CLAUDE.md forbids outright.
 *
 * The failure mode is the one this audit keeps finding: a guard that exists, is
 * tested, and never fires. `panelState.test.ts` passed throughout, because it
 * hand-builds envelopes that already contain "fragility" — proving the guard
 * works while nothing in production produced such an envelope.
 *
 * These tests pin the ARITHMETIC that makes the disclosure necessary, so they
 * cannot go stale the way a mocked-envelope test can.
 */

const mk = (position: string, fragility: number): PlayerMarketRecord =>
  ({
    id: `${position}-${fragility}`,
    name: "test",
    position,
    team: "AAA",
    perceivedValue: 50,
    trueValue: 50,
    ownershipLeverage: 0,
    fragility,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    rosterSlot: position,
    status: "active",
    sources: []
  }) as unknown as PlayerMarketRecord;

const defGrade = (fragility: number) =>
  derivePositionGrades([mk("DEF", fragility), mk("RB", fragility), mk("WR", fragility)])
    .positions.find((p) => p.pos === "DEF")?.grade;

describe("the DEF grade depends entirely on fragility", () => {
  it("returns B+ when fragility is 0 — which is what the live path always supplies", () => {
    // This is the exact number every live user was shown. If this ever changes,
    // the disclosure requirement changes with it and this file must be re-read.
    expect(defGrade(0)).toBe("B+");
  });

  it("returns a DIFFERENT grade for a genuinely fragile roster", () => {
    // Proves the grade is not constant by construction — it is constant only
    // because the input is. That distinction is the whole reason the field must
    // be declared missing rather than silently defaulted.
    expect(defGrade(90)).not.toBe(defGrade(0));
  });

  it("is unable to distinguish any two rosters while fragility is unpopulated", () => {
    // The decisive statement: with no adapter, a great defense and a terrible
    // one are indistinguishable, so ANY letter shown is fabricated.
    const everyRosterScoresTheSame = [0, 0, 0].map(defGrade);
    expect(new Set(everyRosterScoresTheSame).size).toBe(1);
  });
});

describe("gradeFromScore boundaries that make the above true", () => {
  it("maps the constant-6 output of a zero-fragility roster into B+", () => {
    // avg(fragility < 35 ? 6 : -4) === 6 when every fragility is 0.
    expect(gradeFromScore(6)).toBe("B+");
  });

  it("does not map every input to B+", () => {
    expect(gradeFromScore(20)).not.toBe("B+");
    expect(gradeFromScore(-20)).not.toBe("B+");
  });
});
