import { fetchWithEnvelope, type Fetcher } from "../http";
import { RAEEnvelopeSchema, unavailableSource, type RAEEnvelope } from "../governance";
import { fixtureEnvelope } from "../fixtures";
import {
  SleeperPlayersMapSchema,
  SleeperTrendingListSchema,
  type SleeperPlayer,
  type SleeperPlayersMap
} from "./schemas";
import { getLatestPlayersSnapshot } from "./snapshot";

export const SLEEPER_BASE = "https://api.sleeper.app";
export const SLEEPER_PLAYERS_URL = `${SLEEPER_BASE}/v1/players/nfl`;

const PLAYERS_TTL = 86_400;
const TRENDING_TTL = 1_800;
const SLEEPER_HEADSHOT = "https://sleepercdn.com/content/nfl/players/thumb";

export interface LoadRAEEnvelopeOptions {
  allowFixtures?: boolean;
  fetcher?: Fetcher;
  /** If true, skip the DB snapshot and always fetch live. Tests should leave this false. */
  forceLive?: boolean;
}

const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000; // 36h — daily cron is 24h cadence + buffer.

export async function loadRAEEnvelope(options: LoadRAEEnvelopeOptions = {}): Promise<RAEEnvelope> {
  // Tests pass `fetcher` to mock the network; in that path we never touch the DB.
  if (!options.fetcher && !options.forceLive) {
    try {
      const snapshot = await getLatestPlayersSnapshot();
      if (snapshot) {
        const ageMs = Date.now() - snapshot.fetchedAt.getTime();
        if (ageMs <= SNAPSHOT_MAX_AGE_MS) {
          if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
          return {
            mode: "unavailable",
            generatedAt: new Date().toISOString(),
            records: [],
            sourceState: {
              source: "Sleeper players snapshot",
              fetchedAt: snapshot.fetchedAt.toISOString(),
              ttlSeconds: PLAYERS_TTL,
              freshness: "fresh",
              confidence: 0.9,
              validation: "valid",
              missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"],
              assumptions: [
                "Snapshot stored by daily cron from Sleeper public players API.",
                "RAE refuses to fabricate market intelligence from identity records alone."
              ],
              failure: null
            }
          };
        }
      }
    } catch {
      // DB unavailable in dev without setup — fall through to live fetch.
    }
  }

  const { data, source } = await fetchWithEnvelope({
    url: SLEEPER_PLAYERS_URL,
    schema: SleeperPlayersMapSchema,
    source: "Sleeper public players API",
    ttlSeconds: PLAYERS_TTL,
    fetcher: options.fetcher,
    init: { next: { revalidate: PLAYERS_TTL } } as RequestInit,
    assumptions: [
      "Sleeper player identity data is available, but behavioral-market metrics require additional adapters or uploaded datasets.",
      "RAE refuses to fabricate market intelligence from identity records alone."
    ],
    missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"]
  });

  if (!data) {
    if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
    return {
      mode: "unavailable",
      generatedAt: new Date().toISOString(),
      records: [],
      sourceState: source.freshness === "unavailable" ? source : unavailableSource(source.source, source.failure ?? "no records")
    };
  }

  if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
  return {
    mode: "unavailable",
    generatedAt: new Date().toISOString(),
    records: [],
    sourceState: {
      ...source,
      freshness: "missing",
      missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"],
      failure: "Sleeper provides identity only; behavioral-market metrics not derived from identity."
    }
  };
}

export async function fetchSleeperPlayersMap(fetcher?: Fetcher): Promise<{ players: SleeperPlayersMap | null; source: ReturnType<typeof unavailableSource> | Awaited<ReturnType<typeof fetchWithEnvelope>>["source"] }> {
  const result = await fetchWithEnvelope({
    url: SLEEPER_PLAYERS_URL,
    schema: SleeperPlayersMapSchema,
    source: "Sleeper public players API",
    ttlSeconds: PLAYERS_TTL,
    fetcher,
    init: { next: { revalidate: PLAYERS_TTL } } as RequestInit
  });
  return { players: result.data, source: result.source };
}

export type TrendingType = "add" | "drop";

export async function getTrendingPlayers(
  type: TrendingType = "add",
  lookbackHours = 24,
  limit = 25,
  fetcher?: Fetcher
) {
  const url = `${SLEEPER_BASE}/v1/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`;
  return fetchWithEnvelope({
    url,
    schema: SleeperTrendingListSchema,
    source: `Sleeper trending ${type}`,
    ttlSeconds: TRENDING_TTL,
    fetcher
  });
}

export function sleeperHeadshotUrl(playerId: string): string {
  return `${SLEEPER_HEADSHOT}/${playerId}.jpg`;
}

export function sleeperFullName(player: SleeperPlayer): string {
  if (player.full_name && player.full_name.trim().length > 0) return player.full_name;
  const parts = [player.first_name, player.last_name].filter((p): p is string => Boolean(p && p.length));
  return parts.length ? parts.join(" ") : (player.player_id ?? "Unknown");
}
