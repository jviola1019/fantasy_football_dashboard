import type { ScoringFormat } from "../trade/format";

/** The three scoring variants Sleeper projections carry for each player-week. */
export interface ProjectionPoints {
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
}

/**
 * Pick the projection points field that matches the league's scoring format
 * (PPR / Half-PPR / Standard), falling back to PPR when the specific field is
 * absent (e.g. some kicker rows only carry pts_std). Returns null when no
 * usable value exists. Keeps the weekly-projection feed honest for non-PPR
 * leagues instead of always reading pts_ppr.
 */
export function pickProjectionPoints(p: ProjectionPoints, scoring: ScoringFormat): number | null {
  if (scoring === "HALF") return p.pts_half_ppr ?? p.pts_ppr;
  if (scoring === "STD") return p.pts_std ?? p.pts_ppr;
  return p.pts_ppr;
}
