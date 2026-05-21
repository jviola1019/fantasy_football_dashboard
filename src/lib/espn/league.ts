import { EspnClient } from "./client";
import { EspnLeagueResponseSchema, EspnNewsResponseSchema } from "./schemas";

const LEAGUE_TTL = 300;
const NEWS_TTL = 600;

export interface EspnLeagueRef {
  leagueId: string;
  season: number;
}

export type EspnLeagueView =
  | "mTeam"
  | "mRoster"
  | "mMatchup"
  | "mMatchupScore"
  | "mScoreboard"
  | "mSettings"
  | "mDraftDetail"
  | "kona_player_info"
  | "mPositionalRatings"
  | "mTransactions2";

export function getLeague(client: EspnClient, ref: EspnLeagueRef, views: EspnLeagueView[] = ["mTeam", "mSettings"]) {
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, views),
    schema: EspnLeagueResponseSchema,
    source: `ESPN league ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL
  });
}

export function getRoster(client: EspnClient, ref: EspnLeagueRef) {
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, ["mRoster"]),
    schema: EspnLeagueResponseSchema,
    source: `ESPN roster ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL
  });
}

export function getScoreboard(client: EspnClient, ref: EspnLeagueRef) {
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, ["mMatchupScore", "mScoreboard"]),
    schema: EspnLeagueResponseSchema,
    source: `ESPN scoreboard ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL
  });
}

export function getDraft(client: EspnClient, ref: EspnLeagueRef) {
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, ["mDraftDetail"]),
    schema: EspnLeagueResponseSchema,
    source: `ESPN draft ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL
  });
}

export function getTransactions(client: EspnClient, ref: EspnLeagueRef) {
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, ["mTransactions2"]),
    schema: EspnLeagueResponseSchema,
    source: `ESPN transactions ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL
  });
}

export function getFreeAgents(
  client: EspnClient,
  ref: EspnLeagueRef,
  opts: { week: number; size?: number } = { week: 1 }
) {
  const size = opts.size ?? 50;
  return client.fetchJson({
    url: client.leagueUrl(ref.season, ref.leagueId, ["kona_player_info"]),
    schema: EspnLeagueResponseSchema,
    source: `ESPN free agents ${ref.leagueId} (${ref.season})`,
    ttlSeconds: LEAGUE_TTL,
    filter: {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        limit: size,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
        filterScoringPeriodIds: { value: [opts.week] }
      }
    }
  });
}

export function getNews(client: EspnClient) {
  return client.fetchJson({
    url: client.newsUrl(),
    schema: EspnNewsResponseSchema,
    source: "ESPN fantasy news",
    ttlSeconds: NEWS_TTL
  });
}
