import type { PlayerMarketRecord } from "../governance";
import { espnPlayerToRecord, sleeperPlayerToRecord } from "../normalize";
import { getLeagueCredentials, getLeagueForUser, type LeagueRecord, type DecryptedCredentials } from "../leagues";
import { EspnClient } from "../espn/client";
import { getLeague as getEspnLeague } from "../espn/league";
import {
  getLeague as getSleeperLeague,
  getLeagueUsers as getSleeperUsers,
  getRosters as getSleeperRosters
} from "../sleeper/league";
import { getLatestPlayersSnapshot } from "../sleeper/snapshot";
import type { SleeperPlayersMap, SleeperRoster } from "../sleeper/schemas";
import type { EspnTeam } from "../espn/schemas";
import { unavailableSource, type SourceMeta } from "../governance";
import { parseEspnFormat, parseSleeperFormat, type LeagueFormat } from "../trade/format";
import { getDb, type Db } from "../../db";

export interface LiveLeagueSnapshot {
  league: LeagueRecord;
  /** Roster records for every team in the league. Empty when the source is unavailable. */
  allRosters: PlayerMarketRecord[][];
  /** The user's own team's roster, when identifiable. */
  myRoster: PlayerMarketRecord[];
  source: SourceMeta;
  failure: string | null;
  /**
   * The league's parsed format settings (scoring, starter slots, trade
   * deadline, playoff weeks). Null when the upstream payload was missing or
   * malformed enough that parseSleeperFormat / parseEspnFormat fell back to
   * defaults — null lets the UI render "Connect a league to audit settings"
   * rather than 12-team-PPR defaults that wouldn't match the user's league.
   */
  format: LeagueFormat | null;
  /**
   * The user's own roster's FAAB budget remaining as a ratio of total budget
   * (0..1). Null when the league doesn't use FAAB, when the values cannot be
   * extracted from the upstream payload, or when the platform doesn't expose
   * the field (ESPN). Consumed by the lifecycle cron's FAAB-depleted rule.
   */
  myFaabRemainingRatio: number | null;
}

/**
 * Pure helper — extract the user's FAAB-remaining ratio (0..1) from Sleeper's
 * league + roster settings. Returns null when the league isn't FAAB-style
 * (waiver_type 0 = rolling, 1 = reverse standings), when the total budget is
 * missing or non-positive, when the per-roster `waiver_budget_used` is absent,
 * or when the computed ratio falls outside [0, 1] (which would indicate
 * upstream corruption rather than a real condition).
 *
 * Exported so it can be unit-tested without spinning up a Sleeper fetch.
 */
export function extractSleeperFaabRatio(
  leagueSettings: Record<string, unknown> | null | undefined,
  rosterSettings: Record<string, unknown> | null | undefined
): number | null {
  if (!leagueSettings || !rosterSettings) return null;
  const totalRaw = leagueSettings.waiver_budget;
  const usedRaw = rosterSettings.waiver_budget_used;
  const total = typeof totalRaw === "number" ? totalRaw : null;
  const used = typeof usedRaw === "number" ? usedRaw : 0; // Sleeper omits this when 0
  if (total === null || total <= 0) return null;
  const remaining = total - used;
  if (remaining < 0 || remaining > total) return null;
  return remaining / total;
}

// ---------------------------------------------------------------------------
// Pure team-identification helpers (exported so they can be unit-tested)
// ---------------------------------------------------------------------------

/**
 * Resolve the Sleeper roster_id for the given username. Looks up the user in
 * the league-users list by matching `display_name` or `username` (case-
 * insensitive), then finds the roster that has that `owner_id`.
 *
 * Returns `null` when the username is blank or no match is found — callers
 * should fall back to roster 0 and log a warning.
 */
export function resolveSleeperRosterId(
  users: ReadonlyArray<{ user_id: string; username?: string | null; display_name?: string | null }>,
  rosters: ReadonlyArray<{ roster_id: number; owner_id: string | null }>,
  username: string | null | undefined
): number | null {
  if (!username) return null;
  const lower = username.toLowerCase();
  const match = users.find(
    (u) =>
      (u.username?.toLowerCase() ?? "") === lower ||
      (u.display_name?.toLowerCase() ?? "") === lower
  );
  if (!match) return null;
  const roster = rosters.find((r) => r.owner_id === match.user_id);
  return roster?.roster_id ?? null;
}

