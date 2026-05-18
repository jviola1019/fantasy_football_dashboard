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

export const ESPN_LINEUP_SLOT_MAP: Record<number, string> = {
  0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE",
  7: "OP", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB", 13: "S", 14: "DB",
  15: "DP", 16: "DST", 17: "K", 18: "P", 19: "HC", 20: "BE", 21: "IR",
  23: "RB/WR/TE", 24: "ER", 25: "Rookie"
};

export function espnPosition(defaultPositionId: number | null | undefined): PlayerMarketRecord["position"] | null {
  if (defaultPositionId == null) return null;
  return ESPN_POSITION_MAP[defaultPositionId] ?? null;
}

export function espnProTeam(proTeamId: number | null | undefined): string | null {
  if (proTeamId == null) return null;
  return ESPN_PRO_TEAM_MAP[proTeamId] ?? null;
}

export function espnLineupSlot(lineupSlotId: number | null | undefined): string {
  if (lineupSlotId == null) return "FLEX";
  return ESPN_LINEUP_SLOT_MAP[lineupSlotId] ?? `SLOT_${lineupSlotId}`;
}
