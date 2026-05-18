import { fetchWithEnvelope, type Fetcher } from "../http";
import { SLEEPER_BASE } from "./players";
import {
  SleeperDraftSchema,
  SleeperDraftListSchema,
  SleeperDraftPickListSchema,
  SleeperTradedPickListSchema
} from "./schemas";

const DRAFT_LIST_TTL = 300;
const DRAFT_PICKS_TTL = 30;

export function getLeagueDrafts(leagueId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/league/${encodeURIComponent(leagueId)}/drafts`,
    schema: SleeperDraftListSchema,
    source: "Sleeper league drafts",
    ttlSeconds: DRAFT_LIST_TTL,
    fetcher
  });
}

export function getUserDrafts(userId: string, season: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/user/${encodeURIComponent(userId)}/drafts/nfl/${encodeURIComponent(season)}`,
    schema: SleeperDraftListSchema,
    source: "Sleeper user drafts",
    ttlSeconds: DRAFT_LIST_TTL,
    fetcher
  });
}

export function getDraft(draftId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/draft/${encodeURIComponent(draftId)}`,
    schema: SleeperDraftSchema,
    source: "Sleeper draft",
    ttlSeconds: DRAFT_LIST_TTL,
    fetcher
  });
}

export function getDraftPicks(draftId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/draft/${encodeURIComponent(draftId)}/picks`,
    schema: SleeperDraftPickListSchema,
    source: "Sleeper draft picks",
    ttlSeconds: DRAFT_PICKS_TTL,
    fetcher
  });
}

export function getDraftTradedPicks(draftId: string, fetcher?: Fetcher) {
  return fetchWithEnvelope({
    url: `${SLEEPER_BASE}/v1/draft/${encodeURIComponent(draftId)}/traded_picks`,
    schema: SleeperTradedPickListSchema,
    source: "Sleeper draft traded picks",
    ttlSeconds: DRAFT_LIST_TTL,
    fetcher
  });
}
