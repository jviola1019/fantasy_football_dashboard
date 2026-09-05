/**
 * Kicker and team-defence fantasy scoring, Sleeper default PPR.
 *
 * WHY THIS IS A LIBRARY MODULE AND NOT A HELPER INSIDE A SCRIPT.
 *
 * It is the OUTCOME definition for two models. Every Brier score, every base
 * rate and every threshold derived for kickers and defences is a function of
 * these constants, so an error here does not produce an obviously broken number
 * — it produces a plausible one, measured to four decimal places, about the
 * wrong question. This repository has already extracted `csv.ts` and
 * `correlation.ts` after exactly that shape of mistake, and scoring rules are a
 * worse thing to leave in a script than either.
 *
 * SLEEPER DEFAULT, stated explicitly because "standard scoring" is not a single
 * thing and the choice changes the answer:
 *
 *   KICKER    FG 0–39 → 3, 40–49 → 4, 50+ → 5, missed FG → −1,
 *             PAT made → 1, PAT missed → −1
 *   DEFENCE   sack → 1, interception → 2, fumble recovery → 2, safety → 2,
 *             defensive or return TD → 6, blocked kick → 2,
 *             plus a points-allowed band
 *
 * TWO DELIBERATE CHOICES WORTH ARGUING WITH.
 *
 * 1. A 60+ yard field goal scores 5, not 6. Sleeper's default has a single
 *    `fgm_50p` bucket; leagues that pay 6 for 60-yarders are a variant. Using 5
 *    keeps this matched to the platform the rest of the product reads from, and
 *    the affected rows are a handful per season.
 * 2. Special-teams touchdowns are credited to the DEFENCE, which is what Sleeper
 *    does — a punt return score belongs to the DST slot, not to the returner's
 *    own position. Omitting them would understate defences by a full touchdown
 *    in exactly the weeks that decide a matchup.
 *
 * The points-allowed bands are the part most likely to be got wrong quietly,
 * because an off-by-one at a boundary moves a whole week's score by 3 points and
 * still looks reasonable. They are therefore expressed as an explicit ordered
 * table and tested at every boundary.
 */

export interface KickerWeek {
  fgMade0_19: number;
  fgMade20_29: number;
  fgMade30_39: number;
  fgMade40_49: number;
  fgMade50_59: number;
  fgMade60plus: number;
  fgMissed: number;
  patMade: number;
  patMissed: number;
}

export interface DefenceWeek {
  sacks: number;
  interceptions: number;
  fumbleRecoveries: number;
  safeties: number;
  defensiveTds: number;
  specialTeamsTds: number;
  blockedKicks: number;
  pointsAllowed: number;
}

/** FG points by distance band, Sleeper default. */
export const KICKER_POINTS = {
  fgUnder40: 3,
  fg40to49: 4,
  fg50plus: 5,
  fgMissed: -1,
  patMade: 1,
  patMissed: -1
} as const;

export const DEFENCE_POINTS = {
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  safety: 2,
  touchdown: 6,
  blockedKick: 2
} as const;

/**
 * Points-allowed bands, ordered from fewest points allowed to most.
 *
 * `maxAllowed` is INCLUSIVE. Written as a table rather than a chain of `if`s so
 * every boundary is visible in one place — an off-by-one here shifts a week's
 * defensive score by 3 points and produces a number nobody would query.
 */
export const POINTS_ALLOWED_BANDS: ReadonlyArray<{ maxAllowed: number; points: number }> = [
  { maxAllowed: 0, points: 10 },
  { maxAllowed: 6, points: 7 },
  { maxAllowed: 13, points: 4 },
  { maxAllowed: 20, points: 1 },
  { maxAllowed: 27, points: 0 },
  { maxAllowed: 34, points: -1 },
  { maxAllowed: Number.POSITIVE_INFINITY, points: -4 }
];

export function pointsAllowedScore(pointsAllowed: number): number {
  for (const band of POINTS_ALLOWED_BANDS) {
    if (pointsAllowed <= band.maxAllowed) return band.points;
  }
  // Unreachable: the last band is unbounded. Present so a future edit that
  // removes the infinity bound fails loudly rather than returning undefined.
  throw new Error(`pointsAllowedScore: no band covers ${pointsAllowed}`);
}

export function kickerPoints(w: KickerWeek): number {
  const under40 = w.fgMade0_19 + w.fgMade20_29 + w.fgMade30_39;
  const fifty = w.fgMade50_59 + w.fgMade60plus;
  return (
    under40 * KICKER_POINTS.fgUnder40 +
    w.fgMade40_49 * KICKER_POINTS.fg40to49 +
    fifty * KICKER_POINTS.fg50plus +
    w.fgMissed * KICKER_POINTS.fgMissed +
    w.patMade * KICKER_POINTS.patMade +
    w.patMissed * KICKER_POINTS.patMissed
  );
}

export function defencePoints(w: DefenceWeek): number {
  return (
    w.sacks * DEFENCE_POINTS.sack +
    w.interceptions * DEFENCE_POINTS.interception +
    w.fumbleRecoveries * DEFENCE_POINTS.fumbleRecovery +
    w.safeties * DEFENCE_POINTS.safety +
    (w.defensiveTds + w.specialTeamsTds) * DEFENCE_POINTS.touchdown +
    w.blockedKicks * DEFENCE_POINTS.blockedKick +
    pointsAllowedScore(w.pointsAllowed)
  );
}
