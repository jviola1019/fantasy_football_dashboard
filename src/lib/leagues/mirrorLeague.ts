import type { DraftState } from "./draftState";

/**
 * The completed/upcoming season pair for a connected league. `completed` is the
 * season whose results are final (null when the league has no history yet);
 * `upcoming` is the season the user is drafting/planning for. Empty rosters in
 * the upcoming season are genuinely undrafted — never fabricated.
 */
export interface SeasonMirror {
  completed: string | null;
  upcoming: string;
}

/**
 * Derive the season pair for a Sleeper league. Three cases (see SPRINT5 §2.3):
 *  - A: a COMPLETED league → completed = its season, upcoming = season + 1.
 *  - B: an UPCOMING league WITH a predecessor (renewal chain) → completed =
 *    season − 1, upcoming = season.
 *  - C: a brand-NEW pre-draft league with no `previous_league_id` → completed =
 *    null, upcoming = season.
 * `in_season` (mid-year) leagues report completed = null, upcoming = season.
 */
export function resolveSleeperSeasonMirror(
  leagueStatus: string | null | undefined,
  leagueSeason: string | null | undefined,
  previousLeagueId: string | null | undefined,
  currentSeason: string
): SeasonMirror {
  const status = (leagueStatus ?? "").toLowerCase();
  const season = leagueSeason ?? currentSeason;

  if (status === "complete") {
    return { completed: season, upcoming: String(Number(season) + 1) };
  }
  if (status === "pre_draft" || status === "drafting") {
    return {
      completed: previousLeagueId ? String(Number(season) - 1) : null,
      upcoming: season
    };
  }
  return { completed: null, upcoming: season };
}

/**
 * ESPN has no league-chaining field, so the season pair is derived from draft
 * state: a drafted (post) league treats its season as completed and the next
 * as upcoming; a pre-draft league has no completed history.
 */
export function resolveEspnSeasonMirror(
  leagueSeason: number,
  draftState: DraftState
): SeasonMirror {
  if (draftState === "post") {
    return { completed: String(leagueSeason), upcoming: String(leagueSeason + 1) };
  }
  return { completed: null, upcoming: String(leagueSeason) };
}
