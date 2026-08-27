import type { PlayerMarketRecord } from "../governance";

export const ESPN_POSITION_MAP: Record<number, PlayerMarketRecord["position"] | null> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF"
};

export const ESPN_PRO_TEAM_MAP: Record<number, string> = {
  0: "FA",
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
};

export function espnPosition(defaultPositionId: number | null | undefined): PlayerMarketRecord["position"] | null {
  if (defaultPositionId == null) return null;
  return ESPN_POSITION_MAP[defaultPositionId] ?? null;
}

export function espnProTeam(proTeamId: number | null | undefined): string | null {
  if (proTeamId == null) return null;
  return ESPN_PRO_TEAM_MAP[proTeamId] ?? null;
}

/*
 * REMOVED 2026-08-26 -- `ESPN_LINEUP_SLOT_MAP` and `espnLineupSlot`.
 *
 * A lineupSlotId -> slot-name map and its accessor, neither of which anything
 * ever called. `schemas.ts:20` parses `lineupSlotId` off the ESPN response and
 * nothing consumes it; no ESPN code path sets `rosterSlot` at all.
 *
 * It was the unwired half of a feature. The visible half was worse: every live
 * record carried a hardcoded `rosterSlot: "FLEX"`, so the product displayed a
 * lineup slot it had never derived. That is fixed in the same commit --
 * `rosterSlot` is nullable now and renders an em dash when unknown.
 *
 * Deleting rather than keeping it follows the precedent set when `weather/` was
 * removed: code that looks connected and is not is a claim the product cannot
 * support. Restore from git history if ESPN lineup slots are wired for real.
 */
