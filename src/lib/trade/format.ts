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

/**
 * Redraft vs keeper vs dynasty. Audit 2026-08-06 F-010: this dimension did not
 * exist, so every league was valued as redraft — dynasty trade values were
 * hardcoded off and keeper decisions had nowhere to live. Both platforms
 * publish it and neither was being read.
 */
export const LeagueTypeSchema = z.enum(["redraft", "keeper", "dynasty"]);
export type LeagueType = z.infer<typeof LeagueTypeSchema>;

/**
 * What keeping a player costs you.
 *
 * Verified against the operator's real ESPN keeper league (1546190) on
 * 2026-08-15: the FULL `draftSettings` payload is
 *   { auctionBudget, availableDate, date, isTradingEnabled, keeperCount,
 *     keeperCountFuture, keeperDeadlineDate, keeperOrderType: "MANUAL",
 *     leagueSubType, orderType, pickOrder, timePerSelection, type: "SNAKE" }
 * — there is NO field describing the cost. `keeperOrderType` is the ordering of
 * keeper selections, not their price. Sleeper does not publish one either.
 *
 * The cost is a league convention agreed between managers, so it CANNOT be
 * detected and must never be guessed. `unknown` is the honest default and the
 * app fails closed on it: no keeper recommendation is produced until an owner
 * confirms the rule. Guessing here would be worse than silence, because a
 * keeper decision is irreversible for the season.
 */
export const KeeperCostRuleSchema = z.enum([
  /** Not applicable — redraft, or dynasty where the whole roster carries over. */
  "none",
  /** Costs a fixed round every year, e.g. "your first-round pick". */
  "fixed-round",
  /** Costs the round the player was drafted in last season. */
  "draft-round",
  /** Costs the round they were kept at, minus one each year. */
  "escalating-round",
  /** Auction leagues: costs last year's salary plus an increment. */
  "auction-salary",
  /** Free — no pick is forfeited. */
  "free",
  /** Not yet confirmed by an owner. Fails closed: no recommendation. */
  "unknown"
]);
export type KeeperCostRule = z.infer<typeof KeeperCostRuleSchema>;

export const LeagueFormatSchema = z.object({
  ppr: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  numQbs: z.union([z.literal(1), z.literal(2)]),
  /** redraft | keeper | dynasty, read from the platform — never assumed. */
  leagueType: LeagueTypeSchema,
  /** How many players may be kept. 0 for redraft and for dynasty (all are kept). */
  keeperCount: z.number().int().nonnegative(),
  /**
   * How a keeper is paid for. Neither platform publishes this, so it is
   * `unknown` until an owner confirms it at league-add time.
   */
  keeperCostRule: KeeperCostRuleSchema,
  /** For `fixed-round`: which round. Null until confirmed. */
  keeperCostRound: z.number().int().positive().nullable(),
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
  leagueType: "redraft",
  keeperCount: 0,
  keeperCostRule: "none",
  keeperCostRound: null,
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

/**
 * Sleeper publishes the league type as `settings.type`: 0 redraft, 1 keeper,
 * 2 dynasty. It was parsed into the schema and then never read.
 */
function sleeperLeagueType(settings: Record<string, unknown>): LeagueType {
  const raw = settings.type;
  if (raw === 2) return "dynasty";
  if (raw === 1) return "keeper";
  return "redraft";
}

function sleeperKeeperCount(settings: Record<string, unknown>): number {
  // Dynasty keeps the whole roster, so a keeper COUNT is meaningless there.
  if (settings.type === 2) return 0;
  const n = settings.max_keepers;
  return typeof n === "number" && n > 0 ? n : 0;
}

/**
 * ESPN has no "dynasty" flag — it models continuity purely as keepers. A league
 * that keeps (nearly) the whole roster is a dynasty in all but name, so treat a
 * keeper count at or above the starting-lineup size as dynasty; otherwise it is
 * a keeper league. `keeperCount` of 0 means redraft.
 */
function espnLeagueType(s: Record<string, unknown>): { leagueType: LeagueType; keeperCount: number } {
  const draft = (s.draftSettings ?? {}) as Record<string, unknown>;
  const raw = typeof draft.keeperCount === "number" ? draft.keeperCount : 0;
  const future = typeof draft.keeperCountFuture === "number" ? draft.keeperCountFuture : 0;
  const keeperCount = Math.max(raw, future);
  if (keeperCount <= 0) return { leagueType: "redraft", keeperCount: 0 };
  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const bench = counts["20"] ?? 0;
  const starting = Object.entries(counts)
    .filter(([slot]) => slot !== "20" && slot !== "21")
    .reduce((a, [, n]) => a + n, 0);
  if (starting > 0 && keeperCount >= starting + bench) {
    return { leagueType: "dynasty", keeperCount: 0 };
  }
  return { leagueType: "keeper", keeperCount };
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
    leagueType: sleeperLeagueType(settings),
    keeperCount: sleeperKeeperCount(settings),
    // Unconfirmed by definition — Sleeper publishes no cost rule.
    keeperCostRule: sleeperKeeperCount(settings) > 0 ? "unknown" : "none",
    keeperCostRound: null,
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
  // Audit 2026-08-06 F-010: slots 7 and 23 were SWAPPED here, contradicting the
  // authoritative map in espn/positions.ts. ESPN's IDs are 7 = OP (Offensive
  // Player, i.e. superflex — QB/RB/WR/TE eligible) and 23 = RB/WR/TE (the
  // ordinary flex). Because the check below keyed superflex off slot 23, EVERY
  // league with a normal flex was reported as superflex: verified against all
  // four of the operator's real ESPN leagues, each returning numQbs=2 for what
  // is a standard 1QB league. That fed superflex QB targets into the draft
  // board, a 2QB FantasyCalc URL, and the KTC superflex value scale.
  "7": "SUPERFLEX", // OP — QB/RB/WR/TE
  "16": "DEF", // D/ST
  "17": "K",
  "23": "FLEX" // RB/WR/TE
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
  const numQbs: 1 | 2 = (counts["7"] ?? 0) > 0 ? 2 : 1;
  const starters = startersFromEspnCounts(counts);
  const rosterSize = Object.values(counts).reduce((a, b) => a + b, 0);
  const { leagueType, keeperCount } = espnLeagueType(s);
  return {
    ppr,
    numQbs,
    leagueType,
    keeperCount,
    // ESPN publishes keeperCount but never a cost — see KeeperCostRuleSchema.
    keeperCostRule: keeperCount > 0 ? "unknown" : "none",
    keeperCostRound: null,
    numTeams,
    scoringFormat: scoringFormatFromPpr(ppr),
    rosterSize: rosterSize || DEFAULT_FORMAT.rosterSize,
    starters,
    tradeDeadlineWeek: espnTradeDeadlineWeek(s),
    playoffWeekStart: espnPlayoffWeekStart(s),
    playoffTeams: espnPlayoffTeams(s)
  };
}
