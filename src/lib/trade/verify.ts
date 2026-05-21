import { getLeague } from "../sleeper/league";
import { parseSleeperFormat, parseEspnFormat, type LeagueFormat } from "./format";

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
 * ESPN settings verification is wired through the existing ESPN client by the
 * caller, which passes the already-fetched `mSettings` payload as `espnSettings`.
 */
export async function verifyLeague(input: {
  platform: "sleeper" | "espn";
  externalLeagueId: string;
  espnSettings?: unknown;
}): Promise<VerifyResult> {
  if (input.platform === "sleeper") {
    const envelope = await getLeague(input.externalLeagueId);
    if (envelope.source.failure || !envelope.data) {
      return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
    }
    return interpretSleeperLeague(envelope.data);
  }
  return interpretEspnLeague(input.espnSettings);
}
