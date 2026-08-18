import type { LeagueFormat, LeagueStarters } from "../trade/format";

/**
 * ONE definition of how a league's lineup slots translate into positional
 * demand. Everything that needs to know how many RBs a league wants reads it
 * from here.
 *
 * Why this module exists. The flex-weight table lived as a literal in TWO
 * places — `draft/rosterTargets.ts` and `fantasypros/enrich.ts` — and the copy
 * in enrich.ts carried the comment "using the same weighting as the draft
 * targets so the two models cannot disagree". They were a copy, so of course
 * they could, and by the time this was written they already did: rosterTargets
 * hardcoded `targets.QB += s.SUPERFLEX` (occupancy 1.0) while enrich had been
 * given an injectable `superflexQbOccupancy`. The draft board and the valuation
 * model were answering the same question differently.
 *
 * A comment asserting that two copies agree is not a mechanism. This is.
 */

export type DemandPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export const DEMAND_POSITIONS: readonly DemandPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * The two free parameters of the demand model, named so they can be swept
 * rather than trusted. Neither is fitted to an observed outcome; both are
 * MODEL ASSUMPTIONS whose influence is measured in
 * reports/2026-08-06/replacement-sensitivity.md.
 */
export interface ReplacementModel {
  /**
   * How far past the last forced starter replacement sits. Managers stream from
   * waivers, so practical replacement is slightly deeper than the last player a
   * lineup compels you to field. A judgement about behaviour, not a fitted value.
   */
  depthCushion: number;
  /**
   * Probability a SUPERFLEX slot is filled by a quarterback. 1.0 says "always",
   * which is directionally right in most superflex leagues but cannot be
   * universally true — a manager short at QB starts a flex body instead.
   */
  superflexQbOccupancy: number;
}

export const DEFAULT_REPLACEMENT_MODEL: ReplacementModel = {
  depthCushion: 1.2,
  superflexQbOccupancy: 1.0
};

/**
 * Relative claim on a FLEX slot.
 *
 * RB and WR split it, with PPR nudging the odd slot to WR because receptions
 * raise a receiver's floor. TE only competes when the league already starts two
 * or more, which signals a TE-premium build rather than an ordinary lineup that
 * happens to allow a TE in the flex.
 */
export function flexWeights(format: LeagueFormat): Partial<Record<DemandPosition, number>> {
  const wr = format.ppr > 0 ? 5 : 4;
  return format.starters.TE >= 2 ? { RB: 4, WR: wr, TE: 2 } : { RB: 4, WR: wr };
}

/**
 * FRACTIONAL per-team demand at each position: forced starters plus a share of
 * the flex and superflex slots.
 *
 * Fractional on purpose — replacement level is a depth measure, and rounding
 * each position before multiplying by team count throws away real signal.
 * `rosterTargets` rounds afterwards, because a draft plan has to be whole
 * players.
 *
 * A SUPERFLEX slot not filled by a quarterback is filled by a flex body, so the
 * leftover `1 - occupancy` is redistributed onto the flex weights rather than
 * vanishing. Without that, lowering the coefficient would quietly shrink the
 * league's total startable demand instead of moving it between positions.
 */
export function perTeamDemand(
  format: LeagueFormat,
  model: ReplacementModel = DEFAULT_REPLACEMENT_MODEL
): Record<DemandPosition, number> {
  const s: LeagueStarters = format.starters;
  const weights = flexWeights(format);
  const weightSum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);

  const sflexToQb = s.SUPERFLEX * model.superflexQbOccupancy;
  const sflexToFlex = s.SUPERFLEX - sflexToQb;
  const spillover = s.FLEX + sflexToFlex;
  const share = (pos: DemandPosition): number =>
    weightSum > 0 && weights[pos] ? (spillover * weights[pos]!) / weightSum : 0;

  return {
    QB: s.QB + sflexToQb,
    RB: s.RB + share("RB"),
    WR: s.WR + share("WR"),
    TE: s.TE + share("TE"),
    K: s.K,
    DEF: s.DEF
  };
}

