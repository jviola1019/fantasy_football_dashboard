import type { PlayerMarketRecord } from "../governance";
import { normalizeTeamCode } from "../fantasypros/match";
import type { VerifiedByeSchedule } from "../schedule/byeSchedule";

/**
 * Bye-week risk detection.
 *
 * Audit 2026-08-06 F-002 rewrote this module. It previously defaulted to a
 * hardcoded `BYE_WEEKS_2025` table that was never checked against the live
 * season, so in 2026 it produced confidently wrong waiver advice. That table is
 * gone from production entirely; the schedule now arrives as a
 * `VerifiedByeSchedule` derived from the published NFL schedule (see
 * lib/schedule/byeSchedule.ts) and there is deliberately NO default argument —
 * a caller that cannot supply a verified schedule cannot produce alerts.
 */

export interface ByeWeekAlert {
  week: number;
  position: PlayerMarketRecord["position"];
  affectedPlayers: PlayerMarketRecord[];
  /** True when 2+ starters at a position share a bye in the same week. */
  stacked: boolean;
  /** Season the bye came from, carried so notifications can record provenance. */
  season: number;
}

/**
 * Detect bye-week thinness in a roster. Returns one alert per (position, week)
 * pair where at least half of the roster's depth at that position is on bye.
 *
 * Team codes are normalized before lookup. This matters: Sleeper emits "WAS" and
 * ESPN emits "WSH" for the same franchise, and the retired table keyed only
 * "WSH" — so Washington players on Sleeper rosters were silently skipped.
 */
export function detectByeWeekRisks(
  roster: PlayerMarketRecord[],
  schedule: VerifiedByeSchedule
): ByeWeekAlert[] {
  const positions: Array<PlayerMarketRecord["position"]> = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const alerts: ByeWeekAlert[] = [];

  for (const position of positions) {
    const positional = roster.filter((p) => p.position === position && p.team);
    if (positional.length === 0) continue;

    const byWeek = new Map<number, PlayerMarketRecord[]>();
    for (const player of positional) {
      const team = normalizeTeamCode(player.team);
      if (!team) continue;
      const week = schedule.byes[team];
      if (week === undefined) continue;
      const bucket = byWeek.get(week) ?? [];
      bucket.push(player);
      byWeek.set(week, bucket);
    }

    for (const [week, affected] of byWeek) {
      // Alert when bye coverage drops a position to half or less of normal depth.
      const ratio = affected.length / positional.length;
      if (ratio >= 0.5) {
        alerts.push({
          week,
          position,
          affectedPlayers: affected,
          stacked: affected.length >= 2,
          season: schedule.season
        });
      }
    }
  }

  return alerts.sort((a, b) => a.week - b.week || a.position.localeCompare(b.position));
}
