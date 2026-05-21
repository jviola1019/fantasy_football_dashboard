export interface LeagueFormat {
  /** Reception scoring: 0 standard, 0.5 half-PPR, 1 full PPR. */
  ppr: 0 | 0.5 | 1;
  /** 1 for single-QB leagues, 2 for superflex/2QB. */
  numQbs: 1 | 2;
  numTeams: number;
}

export const DEFAULT_FORMAT: LeagueFormat = { ppr: 1, numQbs: 1, numTeams: 12 };

function normalizePpr(rec: unknown): 0 | 0.5 | 1 {
  if (rec === 1) return 1;
  if (rec === 0.5) return 0.5;
  return 0;
}

/** Parse a Sleeper `getLeague` payload into a LeagueFormat. */
export function parseSleeperFormat(league: unknown): LeagueFormat {
  if (!league || typeof league !== "object") return DEFAULT_FORMAT;
  const l = league as Record<string, unknown>;
  const positions = Array.isArray(l.roster_positions) ? (l.roster_positions as string[]) : [];
  const scoring = (l.scoring_settings ?? {}) as Record<string, unknown>;
  const numTeams = typeof l.total_rosters === "number" ? l.total_rosters : DEFAULT_FORMAT.numTeams;
  const numQbs: 1 | 2 = positions.includes("SUPER_FLEX") ? 2 : 1;
  return { ppr: normalizePpr(scoring.rec), numQbs, numTeams };
}

/** Parse an ESPN `mSettings` payload into a LeagueFormat. */
export function parseEspnFormat(settings: unknown): LeagueFormat {
  if (!settings || typeof settings !== "object") return DEFAULT_FORMAT;
  const s = settings as Record<string, unknown>;
  const numTeams = typeof s.size === "number" ? s.size : DEFAULT_FORMAT.numTeams;
  // ESPN statId 53 = receptions; its points value is the PPR weight.
  const scoring = (s.scoringSettings ?? {}) as Record<string, unknown>;
  const items = Array.isArray(scoring.scoringItems) ? (scoring.scoringItems as Record<string, unknown>[]) : [];
  const recItem = items.find((i) => i.statId === 53);
  const ppr = normalizePpr(typeof recItem?.points === "number" ? recItem.points : 0);
  // Lineup slot 23 = OP/superflex; >0 count means superflex.
  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const numQbs: 1 | 2 = (counts["23"] ?? 0) > 0 ? 2 : 1;
  return { ppr, numQbs, numTeams };
}
