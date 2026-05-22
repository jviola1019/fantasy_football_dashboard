import { getLeague as getSleeperLeague } from "../sleeper/league";
import { getLeague as getEspnLeague } from "../espn/league";
import { EspnClient } from "../espn/client";
import { parseSleeperFormat, parseEspnFormat, type LeagueFormat } from "./format";
import { resolveEspnTeam } from "../leagues/fetchLive";

export type VerifyResult =
  | { ok: true; format: LeagueFormat; resolvedLabel: string }
  | { ok: false; error: string };

/** Pure interpreter for a Sleeper getLeague payload. */
export function interpretSleeperLeague(league: unknown): VerifyResult {
  if (!league || typeof league !== "object") {
    return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
  }
  const name = (league as Record<string, unknown>).name;
  return {
    ok: true,
    format: parseSleeperFormat(league),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "Sleeper league"
  };
}

/** Pure interpreter for an ESPN mSettings payload. */
export function interpretEspnLeague(settings: unknown): VerifyResult {
  if (!settings || typeof settings !== "object") {
    return { ok: false, error: "ESPN league not reachable. Check the league ID and cookies." };
  }
  const name = (settings as Record<string, unknown>).name;
  return {
    ok: true,
    format: parseEspnFormat(settings),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "ESPN league"
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
