// Season-aware, provenance-carrying, fail-closed NFL bye-week schedule.
//
// Why this exists (audit 2026-08-06 F-002): the shipped table was a hardcoded
// `BYE_WEEKS_2025` with `season: 2025, verified: false`, and `detectByeWeekRisks`
// took it as a DEFAULT ARGUMENT. Nothing in the path compared that 2025 against
// the live season, so in 2026 the daily lifecycle cron turned a stale table into
// actionable waiver advice. Two independent defects, both real:
//   1. wrong season entirely — 2026 byes differ from 2025 for nearly every team;
//   2. the 2025 table was itself wrong for WAS (listed week 14, actually week 12).
//
// The fix derives byes from the actual schedule instead of transcribing them. In
// a valid NFL regular season every team plays exactly once per week except for a
// single bye, so "the one week with no game" IS the bye — a definition that
// cannot drift from the source and that validates itself.
//
// Source: nflverse `nfldata/data/games.csv` (CC-BY), already an approved
// integration for opportunity data. It carries the full schedule the moment the
// league publishes it.
//
// Fail-closed contract: every failure mode returns a structured `unavailable`
// result. There is no fallback table, so production cannot silently serve stale
// or wrong-season byes. Callers must handle `status === "unavailable"`.

import { normalizeTeamCode } from "../fantasypros/match";

export const NFLVERSE_GAMES_URL =
  "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/** Canonical 32 franchise codes, post-normalization (WSH→WAS, LA→LAR, OAK→LV). */
export const NFL_TEAMS: readonly string[] = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"
];

const NFL_TEAM_SET: ReadonlySet<string> = new Set(NFL_TEAMS);

/** A modern regular season is 18 weeks; reject anything outside a sane window. */
const MIN_REG_WEEKS = 17;
const MAX_REG_WEEKS = 18;

export type ByeScheduleFailure =
  | "season-unresolved"
  | "source-unavailable"
  | "source-unparseable"
  | "schedule-not-published"
  | "incomplete-coverage"
  | "invalid-week"
  | "season-mismatch";

export interface ByeProvenance {
  source: string;
  sourceUrl: string;
  /** ISO timestamp the schedule was retrieved. */
  retrievedAt: string;
  /** How the byes were obtained — surfaced to users, so keep it plain. */
  derivation: string;
}

export interface VerifiedByeSchedule {
  status: "verified";
  season: number;
  /** Canonical team code → bye week. Exactly 32 entries, each week in range. */
  byes: Readonly<Record<string, number>>;
  regularSeasonWeeks: number;
  provenance: ByeProvenance;
}

export interface UnavailableByeSchedule {
  status: "unavailable";
  /** Null when we could not even establish which season to ask for. */
  season: number | null;
  reason: ByeScheduleFailure;
  /** Operator-facing detail. Never contains secrets. */
  detail: string;
  provenance: Partial<ByeProvenance>;
}

export type ByeSchedule = VerifiedByeSchedule | UnavailableByeSchedule;

export interface ScheduleGame {
  season: number;
  gameType: string;
  week: number;
  awayTeam: string;
  homeTeam: string;
}

function unavailable(
  season: number | null,
  reason: ByeScheduleFailure,
  detail: string,
  provenance: Partial<ByeProvenance> = {}
): UnavailableByeSchedule {
  return { status: "unavailable", season, reason, detail, provenance };
}

/**
 * Parse nflverse games.csv, keeping only REG rows for `season`. The layout has no
 * quoted/embedded commas in the columns we read (mirrors parseSnapCounts), but we
 * resolve columns by header name so an upstream column reorder cannot silently
 * shift the data.
 */
export function parseScheduleCsv(csv: string, season: number): ScheduleGame[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",");
  const iSeason = header.indexOf("season");
  const iType = header.indexOf("game_type");
  const iWeek = header.indexOf("week");
  const iAway = header.indexOf("away_team");
  const iHome = header.indexOf("home_team");
  if (iSeason < 0 || iType < 0 || iWeek < 0 || iAway < 0 || iHome < 0) return [];

  const games: ScheduleGame[] = [];
  const wanted = String(season);
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i]!.split(",");
    if (c[iSeason] !== wanted) continue;
    if ((c[iType] ?? "") !== "REG") continue;
    const week = Number(c[iWeek]);
    if (!Number.isFinite(week)) continue;
    const away = normalizeTeamCode(c[iAway]);
    const home = normalizeTeamCode(c[iHome]);
    if (!away || !home) continue;
    games.push({ season, gameType: "REG", week, awayTeam: away, homeTeam: home });
  }
  return games;
}

/**
 * Derive one bye week per team from a season's regular-season games, validating
 * the result hard enough that a partial or malformed schedule can never be served
 * as fact. Rejects: unknown/extra teams, missing teams, out-of-range weeks, and
 * any team without exactly one off week.
 */
