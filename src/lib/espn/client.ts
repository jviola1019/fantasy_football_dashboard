import { z } from "zod";
import { fetchWithEnvelope, type Fetcher } from "../http";

export const ESPN_FANTASY_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
export const ESPN_NEWS_BASE = "https://site.api.espn.com/apis/fantasy/v3/games/ffl";

export interface EspnCredentials {
  espnS2: string;
  swid: string;
}

export interface EspnClientOptions {
  credentials?: EspnCredentials;
  fetcher?: Fetcher;
}

export class EspnClient {
  private readonly credentials?: EspnCredentials;
  private readonly fetcher: Fetcher;

  constructor(opts: EspnClientOptions = {}) {
    this.credentials = opts.credentials;
    this.fetcher = opts.fetcher ?? fetch;
  }

  leagueUrl(season: number, leagueId: string, views: string[] = []): string {
    const base =
      season < 2018
        ? `${ESPN_FANTASY_BASE}/leagueHistory/${encodeURIComponent(leagueId)}?seasonId=${season}`
        : `${ESPN_FANTASY_BASE}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}`;
    if (views.length === 0) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${views.map((v) => `view=${encodeURIComponent(v)}`).join("&")}`;
  }

  newsUrl(): string {
    return `${ESPN_NEWS_BASE}/news/players`;
  }

  cookieHeader(): string | undefined {
    if (!this.credentials) return undefined;
    const swid = ensureBraced(this.credentials.swid);
    return `espn_s2=${this.credentials.espnS2}; SWID=${swid}`;
  }

  fetchJson<T>(opts: {
    url: string;
    schema: z.ZodType<T>;
    source: string;
    ttlSeconds: number;
    filter?: Record<string, unknown>;
  }) {
    const headers: Record<string, string> = { accept: "application/json" };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (opts.filter) headers["x-fantasy-filter"] = JSON.stringify(opts.filter);
    return fetchWithEnvelope({
      url: opts.url,
      schema: opts.schema,
      source: opts.source,
      ttlSeconds: opts.ttlSeconds,
      fetcher: this.fetcher,
      // Tells the failure formatter that a 401 here means EXPIRED COOKIES rather
      // than an upstream change — so the user is pointed at the settings page
      // that can actually fix it, instead of being shown a status code.
      credentialed: cookie !== undefined,
      serviceLabel: "ESPN",
      init: { headers, cache: "no-store" }
    });
  }
}

function ensureBraced(swid: string): string {
  const trimmed = swid.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  return `{${trimmed.replace(/^\{|\}$/g, "")}}`;
}
