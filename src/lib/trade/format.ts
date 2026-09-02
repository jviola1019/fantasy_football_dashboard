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

/**
 * How confident we are allowed to be about a classification (audit P2 §11).
 *
 * Not every field in a LeagueFormat is known the same way, and collapsing that
 * distinction is how a heuristic starts being reported as a fact. Sleeper
 * PUBLISHES league type as `settings.type`; ESPN does not publish one at all
 * and it is INFERRED from keeper count against roster size. Both previously
 * arrived as a bare `leagueType: "dynasty"` with nothing to tell them apart.
 *
 *   platform-declared  the platform states it outright
 *   owner-confirmed    a human confirmed it in league settings
 *   derived            inferred by our heuristic from other fields
 *   defaulted          the platform omitted it; we fell back to a safe default
 *   unavailable        not known, and not guessed
 */
export const ProvenanceSchema = z.enum([
  "platform-declared",
  "owner-confirmed",
  "derived",
  "defaulted",
  "unavailable"
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const FormatProvenanceSchema = z.object({
  leagueType: ProvenanceSchema,
  keeperCount: ProvenanceSchema,
  keeperCostRule: ProvenanceSchema,
  /** Free-text explanation of a `derived` verdict, for the settings screen. */
  note: z.string().nullable()
});
export type FormatProvenance = z.infer<typeof FormatProvenanceSchema>;

export const LeagueFormatSchema = z.object({
  /**
   * Points per reception SNAPPED to the three values the third-party value
   * APIs accept. Use `pprActual` for anything shown to a human.
   */
  ppr: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  /**
   * The league's REAL points-per-reception setting, unrounded.
   *
   * Audit 2026-08-22, P1-3. `normalizePpr` returned 0 for anything that was
   * not exactly 0, 0.5 or 1 — so a 0.25 PPR league, a 0.75 PPR league and a
   * 1.5 PPR TE-premium league were all classified STANDARD, which for the
   * 1.5 case is the furthest-possible-from-correct answer. The settings screen
   * then told the owner their league was "STD (0 pt/reception)" while they were
   * looking at a league that pays 1.5, and FantasyCalc was queried with ppr=0.
   *
   * Optional so previously stored league rows keep parsing; absent means the
   * row predates this field, and the UI says "not recorded" rather than
   * inventing one.
   */
  pprActual: z.number().nonnegative().optional(),
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
  /**
   * This manager's slot in round 1 (1-indexed). Neither platform reliably
   * exposes which pickOrder entry is "you", so it is confirmed by the owner.
   * Null means keeper pricing falls back to the middle of the round and says so.
   */
  draftSlot: z.number().int().positive().nullable(),
  numTeams: z.number().int().positive(),
  scoringFormat: z.enum(["STD", "HALF", "PPR"]),
  rosterSize: z.number().int().positive(),
  starters: LeagueStartersSchema,
  tradeDeadlineWeek: z.number().int().positive().nullable(),
  playoffWeekStart: z.number().int().positive().nullable(),
  playoffTeams: z.number().int().positive().nullable(),
  /**
   * How each classification above was arrived at. Optional so previously
   * stored league rows keep parsing; absent means "not recorded", which the UI
   * renders as unknown rather than inventing a confidence.
   */
  provenance: FormatProvenanceSchema.optional(),
  /**
   * Roster slot codes the parser did not recognise AT ALL.
   *
   * The starter mapper skips anything it cannot map, so an unknown slot code
   * silently contributes zero and the resulting lineup looks complete. Every
   * defect this file has carried had that shape: the ESPN slot-7/23 swap
   * reported every ordinary flex league as superflex, and the FAAB extractor
   * drew a budget board for two leagues that bid nothing. A slot RAE cannot
   * read must be NAMED, not absorbed.
   *
   * Optional so previously stored league rows keep parsing.
   */
  unmappedSlots: z.array(z.string()).optional(),
  /**
   * Slot codes RAE recognises and deliberately does not model — IDP (DL, LB,
   * DB, IDP_FLEX) on Sleeper, their ESPN equivalents.
   *
   * Kept separate from `unmappedSlots` because they mean different things: this
   * is a scope decision (RAE has no IDP values to rank with), that is a parser
   * gap. Collapsing them would make a deliberate omission read as a bug and a
   * bug read as a decision.
   */
  unmodelledSlots: z.array(z.string()).optional()
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
  pprActual: 1,
  numQbs: 1,
  leagueType: "redraft",
  keeperCount: 0,
  keeperCostRule: "none",
  keeperCostRound: null,
  draftSlot: null,
  numTeams: 12,
  scoringFormat: "PPR",
  rosterSize: 16,
  starters: DEFAULT_STARTERS,
  tradeDeadlineWeek: 11,
  playoffWeekStart: 15,
  playoffTeams: 6
};

/**
 * Snap a league's real points-per-reception to the three values the trade-value
 * APIs (FantasyCalc, KTC) accept.
 *
 * This used to return 0 for ANY value outside {0, 0.5, 1}. A 1.5 PPR
 * TE-premium league — a real and not-rare format — was therefore classified
 * STANDARD, the single furthest-away answer available. Snapping to the NEAREST
 * supported value is the smallest honest approximation; `pprActual` carries the
 * true figure so nothing has to guess it back, and `pprApproximated` lets the
 * UI say so out loud instead of quietly presenting the rounded value as fact.
 */
export function normalizePpr(rec: unknown): 0 | 0.5 | 1 {
  const n = typeof rec === "number" && Number.isFinite(rec) ? rec : 0;
  if (n <= 0.25) return 0;
  if (n < 0.75) return 0.5;
  return 1;
}

/** True when the league's real setting is not one of the three supported values. */
export function pprApproximated(actual: number | undefined): boolean {
  return actual !== undefined && actual !== 0 && actual !== 0.5 && actual !== 1;
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
/**
 * Slots RAE recognises and deliberately does not model.
 *
 * RAE carries no IDP values, so an IDP slot cannot be ranked or filled. That is
 * a scope decision, and it is recorded as one — `unmodelledSlots` — so it never
 * reads as the parser having failed to recognise the code.
 */
const SLEEPER_UNMODELLED_SLOTS = new Set(["DL", "LB", "DB", "IDP_FLEX"]);
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

interface SlotScan {
  starters: LeagueStarters;
  /** Recognised, deliberately not modelled (IDP). */
  unmodelled: string[];
  /** Not recognised at all — a parser gap, and it says so. */
  unmapped: string[];
}

function scanSleeperPositions(positions: string[]): SlotScan {
  const starters: LeagueStarters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  const unmodelled: string[] = [];
  const unmapped: string[] = [];
  for (const slot of positions) {
    if (SLEEPER_BENCH_SLOTS.has(slot)) continue;
    if (SLEEPER_UNMODELLED_SLOTS.has(slot)) {
      if (!unmodelled.includes(slot)) unmodelled.push(slot);
      continue;
    }
    const mapped = SLEEPER_STARTER_MAP[slot];
    if (mapped) {
      starters[mapped] += 1;
      continue;
    }
    // Neither bench, nor a slot we model, nor one we map: a code this parser
    // has never seen. Naming it is the whole point.
    if (!unmapped.includes(slot)) unmapped.push(slot);
  }
  return { starters, unmodelled, unmapped };
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
 *
 * Audit P2 §11: every verdict here is a HEURISTIC, and it now says so. Sleeper
 * publishes `settings.type` and is `platform-declared`; nothing ESPN returns
 * declares a league type, so even the confident-looking "redraft" is `derived`
 * — from the ABSENCE of keepers, which is an inference, not a statement.
 */
function espnLeagueType(s: Record<string, unknown>): {
  leagueType: LeagueType;
  keeperCount: number;
  provenance: FormatProvenance;
} {
  const draft = (s.draftSettings ?? {}) as Record<string, unknown>;
  const raw = typeof draft.keeperCount === "number" ? draft.keeperCount : 0;
  const future = typeof draft.keeperCountFuture === "number" ? draft.keeperCountFuture : 0;
  const keeperCount = Math.max(raw, future);
  const declaresKeepers =
    typeof draft.keeperCount === "number" || typeof draft.keeperCountFuture === "number";

  const prov = (leagueType: Provenance, note: string | null): FormatProvenance => ({
    leagueType,
    // The COUNT itself is a real published number when ESPN sends one.
    keeperCount: declaresKeepers ? "platform-declared" : "defaulted",
    // Never published by either platform — see KeeperCostRuleSchema.
    keeperCostRule: "unavailable",
    note
  });

  if (keeperCount <= 0) {
    return {
      leagueType: "redraft",
      keeperCount: 0,
      provenance: prov(
        "derived",
        declaresKeepers
          ? "ESPN publishes no league type. Inferred redraft because keeperCount is 0."
          : "ESPN publishes no league type and sent no keeper fields. Assumed redraft."
      )
    };
  }

  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const bench = counts["20"] ?? 0;
  const starting = Object.entries(counts)
    .filter(([slot]) => slot !== "20" && slot !== "21")
    .reduce((a, [, n]) => a + n, 0);

  if (starting > 0 && keeperCount >= starting + bench) {
    return {
      leagueType: "dynasty",
      keeperCount: 0,
      provenance: prov(
        "derived",
        `ESPN publishes no league type. Inferred dynasty because keeperCount ${keeperCount} ` +
          `covers the whole ${starting + bench}-man roster. If this is really a deep keeper ` +
          `league, correct it in league settings — dynasty switches trade values to the ` +
          `long-term scale.`
      )
    };
  }

  return {
    leagueType: "keeper",
    keeperCount,
    provenance: prov(
      "derived",
      `ESPN publishes no league type. Inferred keeper from keeperCount ${keeperCount} ` +
        `against a ${starting + bench}-man roster.`
    )
  };
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
  const pprActual = typeof scoring.rec === "number" && Number.isFinite(scoring.rec) ? scoring.rec : 0;
  const ppr = normalizePpr(pprActual);
  const scan = positions.length ? scanSleeperPositions(positions) : null;
  const starters = scan ? scan.starters : DEFAULT_STARTERS;
  return {
    ppr,
    pprActual,
    numQbs,
    leagueType: sleeperLeagueType(settings),
    keeperCount: sleeperKeeperCount(settings),
    // Unconfirmed by definition — Sleeper publishes no cost rule.
    keeperCostRule: sleeperKeeperCount(settings) > 0 ? "unknown" : "none",
    keeperCostRound: null,
    draftSlot: null,
    numTeams,
    scoringFormat: scoringFormatFromPpr(ppr),
    rosterSize: positions.length || DEFAULT_FORMAT.rosterSize,
    starters,
    tradeDeadlineWeek: typeof settings.trade_deadline === "number" ? settings.trade_deadline : null,
    playoffWeekStart: typeof settings.playoff_week_start === "number" ? settings.playoff_week_start : null,
    playoffTeams: typeof settings.playoff_teams === "number" ? settings.playoff_teams : null,
    // Audit P2 §11: Sleeper genuinely DECLARES the league type in settings.type,
    // so unlike ESPN this is not an inference and must not be labelled as one.
    provenance: {
      leagueType: typeof settings.type === "number" ? "platform-declared" : "defaulted",
      keeperCount:
        typeof settings.max_keepers === "number" ? "platform-declared" : "defaulted",
      // Neither platform publishes a cost rule — see KeeperCostRuleSchema.
      keeperCostRule: "unavailable",
      note:
        typeof settings.type === "number"
          ? null
          : "Sleeper omitted settings.type; assumed redraft."
    },
    unmappedSlots: scan ? scan.unmapped : [],
    unmodelledSlots: scan ? scan.unmodelled : []
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
  "23": "FLEX", // RB/WR/TE
  // Added 2026-09-01 by the ingestion conformance sweep. ESPN publishes THREE
  // flex slots and only the third was mapped, so a league whose flex is
  // RB/WR (3) or WR/TE (5) reported `FLEX: 0` — the same silent-drop that made
  // every ordinary-flex league read as superflex before the 7/23 swap was
  // fixed. Both are ordinary flex slots and both are common.
  "1": "QB", // TQB — team QB
  "3": "FLEX", // RB/WR
  "5": "FLEX" // WR/TE
  // 20 = BN (bench), 21 = IR, 24 = ER — excluded from starter counts
};
const ESPN_BENCH_SLOTS = new Set(["20", "21", "24"]);
/**
 * ESPN slots RAE recognises and deliberately does not model: IDP (8 DT, 9 DE,
 * 10 LB, 11 DL, 12 CB, 13 S, 14 DB, 15 DP), 18 P and 19 HC. RAE carries no
 * values for any of them, so they are recorded as a scope decision rather than
 * absorbed as zero — see `unmodelledSlots`.
 */
const ESPN_UNMODELLED_SLOTS = new Set(["8", "9", "10", "11", "12", "13", "14", "15", "18", "19"]);

function scanEspnCounts(counts: Record<string, number>): SlotScan {
  const starters: LeagueStarters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  const unmodelled: string[] = [];
  const unmapped: string[] = [];
  for (const [slotId, count] of Object.entries(counts)) {
    // A slot configured to zero is not part of this league's lineup at all, so
    // it is neither modelled nor a gap.
    if (!(count > 0)) continue;
    if (ESPN_BENCH_SLOTS.has(slotId)) continue;
    if (ESPN_UNMODELLED_SLOTS.has(slotId)) {
      if (!unmodelled.includes(slotId)) unmodelled.push(slotId);
      continue;
    }
    const mapped = ESPN_LINEUP_SLOT_MAP[slotId];
    if (mapped) {
      starters[mapped] += count;
      continue;
    }
    if (!unmapped.includes(slotId)) unmapped.push(slotId);
  }
  return { starters, unmodelled, unmapped };
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
  const pprActual = typeof recItem?.points === "number" && Number.isFinite(recItem.points) ? recItem.points : 0;
  const ppr = normalizePpr(pprActual);
  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const numQbs: 1 | 2 = (counts["7"] ?? 0) > 0 ? 2 : 1;
  const espnScan = scanEspnCounts(counts);
  const starters = espnScan.starters;
  const rosterSize = Object.values(counts).reduce((a, b) => a + b, 0);
  const { leagueType, keeperCount, provenance } = espnLeagueType(s);
  return {
    ppr,
    pprActual,
    numQbs,
    leagueType,
    keeperCount,
    // ESPN publishes keeperCount but never a cost — see KeeperCostRuleSchema.
    keeperCostRule: keeperCount > 0 ? "unknown" : "none",
    keeperCostRound: null,
    draftSlot: null,
    numTeams,
    scoringFormat: scoringFormatFromPpr(ppr),
    rosterSize: rosterSize || DEFAULT_FORMAT.rosterSize,
    starters,
    tradeDeadlineWeek: espnTradeDeadlineWeek(s),
    playoffWeekStart: espnPlayoffWeekStart(s),
    playoffTeams: espnPlayoffTeams(s),
    provenance,
    unmappedSlots: espnScan.unmapped,
    unmodelledSlots: espnScan.unmodelled
  };
}
