import { fetchWithEnvelope, type Fetcher } from "../http";
import { SLEEPER_BASE } from "./players";
import {
  SleeperLeagueSchema,
  SleeperLeagueUserListSchema,
  SleeperRosterListSchema,
  SleeperTransactionListSchema,
  SleeperNflStateSchema,
} from "./schemas";

const LEAGUE_TTL = 300;
const ROSTER_TTL = 120;
const MATCHUP_TTL = 60;
const STATE_TTL = 900;

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

export function getTransactions(leagueId: string, round: number, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/transactions/${round}`,
    schema: SleeperTransactionListSchema,
    source: "Sleeper transactions",
    ttlSeconds: MATCHUP_TTL,
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
