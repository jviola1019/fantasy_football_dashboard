import { z } from "zod";
import { evaluateFreshness, unavailableSource, type SourceMeta } from "./governance";

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
        return {
          data: null,
          source: unavailableSource(opts.source, `HTTP ${response.status} from ${opts.url}`)
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
      lastError = error instanceof Error ? error.message : "unknown fetch error";
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
