import { fetchWithEnvelope, type Fetcher } from "../http";
import { SLEEPER_BASE } from "./players";
import { SleeperDraftSchema, SleeperDraftPickListSchema } from "./schemas";

const DRAFT_LIST_TTL = 300;
const DRAFT_PICKS_TTL = 30;

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
