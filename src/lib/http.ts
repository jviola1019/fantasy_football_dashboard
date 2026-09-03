import { z } from "zod";
import { evaluateFreshness, unavailableSource, type SourceMeta } from "./governance";
import { describeHttpFailure, redactUrls } from "./httpFailure";

export type Fetcher = typeof fetch;

export interface FetchEnvelopeOptions<T> {
  url: string;
  schema: z.ZodType<T>;
  source: string;
  ttlSeconds: number;
  fetcher?: Fetcher;
  init?: RequestInit;
  retries?: number;
  timeoutMs?: number;
  assumptions?: string[];
  missingFields?: string[];
  /**
   * Does this request carry user credentials?
   *
   * Only used to phrase a 401/403: on a credentialed endpoint that status is
   * almost always an expired cookie and the remedy is the user's, while on an
   * anonymous one it is an upstream change and telling somebody to re-paste
   * cookies they never entered would be worse than saying nothing.
   */
  credentialed?: boolean;
  /** Friendly service name for failure text. Defaults to the URL's host. */
  serviceLabel?: string;
}

export interface FetchEnvelopeResult<T> {
  data: T | null;
  source: SourceMeta;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
const BACKOFF_BASE_MS = 250;

export async function fetchWithEnvelope<T>(opts: FetchEnvelopeOptions<T>): Promise<FetchEnvelopeResult<T>> {
  const fetcher = opts.fetcher ?? fetch;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchedAt = new Date().toISOString();

  let lastError = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(opts.url, { ...opts.init, signal: controller.signal });
      clearTimeout(timer);
      if (response.status === 429) {
        lastError = "rate-limited";
        await sleep(backoffMs(attempt, response));
        continue;
      }
      if (response.status >= 500) {
        lastError = `server ${response.status}`;
        await sleep(backoffMs(attempt));
        continue;
      }
      if (!response.ok) {
        // The URL is NOT interpolated. `sourceState.failure` is rendered to the
        // user by GovernancePanel, and an ESPN URL carries the private league id
        // in its path — so this string used to paint that id onto the page and
        // into every screenshot of it.
        return {
          data: null,
          source: unavailableSource(
            opts.source,
            describeHttpFailure(response.status, opts.url, {
              credentialed: opts.credentialed,
              service: opts.serviceLabel
            })
          )
        };
      }
      const raw: unknown = await response.json();
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          data: null,
          source: {
            source: opts.source,
            fetchedAt,
            ttlSeconds: opts.ttlSeconds,
            freshness: "unavailable",
            confidence: 0,
            validation: "invalid",
            missingFields: opts.missingFields ?? [],
            assumptions: opts.assumptions ?? [],
            failure: `schema validation failed: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}:${i.code}`).join(", ")}`
          }
        };
      }
      return {
        data: parsed.data,
        source: {
          source: opts.source,
          fetchedAt,
          ttlSeconds: opts.ttlSeconds,
          freshness: evaluateFreshness(fetchedAt, opts.ttlSeconds),
          confidence: 0.9,
          validation: "valid",
          missingFields: opts.missingFields ?? [],
          assumptions: opts.assumptions ?? [],
          failure: null
        }
      };
    } catch (error) {
      clearTimeout(timer);
      // Node's fetch errors quote the URL back ("request to https://… failed"),
      // and this string is rendered to the user, so it is stripped for the same
      // reason the status path above no longer interpolates it.
      lastError = redactUrls(error instanceof Error ? error.message : "unknown fetch error");
      if (attempt < retries - 1) await sleep(backoffMs(attempt));
    }
  }
  return {
    data: null,
    source: unavailableSource(opts.source, lastError || "exhausted retries")
  };
}

function backoffMs(attempt: number, response?: Response): number {
  if (response) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const parsed = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
    }
  }
  return BACKOFF_BASE_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
