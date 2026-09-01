import { getLeague as getSleeperLeague } from "../sleeper/league";
import { getLeague as getEspnLeague } from "../espn/league";
import { EspnClient } from "../espn/client";
import { parseSleeperFormat, parseEspnFormat, type LeagueFormat } from "./format";
import { resolveEspnTeam } from "../leagues/fetchLive";

export type VerifyResult =
  | {
      ok: true;
      format: LeagueFormat;
      resolvedLabel: string;
      /**
       * The season the PLATFORM says this league belongs to.
       *
       * The add form asks for a season, and on Sleeper that question has no
       * answer the user can get wrong safely: a league id belongs to exactly one
       * season and a renewal gets a NEW id, chained by `previous_league_id`. So
       * a typed season is a guess about something the payload already states.
       *
       * Storing the guess made every season-keyed lookup — weekly projections,
       * season stats snapshots, the season mirror — able to disagree with the
       * league itself, and let the same league be added once per season typed,
       * each row looking like a different league. `null` when the platform did
       * not declare one, in which case the typed value is all there is and is
       * used as such.
       */
      resolvedSeason: number | null;
    }
  | { ok: false; error: string };

/** RAE ranks NFL players. Sleeper hosts other sports behind the same endpoint. */
const SUPPORTED_SLEEPER_SPORT = "nfl";

function seasonNumber(raw: unknown): number | null {
  // Sleeper sends a string ("2026"); ESPN sends a number. Both are accepted,
  // and anything outside a plausible fantasy-football range is treated as
  // undeclared rather than trusted.
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= 2010 && n <= 2099 ? n : null;
}

/** Pure interpreter for a Sleeper getLeague payload. */
export function interpretSleeperLeague(league: unknown): VerifyResult {
  if (!league || typeof league !== "object") {
    return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
  }
  const l = league as Record<string, unknown>;

  // Sleeper serves basketball and esports leagues from the SAME endpoint with
  // the same payload shape, so an NBA league id parses cleanly into a
  // "LeagueFormat" and every downstream surface then ranks NFL players against
  // an NBA lineup. Nothing further down could detect that, which is exactly
  // why it is rejected at the boundary.
  const sport = typeof l.sport === "string" ? l.sport.toLowerCase() : null;
  if (sport && sport !== SUPPORTED_SLEEPER_SPORT) {
    return {
      ok: false,
      error: `That Sleeper league is a ${sport.toUpperCase()} league. RAE only supports NFL fantasy football.`
    };
  }

  const name = l.name;
  return {
    ok: true,
    format: parseSleeperFormat(league),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "Sleeper league",
    resolvedSeason: seasonNumber(l.season)
  };
}

/** Pure interpreter for an ESPN mSettings payload. */
export function interpretEspnLeague(settings: unknown): VerifyResult {
  if (!settings || typeof settings !== "object") {
    return { ok: false, error: "ESPN league not reachable. Check the league ID and cookies." };
  }
  const s = settings as Record<string, unknown>;
  const name = s.name;
  return {
    ok: true,
    format: parseEspnFormat(settings),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "ESPN league",
    resolvedSeason: seasonNumber(s.seasonId)
  };
}

/**
 * Verify a league exists and derive its format. Sleeper uses the public API;
 * ESPN fetches the `mSettings` view with the user's espn_s2 + SWID cookies.
 */
export async function verifyLeague(input: {
  platform: "sleeper" | "espn";
  externalLeagueId: string;
  season: number;
  credentials?: { espnS2: string; swid: string };
}): Promise<VerifyResult> {
  if (input.platform === "sleeper") {
    const envelope = await getSleeperLeague(input.externalLeagueId);
    if (envelope.source.failure || !envelope.data) {
      return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
    }
    return interpretSleeperLeague(envelope.data);
  }
  if (!input.credentials) {
    return { ok: false, error: "ESPN leagues require espn_s2 and SWID cookies." };
  }
  const client = new EspnClient({ credentials: input.credentials });
  // Fetch mSettings for format detection and mTeam to confirm ownership.
  const result = await getEspnLeague(
    client,
    { leagueId: input.externalLeagueId, season: input.season },
    ["mSettings", "mTeam"]
  );
  if (result.source.failure || !result.data) {
    return {
      ok: false,
      error: "ESPN league not reachable. Check the league ID, season, and espn_s2/SWID cookies."
    };
  }

  // Confirm the user's SWID owns a team in this league. If `teams` is absent
  // (e.g. a public league that only returns settings) we skip the ownership
  // check to avoid a false negative.
  const teams = result.data.teams;
  if (teams && teams.length > 0) {
    type TeamWithOwner = (typeof teams)[number] & { primaryOwner?: string | null; owners?: string[] | null };
    const owned = resolveEspnTeam(teams as TeamWithOwner[], input.credentials.swid);
    if (!owned) {
      return {
        ok: false,
        error:
          "Your SWID does not match any team owner in this ESPN league. " +
          "Check the league ID and that the espn_s2/SWID cookies belong to a member of this league."
      };
    }
  }

  return interpretEspnLeague(result.data.settings);
}
