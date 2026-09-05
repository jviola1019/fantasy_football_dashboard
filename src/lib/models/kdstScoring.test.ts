import { describe, expect, it } from "vitest";
import {
  POINTS_ALLOWED_BANDS,
  defencePoints,
  kickerPoints,
  pointsAllowedScore,
  type DefenceWeek,
  type KickerWeek
} from "./kdstScoring";

const kicker = (over: Partial<KickerWeek> = {}): KickerWeek => ({
  fgMade0_19: 0,
  fgMade20_29: 0,
  fgMade30_39: 0,
  fgMade40_49: 0,
  fgMade50_59: 0,
  fgMade60plus: 0,
  fgMissed: 0,
  patMade: 0,
  patMissed: 0,
  ...over
});

const defence = (over: Partial<DefenceWeek> = {}): DefenceWeek => ({
  sacks: 0,
  interceptions: 0,
  fumbleRecoveries: 0,
  safeties: 0,
  defensiveTds: 0,
  specialTeamsTds: 0,
  blockedKicks: 0,
  pointsAllowed: 24,
  ...over
});

describe("kickerPoints", () => {
  it("pays 3 for anything under 40 yards", () => {
    expect(kickerPoints(kicker({ fgMade0_19: 1 }))).toBe(3);
    expect(kickerPoints(kicker({ fgMade20_29: 1 }))).toBe(3);
    expect(kickerPoints(kicker({ fgMade30_39: 1 }))).toBe(3);
  });

  it("pays 4 for 40–49 and 5 for anything 50 or longer", () => {
    expect(kickerPoints(kicker({ fgMade40_49: 1 }))).toBe(4);
    expect(kickerPoints(kicker({ fgMade50_59: 1 }))).toBe(5);
    // Documented choice: Sleeper's default has one 50+ bucket, so a 60-yarder
    // is 5 rather than 6. A league paying 6 is a variant, not the default.
    expect(kickerPoints(kicker({ fgMade60plus: 1 }))).toBe(5);
  });

  it("subtracts for misses, on both kick types", () => {
    expect(kickerPoints(kicker({ fgMissed: 2 }))).toBe(-2);
    expect(kickerPoints(kicker({ patMade: 3, patMissed: 1 }))).toBe(2);
  });

  it("adds a real kicker's week correctly", () => {
    // Matt Prater, 2023 week 1: makes from 28, 54 and 37, three PATs, no misses.
    // 3 + 5 + 3 + 3 = 14.
    expect(
      kickerPoints(kicker({ fgMade20_29: 1, fgMade30_39: 1, fgMade50_59: 1, patMade: 3 }))
    ).toBe(14);
  });

  it("is zero for a kicker who did not attempt anything", () => {
    expect(kickerPoints(kicker())).toBe(0);
  });
});

describe("pointsAllowedScore", () => {
  it("scores a shutout at 10", () => {
    expect(pointsAllowedScore(0)).toBe(10);
  });

  it("is correct at EVERY band boundary, on both sides", () => {
    // The part most likely to be wrong quietly: an off-by-one moves a week by 3
    // points and still looks reasonable. Every inclusive edge and the value one
    // past it.
    const edges: Array<[number, number]> = [
      [0, 10],
      [1, 7],
      [6, 7],
      [7, 4],
      [13, 4],
      [14, 1],
      [20, 1],
      [21, 0],
      [27, 0],
      [28, -1],
      [34, -1],
      [35, -4],
      [70, -4]
    ];
    for (const [allowed, expected] of edges) {
      expect(pointsAllowedScore(allowed), `${allowed} allowed`).toBe(expected);
    }
  });

  it("is monotone non-increasing in points allowed", () => {
    // Conceding more can never be worth more. A reordered band table would
    // break this and nothing else would notice.
    let prev = Number.POSITIVE_INFINITY;
    for (let allowed = 0; allowed <= 80; allowed += 1) {
      const s = pointsAllowedScore(allowed);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it("has an unbounded final band, so no score is unscoreable", () => {
    expect(POINTS_ALLOWED_BANDS[POINTS_ALLOWED_BANDS.length - 1]!.maxAllowed).toBe(
      Number.POSITIVE_INFINITY
    );
    expect(() => pointsAllowedScore(1000)).not.toThrow();
  });

  it("keeps the band table sorted, which the lookup depends on", () => {
    for (let i = 1; i < POINTS_ALLOWED_BANDS.length; i += 1) {
      expect(POINTS_ALLOWED_BANDS[i]!.maxAllowed).toBeGreaterThan(
        POINTS_ALLOWED_BANDS[i - 1]!.maxAllowed
      );
    }
  });
});

describe("defencePoints", () => {
  it("counts each event type at its own rate", () => {
    const base = pointsAllowedScore(24);
    expect(defencePoints(defence({ sacks: 3 }))).toBe(base + 3);
    expect(defencePoints(defence({ interceptions: 2 }))).toBe(base + 4);
    expect(defencePoints(defence({ fumbleRecoveries: 1 }))).toBe(base + 2);
    expect(defencePoints(defence({ safeties: 1 }))).toBe(base + 2);
    expect(defencePoints(defence({ blockedKicks: 1 }))).toBe(base + 2);
  });

  it("credits a special-teams touchdown to the DEFENCE, at 6", () => {
    // Sleeper puts a punt-return score in the DST slot. Omitting it would
    // understate a defence by a full touchdown in the weeks that decide a
    // matchup.
    const base = pointsAllowedScore(24);
    expect(defencePoints(defence({ specialTeamsTds: 1 }))).toBe(base + 6);
    expect(defencePoints(defence({ defensiveTds: 1 }))).toBe(base + 6);
    expect(defencePoints(defence({ defensiveTds: 1, specialTeamsTds: 1 }))).toBe(base + 12);
  });

  it("adds a full realistic week", () => {
    // 4 sacks, 2 INTs, a fumble recovery, a pick-six, 10 points allowed:
    // 4 + 4 + 2 + 6 + 4 = 20.
    expect(
      defencePoints(
        defence({ sacks: 4, interceptions: 2, fumbleRecoveries: 1, defensiveTds: 1, pointsAllowed: 10 })
      )
    ).toBe(20);
  });

  it("can go negative on a blowout with no takeaways", () => {
    // The case that proves points allowed really dominates the score.
    expect(defencePoints(defence({ pointsAllowed: 45 }))).toBe(-4);
    expect(defencePoints(defence({ sacks: 1, pointsAllowed: 45 }))).toBe(-3);
  });

  it("gives a shutout with no other production a real score", () => {
    expect(defencePoints(defence({ pointsAllowed: 0 }))).toBe(10);
  });
});
