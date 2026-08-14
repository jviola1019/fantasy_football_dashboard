// The single authoritative resolver for "what NFL season/week is it right now".
//
// Why this exists (audit 2026-08-06 F-002): before this module every consumer
// re-derived the season independently, and two of them guessed from the system
// clock (`new Date().getUTCFullYear()` in the opportunity cron, `getFullYear()`
// in the add-league form). A wall-clock year is wrong for roughly five months of
// every cycle — in January the NFL "season" is still the previous calendar year,
// and during the offseason there is no current week at all. Bye-week alerts were
// then keyed off a hardcoded 2025 table with no season check anywhere in the path.
//
// Sleeper's /v1/state/nfl is the authoritative free source and is already an
// approved integration. This module is deliberately the ONLY place that answers
// the question, so a season bug can only ever have one home.

import { getNflState } from "../sleeper/league";

/**
 * Where we are in the NFL calendar. Sleeper reports `season_type` as
 * pre | regular | post | off; anything unrecognised is treated as "unknown" so
 * callers must handle it explicitly instead of silently assuming regular season.
 */
export type SeasonPhase = "pre" | "regular" | "post" | "off" | "unknown";

export interface NflSeasonState {
  /** Four-digit NFL season, e.g. 2026. Not necessarily the calendar year. */
  season: number;
  phase: SeasonPhase;
  /**
   * Sleeper's week counter. Only meaningful during `regular` and `post`; it is
   * 1 during the preseason and must not be read as "regular season week 1".
   */
  week: number;
  /** True only when regular-season games are being played (week >= 1). */
  isRegularSeason: boolean;
  source: string;
  retrievedAt: string;
}

export function classifySeasonPhase(seasonType: string | null | undefined): SeasonPhase {
  switch ((seasonType ?? "").trim().toLowerCase()) {
    case "pre":
    case "preseason":
      return "pre";
    case "regular":
      return "regular";
    case "post":
    case "postseason":
      return "post";
    case "off":
    case "offseason":
      return "off";
    default:
      return "unknown";
  }
}

/**
 * Resolve the live season state, or `null` when Sleeper is unavailable or returns
 * something we cannot trust. Returning null (rather than a guessed fallback) is
 * the whole point: callers that need a verified season must fail closed.
 */
export async function getCurrentNflSeason(
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<NflSeasonState | null> {
  const state = await getNflState(fetcher).catch(() => null);
  const data = state?.data;
  if (!data) return null;

  const season = Number.parseInt(String(data.season), 10);
  // Guard against a malformed upstream payload rather than propagating NaN into
  // a schedule lookup, where it would silently match nothing.
  if (!Number.isInteger(season) || season < 1920 || season > 2200) return null;

  const phase = classifySeasonPhase(data.season_type);
  const week = Number.isFinite(data.week) ? Number(data.week) : 0;

  return {
    season,
    phase,
    week,
    isRegularSeason: phase === "regular" && week >= 1,
    source: "Sleeper /v1/state/nfl",
    retrievedAt: now().toISOString()
  };
}
