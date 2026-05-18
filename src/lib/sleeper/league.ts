import { fetchWithEnvelope, type Fetcher } from "../http";
import { SLEEPER_BASE } from "./players";
import {
  SleeperLeagueSchema,
  SleeperLeagueListSchema,
  SleeperLeagueUserListSchema,
  SleeperRosterListSchema,
  SleeperMatchupListSchema,
  SleeperTransactionListSchema,
  SleeperTradedPickListSchema,
  SleeperBracketSchema,
  SleeperNflStateSchema,
  SleeperUserSchema
} from "./schemas";

const LEAGUE_TTL = 300;
const ROSTER_TTL = 120;
const MATCHUP_TTL = 60;
const STATE_TTL = 900;

export function getUserByName(username: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/user/${encodeURIComponent(username)}`,
    schema: SleeperUserSchema,
    source: "Sleeper user lookup",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getUserLeagues(userId: string, season: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
    schema: SleeperLeagueListSchema,
    source: "Sleeper user leagues",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getLeague(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}`,
    schema: SleeperLeagueSchema,
    source: "Sleeper league",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getRosters(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/rosters`,
    schema: SleeperRosterListSchema,
    source: "Sleeper league rosters",
    ttlSeconds: ROSTER_TTL,
    fetcher
  });
}

export function getLeagueUsers(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/users`,
    schema: SleeperLeagueUserListSchema,
    source: "Sleeper league users",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getMatchups(leagueId: string, week: number, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    schema: SleeperMatchupListSchema,
    source: "Sleeper matchups",
    ttlSeconds: MATCHUP_TTL,
    fetcher
  });
}

export function getTransactions(leagueId: string, round: number, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/transactions/${round}`,
    schema: SleeperTransactionListSchema,
    source: "Sleeper transactions",
    ttlSeconds: MATCHUP_TTL,
    fetcher
  });
}

export function getTradedPicks(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/traded_picks`,
    schema: SleeperTradedPickListSchema,
    source: "Sleeper traded picks",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getWinnersBracket(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/winners_bracket`,
    schema: SleeperBracketSchema,
    source: "Sleeper winners bracket",
    ttlSeconds: LEAGUE_TTL,
    fetcher
  });
}

export function getNflState(fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/state/nfl`,
    schema: SleeperNflStateSchema,
    source: "Sleeper NFL state",
    ttlSeconds: STATE_TTL,
    fetcher
  });
}