/** Total starting-lineup slots — the size of a team's weekly lineup. */
export function startingSlotCount(format: LeagueFormat): number {
  const s = format.starters;
  return s.QB + s.RB + s.WR + s.TE + s.FLEX + s.SUPERFLEX + s.K + s.DEF;
}

/**
 * Largest-remainder allocation of `total` whole units across weighted
 * positions. Deterministic: ties break on position name so a draft plan does
 * not shuffle between runs.
 */
export function allocateWhole(
  total: number,
  weights: Partial<Record<DemandPosition, number>>
): Record<DemandPosition, number> {
  const out = Object.fromEntries(DEMAND_POSITIONS.map((p) => [p, 0])) as Record<
    DemandPosition,
    number
  >;
  const sum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  if (total <= 0 || sum <= 0) return out;

  let assigned = 0;
  const remainders: Array<[DemandPosition, number]> = [];
  for (const [pos, w] of Object.entries(weights) as Array<[DemandPosition, number]>) {
    const exact = (total * w) / sum;
    const floor = Math.floor(exact);
    out[pos] = floor;
    assigned += floor;
    remainders.push([pos, exact - floor]);
  }
  remainders.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (let i = 0; assigned < total && i < remainders.length; i += 1, assigned += 1) {
    out[remainders[i]![0]] += 1;
  }
  return out;
}

/**
 * The trueValue of the AVERAGE STARTABLE player — not of a replacement player.
 *
 * `trueValue = 50` means REPLACEMENT LEVEL, and the season simulation used to
 * map it onto an average *starter's* points. Replacement is by definition worse
 * than an average starter, so every real roster floated above its own opponent
 * field: measured on five completed leagues, every team averaged 164 weekly
 * points against a 115 field, and all 50 team-seasons predicted ~100% playoff
 * odds. See reports/2026-08-06/backtest-valuation.md.
 *
 * The derivation is closed-form and, pleasingly, free of league size and
 * position. Startable players at a position occupy ranks 1..S where
 * S = numTeams x perTeamDemand, and replacement sits at R = S x cushion, so the
 * mean trueValue over those ranks is
 *
 *   50 + 50 * (R - (S+1)/2) / R  =  50 + 50 * (1 - 1/(2c) - 1/(2R))
 *
 * and since S and R scale together the 1/(2c) term dominates: the answer
 * depends only on the depth cushion. At c = 1.2 that is 79.2.
 *
 * DERIVED from the replacement model, never fitted to the backtest — which is
 * what keeps the backtest an honest holdout. The residual -1/(2R) term is worth
 * at most about 2 trueValue points at the shallowest position and is dropped so
 * the anchor stays one self-consistent constant.
 */
export function averageStartableTrueValue(
  model: ReplacementModel = DEFAULT_REPLACEMENT_MODEL
): number {
  return 50 + 50 * (1 - 1 / (2 * model.depthCushion));
}

/**
 * How deep a league actually has to dig at a position before the next player is
 * effectively free — the denominator of positional VBD.
 *
 * Lives here rather than in `fantasypros/enrich.ts` because it is a pure
 * function of lineup demand, and because `models/pointsCurve.ts` needs it too.
 * Keeping it beside `perTeamDemand` is what stops a second copy of the formula
 * appearing, which is the failure this module was created to end.
 *
 * K and DEF get no cushion: they are fully fungible, so the last starter IS
 * replacement.
 */
export function positionReplacementRank(
  position: DemandPosition,
  format: LeagueFormat,
  model: ReplacementModel = DEFAULT_REPLACEMENT_MODEL
): number {
  const perTeam = perTeamDemand(format, model);
  const cushion = position === "K" || position === "DEF" ? 1 : model.depthCushion;
  return Math.max(1, Math.round(format.numTeams * perTeam[position] * cushion));
}
