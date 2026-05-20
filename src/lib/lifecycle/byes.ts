import type { PlayerMarketRecord } from "../governance";

/**
 * Bye-week mapping for the current NFL season. Keys are team abbreviations,
 * values are the week number that team is on bye.
 *
 * Source: NFL schedule release. Update once per year before the season opens.
 * 2025 byes shown as a placeholder — replace with the live schedule when wired
 * via the Sleeper `getNflState`/ESPN scoreboard pipeline.
 */
export const BYE_WEEKS_2025: Record<string, number> = {
  ATL: 5, BUF: 7, CHI: 5, CIN: 10, CLE: 9, DAL: 10, DEN: 12, DET: 8,
  GB: 5, HOU: 6, IND: 11, JAX: 8, KC: 10, LAC: 12, LAR: 8, LV: 8,
  MIA: 12, MIN: 6, NE: 14, NO: 11, NYG: 14, NYJ: 9, PHI: 9, PIT: 5,
  SF: 14, SEA: 8, TB: 9, TEN: 10, WSH: 14, ARI: 8, BAL: 7, CAR: 14
};

export interface ByeWeekAlert {
  week: number;
  position: PlayerMarketRecord["position"];
  affectedPlayers: PlayerMarketRecord[];
  /** True when 2+ starters at a position share a bye in the same week. */
  stacked: boolean;
}

/**
 * Detect bye-week thinness in a roster. Returns one alert per (position, week)
 * pair where more than half of the roster's position depth is on bye.
 */
export function detectByeWeekRisks(
  roster: PlayerMarketRecord[],
  byes: Record<string, number> = BYE_WEEKS_2025
): ByeWeekAlert[] {
  const positions: Array<PlayerMarketRecord["position"]> = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const alerts: ByeWeekAlert[] = [];

  for (const position of positions) {
    const positional = roster.filter((p) => p.position === position && p.team);
    if (positional.length === 0) continue;

    const byWeek = new Map<number, PlayerMarketRecord[]>();
    for (const player of positional) {
      const week = byes[player.team!.toUpperCase()];
      if (!week) continue;
      const bucket = byWeek.get(week) ?? [];
      bucket.push(player);
      byWeek.set(week, bucket);
    }

    for (const [week, affected] of byWeek) {
      // Alert when bye coverage drops a position to < 50% of normal depth.
      const ratio = affected.length / positional.length;
      if (ratio >= 0.5) {
        alerts.push({
          week,
          position,
          affectedPlayers: affected,
          stacked: affected.length >= 2
        });
      }
    }
  }

  return alerts.sort((a, b) => a.week - b.week || a.position.localeCompare(b.position));
}

/**
 * For a given alert, recommend `limit` waiver targets at the same position,
 * filtered to teams not on bye that week. Sort by trueValue.
 */
export function recommendByeReplacements(
  alert: ByeWeekAlert,
  freeAgents: PlayerMarketRecord[],
  byes: Record<string, number> = BYE_WEEKS_2025,
  limit = 3
): PlayerMarketRecord[] {
  return freeAgents
    .filter((p) => p.position === alert.position)
    .filter((p) => !p.team || byes[p.team.toUpperCase()] !== alert.week)
    .sort((a, b) => b.trueValue - a.trueValue)
    .slice(0, limit);
}