/**
 * Resolve the ESPN team for the given SWID. ESPN's `mTeam` view includes a
 * top-level `members` array; each member has an `id` (the braced SWID) and an
 * `isLeagueManager` flag. The team object itself contains a `primaryOwner`
 * string (SWID) and/or `owners` array of SWIDs.
 *
 * We normalise the SWID to the braced form (`{...}`) before comparing so that
 * bare and braced values both match.
 *
 * Returns the matched team, or `null` when no match is found (caller falls
 * back to the first team).
 */
export function resolveEspnTeam(
  teams: ReadonlyArray<EspnTeam & { primaryOwner?: string | null; owners?: string[] | null }>,
  swid: string | null | undefined
): (EspnTeam & { primaryOwner?: string | null; owners?: string[] | null }) | null {
  if (!swid) return null;
  const normalised = normaliseSWID(swid);
  for (const team of teams) {
    // Check primaryOwner field
    if (team.primaryOwner && normaliseSWID(team.primaryOwner) === normalised) return team;
    // Check owners array (some ESPN responses use this instead)
    if (team.owners?.some((o) => normaliseSWID(o) === normalised)) return team;
  }
  return null;
}

function normaliseSWID(swid: string): string {
  const t = swid.trim();
  if (t.startsWith("{") && t.endsWith("}")) return t.toUpperCase();
  return `{${t.toUpperCase()}}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Server-only. Decrypts league credentials once, calls the right adapter, and
 * returns the user's roster + every roster in the league, normalized into
 * `PlayerMarketRecord`s. Used by the league-refresh route AND the lifecycle
 * cron so the rules engine sees real data.
 */
export async function fetchLeagueLive(
  userId: string,
  leagueId: string,
  db: Db = getDb()
): Promise<LiveLeagueSnapshot | null> {
  const league = await getLeagueForUser(db, userId, leagueId);
  if (!league) return null;

  if (league.platform === "sleeper") {
    return fetchSleeperLive(league);
  }

  // Decrypt credentials exactly once and pass the value down.
  const creds = await getLeagueCredentials(db, league.id);
  if (!creds) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: unavailableSource(`ESPN league ${league.externalLeagueId}`, "missing credentials"),
      failure: "missing credentials",
      format: null,
      myFaabRemainingRatio: null
    };
  }
  return fetchEspnLive(league, creds);
}

async function fetchSleeperLive(league: LeagueRecord): Promise<LiveLeagueSnapshot> {
  const [info, rosters, users, snapshot] = await Promise.all([
    getSleeperLeague(league.externalLeagueId),
    getSleeperRosters(league.externalLeagueId),
    getSleeperUsers(league.externalLeagueId),
    getLatestPlayersSnapshot()
  ]);

  // Parse format from whatever league info we got — even when rosters/snapshot
  // are missing, the format is useful so PreDraftAudit can audit settings on
  // a freshly-added pre-draft league that doesn't have rosters yet.
  const format = info.data ? parseSleeperFormat(info.data) : null;

  if (!info.data || !rosters.data || rosters.data.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: info.source.freshness === "unavailable" ? info.source : rosters.source,
      failure: info.source.failure ?? rosters.source.failure ?? "no rosters returned",
      format,
      myFaabRemainingRatio: null
    };
  }
  if (!snapshot) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: unavailableSource(
        `Sleeper league ${league.externalLeagueId}`,
        "no players snapshot — run /api/cron/players-refresh first"
      ),
      failure: "no players snapshot",
      format,
      myFaabRemainingRatio: null
    };
  }

  const playersMap: SleeperPlayersMap = snapshot.players;
  const sleeperRosters: SleeperRoster[] = rosters.data;
  const leagueUsers = users.data ?? [];

  // Resolve the user's roster_id via stored Sleeper username; fall back to
  // the first roster when the username is absent or unresolvable.
  const myTeamId =
    resolveSleeperRosterId(leagueUsers, sleeperRosters, league.sleeperUsername) ??
    sleeperRosters[0]?.roster_id ??
    null;

  const allRosters = sleeperRosters.map((r) =>
    materializeSleeperRoster(r, playersMap, league)
  );
  const myRosterRow = sleeperRosters.find((r) => r.roster_id === myTeamId);
  const myRoster = myRosterRow
    ? materializeSleeperRoster(myRosterRow, playersMap, league)
    : [];

  const myFaabRemainingRatio = myRosterRow
    ? extractSleeperFaabRatio(
        info.data.settings ?? null,
        myRosterRow.settings ?? null
      )
    : null;

  return {
    league,
    allRosters,
    myRoster,
    source: rosters.source,
    failure: null,
    format,
    myFaabRemainingRatio
  };
}

function materializeSleeperRoster(
  roster: SleeperRoster,
  playersMap: SleeperPlayersMap,
  league: LeagueRecord
): PlayerMarketRecord[] {
  const ids = roster.players ?? [];
  const records: PlayerMarketRecord[] = [];
  for (const id of ids) {
    const player = playersMap[id];
    if (!player) continue;
    const record = sleeperPlayerToRecord(id, player, {
      source: {
        source: `Sleeper roster ${league.externalLeagueId}`,
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 120,
        freshness: "fresh",
        confidence: 0.85,
        validation: "valid",
        missingFields: [],
        assumptions: ["Sleeper identity + roster; no market metrics."],
        failure: null
      }
    });
    if (record) records.push(record);
  }
  return records;
}

async function fetchEspnLive(
  league: LeagueRecord,
  creds: DecryptedCredentials
): Promise<LiveLeagueSnapshot> {
  const client = new EspnClient({ credentials: creds });
  const result = await getEspnLeague(
    client,
    { leagueId: league.externalLeagueId, season: league.season },
    ["mTeam", "mRoster", "mSettings"]
  );

  // Parse format from mSettings even when teams are missing; PreDraftAudit
  // can still surface scoring + starter slots on a fresh pre-draft league.
  const format = result.data?.settings ? parseEspnFormat(result.data.settings) : null;

  if (!result.data || !result.data.teams || result.data.teams.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: result.source,
      failure: result.source.failure ?? "no teams returned",
      format,
      myFaabRemainingRatio: null
    };
  }

  const baseSource = {
    source: `ESPN league ${league.externalLeagueId}`,
    fetchedAt: new Date().toISOString(),
    ttlSeconds: 300,
    freshness: "fresh" as const,
    confidence: 0.85,
    validation: "valid" as const,
    missingFields: [],
    assumptions: ["ESPN identity + roster; no market metrics."],
    failure: null
  };

  // ESPN `mTeam` data returns teams with `primaryOwner` / `owners` fields
  // containing the SWID of the owner(s). Match the user's SWID (from the
  // decrypted credentials — already available in `creds`) to find their team.
  type EspnTeamWithOwner = EspnTeam & { primaryOwner?: string | null; owners?: string[] | null };
  const espnTeams = result.data.teams as EspnTeamWithOwner[];

  const allRosters: PlayerMarketRecord[][] = espnTeams.map((team) => {
    const entries = team.roster?.entries ?? [];
    const records: PlayerMarketRecord[] = [];
    for (const entry of entries) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;
      const record = espnPlayerToRecord(player, { source: baseSource });
      if (record) records.push(record);
    }
    return records;
  });

  // Resolve the user's team via SWID. Fall back to the first team if the SWID
  // doesn't match any team (e.g. co-commissioner viewing another user's data).
  const myTeam = resolveEspnTeam(espnTeams, creds.swid);
  const myTeamIndex = myTeam ? espnTeams.indexOf(myTeam) : 0;
  const myRoster = allRosters[myTeamIndex] ?? [];

  return {
    league,
    allRosters,
    myRoster,
    source: result.source,
    failure: null,
    format,
    // ESPN: FAAB extraction not yet wired. Their settings live under
    // settings.acquisitionSettings.acquisitionBudget + teamData.waiverRank;
    // separate ticket once an ESPN-FAAB league is available to fixture-pin.
    myFaabRemainingRatio: null
  };
}
