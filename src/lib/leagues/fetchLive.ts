import type { PlayerMarketRecord } from "../governance";
import { espnPlayerToRecord, sleeperPlayerToRecord } from "../normalize";
import { getLeagueCredentials, getLeagueForUser, type LeagueRecord } from "../leagues";
import { EspnClient } from "../espn/client";
import { getLeague as getEspnLeague } from "../espn/league";
import {
  getLeague as getSleeperLeague,
  getLeagueUsers as getSleeperUsers,
  getRosters as getSleeperRosters
} from "../sleeper/league";
import { getLatestPlayersSnapshot } from "../sleeper/snapshot";
import type { SleeperPlayersMap, SleeperRoster } from "../sleeper/schemas";
import { unavailableSource, type SourceMeta } from "../governance";
import { getDb, type Db } from "../../db";

export interface LiveLeagueSnapshot {
  league: LeagueRecord;
  /** Roster records for every team in the league. Empty when the source is unavailable. */
  allRosters: PlayerMarketRecord[][];
  /** The user's own team's roster, when identifiable. */
  myRoster: PlayerMarketRecord[];
  source: SourceMeta;
  failure: string | null;
}

/**
 * Server-only. Decrypts league credentials, calls the right adapter, and
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

  const creds = await getLeagueCredentials(db, league.id);
  if (!creds) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: unavailableSource(`ESPN league ${league.externalLeagueId}`, "missing credentials"),
      failure: "missing credentials"
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

  if (!info.data || !rosters.data || rosters.data.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: info.source.freshness === "unavailable" ? info.source : rosters.source,
      failure: info.source.failure ?? rosters.source.failure ?? "no rosters returned"
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
      failure: "no players snapshot"
    };
  }

  const playersMap: SleeperPlayersMap = snapshot.players;
  const sleeperRosters: SleeperRoster[] = rosters.data;
  const myTeamId = identifyMyTeam(sleeperRosters, users.data ?? [], league);

  const allRosters = sleeperRosters.map((r) =>
    materializeSleeperRoster(r, playersMap, league)
  );
  const myRosterRow = sleeperRosters.find((r) => r.roster_id === myTeamId);
  const myRoster = myRosterRow
    ? materializeSleeperRoster(myRosterRow, playersMap, league)
    : [];

  return {
    league,
    allRosters,
    myRoster,
    source: rosters.source,
    failure: null
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

function identifyMyTeam(
  rosters: SleeperRoster[],
  users: ReadonlyArray<{ user_id: string }>,
  league: LeagueRecord
): number | null {
  // No reliable mapping today between RAE userId and Sleeper user_id — the
  // /settings/leagues form does not capture the Sleeper username. As a
  // pragmatic default, treat the first roster as "mine" so the lifecycle rules
  // have something to score. The follow-up is to store sleeper_user_id when a
  // user adds a league.
  void users;
  void league;
  return rosters[0]?.roster_id ?? null;
}

async function fetchEspnLive(
  league: LeagueRecord,
  creds: { espnS2: string; swid: string }
): Promise<LiveLeagueSnapshot> {
  const client = new EspnClient({ credentials: creds });
  const result = await getEspnLeague(
    client,
    { leagueId: league.externalLeagueId, season: league.season },
    ["mTeam", "mRoster", "mSettings"]
  );

  if (!result.data || !result.data.teams || result.data.teams.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      source: result.source,
      failure: result.source.failure ?? "no teams returned"
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

  const allRosters: PlayerMarketRecord[][] = result.data.teams.map((team) => {
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

  // As above: no reliable mapping between RAE userId and ESPN ownerId yet.
  // Default to the first team.
  const myRoster = allRosters[0] ?? [];

  return {
    league,
    allRosters,
    myRoster,
    source: result.source,
    failure: null
  };
}