export function deriveByeWeeks(
  games: readonly ScheduleGame[],
  season: number,
  provenance: ByeProvenance
): ByeSchedule {
  if (games.length === 0) {
    return unavailable(
      season,
      "schedule-not-published",
      `no regular-season games found for ${season}`,
      provenance
    );
  }

  const weeksByTeam = new Map<string, Set<number>>();
  let maxWeek = 0;
  const unknownTeams = new Set<string>();

  for (const g of games) {
    if (g.week > maxWeek) maxWeek = g.week;
    for (const team of [g.awayTeam, g.homeTeam]) {
      if (!NFL_TEAM_SET.has(team)) {
        unknownTeams.add(team);
        continue;
      }
      const set = weeksByTeam.get(team) ?? new Set<number>();
      set.add(g.week);
      weeksByTeam.set(team, set);
    }
  }

  if (unknownTeams.size > 0) {
    return unavailable(
      season,
      "incomplete-coverage",
      `unrecognised team code(s): ${[...unknownTeams].sort().join(", ")}`,
      provenance
    );
  }

  if (maxWeek < MIN_REG_WEEKS || maxWeek > MAX_REG_WEEKS) {
    return unavailable(
      season,
      "invalid-week",
      `regular season spans ${maxWeek} weeks, expected ${MIN_REG_WEEKS}-${MAX_REG_WEEKS}`,
      provenance
    );
  }

  const missing = NFL_TEAMS.filter((t) => !weeksByTeam.has(t));
  if (missing.length > 0) {
    return unavailable(
      season,
      "incomplete-coverage",
      `missing ${missing.length} team(s): ${missing.join(", ")}`,
      provenance
    );
  }

  const byes: Record<string, number> = {};
  const anomalies: string[] = [];
  for (const team of NFL_TEAMS) {
    const played = weeksByTeam.get(team)!;
    const off: number[] = [];
    for (let w = 1; w <= maxWeek; w += 1) if (!played.has(w)) off.push(w);
    if (off.length !== 1) {
      anomalies.push(`${team}:[${off.join(",")}]`);
      continue;
    }
    byes[team] = off[0]!;
  }

  if (anomalies.length > 0) {
    return unavailable(
      season,
      "incomplete-coverage",
      `team(s) without exactly one bye: ${anomalies.join(" ")}`,
      provenance
    );
  }

  return {
    status: "verified",
    season,
    byes,
    regularSeasonWeeks: maxWeek,
    provenance
  };
}

/**
 * Fetch and derive the bye schedule for `season`. Any transport, parse, or
 * validation failure yields a structured `unavailable` — never a fallback table.
 */
export async function fetchByeSchedule(
  season: number,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<ByeSchedule> {
  const provenance: ByeProvenance = {
    source: "nflverse nfldata games.csv (CC-BY)",
    sourceUrl: NFLVERSE_GAMES_URL,
    retrievedAt: now().toISOString(),
    derivation: "bye = the single regular-season week in which a team has no scheduled game"
  };

  let csv: string;
  try {
    const res = await fetcher(NFLVERSE_GAMES_URL);
    if (!res.ok) {
      return unavailable(season, "source-unavailable", `HTTP ${res.status} from nflverse`, provenance);
    }
    csv = await res.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error";
    return unavailable(season, "source-unavailable", message, provenance);
  }

  const games = parseScheduleCsv(csv, season);
  if (games.length === 0) {
    // Distinguish "we cannot read this file at all" from "this season is not out
    // yet" — the first is an integration break, the second is normal in spring.
    const header = csv.trim().split(/\r?\n/, 1)[0] ?? "";
    const parseable = header.includes("season") && header.includes("game_type");
    return parseable
      ? unavailable(season, "schedule-not-published", `nflverse has no REG rows for ${season}`, provenance)
      : unavailable(season, "source-unparseable", "unexpected CSV header from nflverse", provenance);
  }

  return deriveByeWeeks(games, season, provenance);
}

/** Human-readable, non-secret explanation for the UI and operational logs. */
export function describeByeUnavailability(result: UnavailableByeSchedule): string {
  const season = result.season ?? "unknown";
  switch (result.reason) {
    case "season-unresolved":
      return "Bye-week alerts are paused: the current NFL season could not be confirmed.";
    case "source-unavailable":
      return `Bye-week alerts are paused: the ${season} schedule source is unreachable.`;
    case "source-unparseable":
      return `Bye-week alerts are paused: the ${season} schedule source returned an unreadable format.`;
    case "schedule-not-published":
      return `Bye-week alerts are paused: the ${season} NFL schedule has not been published yet.`;
    case "incomplete-coverage":
      return `Bye-week alerts are paused: the ${season} schedule is incomplete.`;
    case "invalid-week":
      return `Bye-week alerts are paused: the ${season} schedule failed validation.`;
    case "season-mismatch":
      return `Bye-week alerts are paused: the available schedule is not for the ${season} season.`;
    default:
      return "Bye-week alerts are paused: the schedule could not be verified.";
  }
}
