import { z } from "zod";

export type ScoringFormat = "STD" | "HALF" | "PPR";

// Zod mirror of LeagueStarters / LeagueFormat lives alongside the interfaces
// so the two cannot drift. RAEEnvelopeSchema in governance.ts imports
// LeagueFormatSchema from here.
export const LeagueStartersSchema = z.object({
  QB: z.number().int().nonnegative(),
  RB: z.number().int().nonnegative(),
  WR: z.number().int().nonnegative(),
  TE: z.number().int().nonnegative(),
  FLEX: z.number().int().nonnegative(),
  DEF: z.number().int().nonnegative(),
  K: z.number().int().nonnegative(),
  SUPERFLEX: z.number().int().nonnegative()
});

export type LeagueStarters = z.infer<typeof LeagueStartersSchema>;

export const LeagueFormatSchema = z.object({
  ppr: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  numQbs: z.union([z.literal(1), z.literal(2)]),
  numTeams: z.number().int().positive(),
  scoringFormat: z.enum(["STD", "HALF", "PPR"]),
  rosterSize: z.number().int().positive(),
  starters: LeagueStartersSchema,
  tradeDeadlineWeek: z.number().int().positive().nullable(),
  playoffWeekStart: z.number().int().positive().nullable(),
  playoffTeams: z.number().int().positive().nullable()
});

export type LeagueFormat = z.infer<typeof LeagueFormatSchema>;

const DEFAULT_STARTERS: LeagueStarters = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  DEF: 1,
  K: 1,
  SUPERFLEX: 0
};

export const DEFAULT_FORMAT: LeagueFormat = {
  ppr: 1,
  numQbs: 1,
  numTeams: 12,
  scoringFormat: "PPR",
  rosterSize: 16,
  starters: DEFAULT_STARTERS,
  tradeDeadlineWeek: 11,
  playoffWeekStart: 15,
  playoffTeams: 6
};

function normalizePpr(rec: unknown): 0 | 0.5 | 1 {
  if (rec === 1) return 1;
  if (rec === 0.5) return 0.5;
  return 0;
}

function scoringFormatFromPpr(ppr: 0 | 0.5 | 1): ScoringFormat {
  if (ppr === 1) return "PPR";
  if (ppr === 0.5) return "HALF";
  return "STD";
}

// Sleeper's `roster_positions` is an ordered array of slot codes; bench/reserve
// codes are excluded from starter counts. SUPER_FLEX maps onto SUPERFLEX which
// implies numQbs=2. WRRB_FLEX / REC_FLEX collapse to FLEX. Anything we don't
// recognize is silently dropped — the user's league's true config is the
// authority, not this map.
const SLEEPER_BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const SLEEPER_STARTER_MAP: Record<string, keyof LeagueStarters | null> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "FLEX",
  REC_FLEX: "FLEX",
  WR_TE_FLEX: "FLEX",
  SUPER_FLEX: "SUPERFLEX",
  DEF: "DEF",
  DL: null,
  LB: null,
  DB: null,
  IDP_FLEX: null,
  K: "K"
};

function startersFromSleeperPositions(positions: string[]): LeagueStarters {
  const result: LeagueStarters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  for (const slot of positions) {
    if (SLEEPER_BENCH_SLOTS.has(slot)) continue;
    const mapped = SLEEPER_STARTER_MAP[slot];
    if (mapped) result[mapped] += 1;
  }
  return result;
}

/** Parse a Sleeper `getLeague` payload into a LeagueFormat. */
export function parseSleeperFormat(league: unknown): LeagueFormat {
  if (!league || typeof league !== "object") return DEFAULT_FORMAT;
  const l = league as Record<string, unknown>;
  const positions = Array.isArray(l.roster_positions) ? (l.roster_positions as string[]) : [];
  const scoring = (l.scoring_settings ?? {}) as Record<string, unknown>;
  const settings = (l.settings ?? {}) as Record<string, unknown>;
  const numTeams =
    typeof settings.num_teams === "number"
      ? settings.num_teams
      : typeof l.total_rosters === "number"
        ? l.total_rosters
        : DEFAULT_FORMAT.numTeams;
  const numQbs: 1 | 2 = positions.includes("SUPER_FLEX") ? 2 : 1;
  const ppr = normalizePpr(scoring.rec);
  const starters = positions.length
    ? startersFromSleeperPositions(positions)
    : DEFAULT_STARTERS;
  return {
    ppr,
    numQbs,
    numTeams,
    scoringFormat: scoringFormatFromPpr(ppr),
    rosterSize: positions.length || DEFAULT_FORMAT.rosterSize,
    starters,
    tradeDeadlineWeek: typeof settings.trade_deadline === "number" ? settings.trade_deadline : null,
    playoffWeekStart: typeof settings.playoff_week_start === "number" ? settings.playoff_week_start : null,
    playoffTeams: typeof settings.playoff_teams === "number" ? settings.playoff_teams : null
  };
}

