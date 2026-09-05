/**
 * Reconcile NFL team abbreviations across nflverse sources.
 *
 * WHY THIS IS NEEDED, discovered rather than anticipated.
 *
 * `stats_team_week_*` applies MODERN abbreviations retroactively — the 2017
 * Raiders are `LV` — while `games.csv` uses the abbreviation the team actually
 * had that year, `OAK`. Joining the two on a raw team string therefore drops
 * every Oakland week from 2017–2019, which is roughly 48 team-weeks: a 1.1%
 * loss, invisible in any aggregate, and enough to silently remove one franchise
 * from three seasons of a defensive model.
 *
 * It was caught only because `holdout-kdst-gauntlet.ts` measures its join rate
 * and refuses below 99%. Without that floor the run would have produced a
 * complete-looking report about 98.86% of the data. That is the same shape as
 * every other defect this repository keeps finding: a step that cannot see what
 * it dropped reports success.
 *
 * DIRECTION: everything normalises to the CURRENT abbreviation, because that is
 * what the modern nflverse tables use and what a reader recognises. Relocations
 * only — this is not a general alias table, and it deliberately does not map
 * things like `JAC`/`JAX` unless a real source disagreement is observed, because
 * an unnecessary mapping can merge two teams that were never the same.
 */

/** Historical abbreviation → the abbreviation nflverse uses today. */
export const TEAM_ABBR_ALIASES: Readonly<Record<string, string>> = {
  // Oakland → Las Vegas, 2020. nflverse back-applies LV to earlier seasons.
  OAK: "LV",
  // San Diego → Los Angeles Chargers, 2017.
  SD: "LAC",
  // St. Louis → Los Angeles Rams, 2016.
  STL: "LAR",
  // Washington's several names all resolve to WAS in modern nflverse.
  WSH: "WAS"
};

export function normalizeTeamAbbr(abbr: string | undefined | null): string {
  if (!abbr) return "";
  const upper = abbr.trim().toUpperCase();
  return TEAM_ABBR_ALIASES[upper] ?? upper;
}