// ESPN lineup slot ID → position name. Documented at
// https://github.com/cwendt94/espn-api/wiki/league-class — slot IDs are stable
// across seasons. Slots not in this map (e.g. IDP) are dropped silently.
const ESPN_LINEUP_SLOT_MAP: Record<string, keyof LeagueStarters | null> = {
  "0": "QB",
  "2": "RB",
  "4": "WR",
  "6": "TE",
  "7": "FLEX", // OP / RB-WR-TE
  "16": "DEF", // D/ST
  "17": "K",
  "23": "SUPERFLEX" // OP / QB-RB-WR-TE
  // 20 = BN (bench), 21 = IR — excluded from starter counts
};
const ESPN_BENCH_SLOTS = new Set(["20", "21"]);

function startersFromEspnCounts(counts: Record<string, number>): LeagueStarters {
  const result: LeagueStarters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  for (const [slotId, count] of Object.entries(counts)) {
    if (ESPN_BENCH_SLOTS.has(slotId)) continue;
    const mapped = ESPN_LINEUP_SLOT_MAP[slotId];
    if (mapped) result[mapped] += count;
  }
  return result;
}

// ESPN exposes the trade deadline as a millis-since-epoch timestamp. Convert
// to a fantasy week index by counting full weeks between the season-start
// firstScoringPeriod date and the deadline date. Returns null when either
// timestamp is missing or zero (some leagues have no deadline configured).
function espnTradeDeadlineWeek(s: Record<string, unknown>): number | null {
  const trade = (s.tradeSettings ?? {}) as Record<string, unknown>;
  const deadlineMs = typeof trade.deadlineDate === "number" ? trade.deadlineDate : 0;
  const status = (s.status ?? {}) as Record<string, unknown>;
  const firstScoringMs = typeof status.firstScoringPeriod === "number"
    ? status.firstScoringPeriod
    : typeof status.currentMatchupPeriod === "number"
      ? null
      : null;
  if (deadlineMs <= 0 || firstScoringMs == null) return null;
  const diffMs = deadlineMs - firstScoringMs;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks >= 1 ? diffWeeks : null;
}

// Playoff week start = regular season weeks + 1. ESPN exposes
// scheduleSettings.matchupPeriodCount (total regular-season weeks) and
// playoffMatchupPeriodLength (weeks per playoff round). playoffWeekStart =
// matchupPeriodCount + 1 when those are present.
function espnPlayoffWeekStart(s: Record<string, unknown>): number | null {
  const schedule = (s.scheduleSettings ?? {}) as Record<string, unknown>;
  const regWeeks = typeof schedule.matchupPeriodCount === "number" ? schedule.matchupPeriodCount : null;
  if (regWeeks == null) return null;
  return regWeeks + 1;
}

function espnPlayoffTeams(s: Record<string, unknown>): number | null {
  const schedule = (s.scheduleSettings ?? {}) as Record<string, unknown>;
  if (typeof schedule.playoffTeamCount === "number") return schedule.playoffTeamCount;
  const playoff = (s.playoffSettings ?? {}) as Record<string, unknown>;
  if (typeof playoff.playoffTeamCount === "number") return playoff.playoffTeamCount;
  return null;
}

/** Parse an ESPN `mSettings` payload into a LeagueFormat. */
export function parseEspnFormat(settings: unknown): LeagueFormat {
  if (!settings || typeof settings !== "object") return DEFAULT_FORMAT;
  const s = settings as Record<string, unknown>;
  const numTeams = typeof s.size === "number" ? s.size : DEFAULT_FORMAT.numTeams;
  const scoring = (s.scoringSettings ?? {}) as Record<string, unknown>;
  const items = Array.isArray(scoring.scoringItems) ? (scoring.scoringItems as Record<string, unknown>[]) : [];
  const recItem = items.find((i) => i.statId === 53);
  const ppr = normalizePpr(typeof recItem?.points === "number" ? recItem.points : 0);
  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const numQbs: 1 | 2 = (counts["23"] ?? 0) > 0 ? 2 : 1;
  const starters = startersFromEspnCounts(counts);
  const rosterSize = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    ppr,
    numQbs,
    numTeams,
    scoringFormat: scoringFormatFromPpr(ppr),
    rosterSize: rosterSize || DEFAULT_FORMAT.rosterSize,
    starters,
    tradeDeadlineWeek: espnTradeDeadlineWeek(s),
    playoffWeekStart: espnPlayoffWeekStart(s),
    playoffTeams: espnPlayoffTeams(s)
  };
}
