import {
  KtcSnapshotPayloadSchema,
  type KtcSnapshotPayload,
  type KtcVariant
} from "./types";

// KeepTradeCut serves both ranking pages as plain HTML with the player
// catalog embedded as `playersArray = [...];` on a single line. No JS
// rendering, no API key, no auth. Mirror of the FantasyPros scraper
// pattern in src/lib/fantasypros/scrape.ts so the dual-snapshot crons
// share an architecture.

const VARIANT_TO_URL: Record<KtcVariant, string> = {
  dynasty: "https://keeptradecut.com/dynasty-rankings",
  redraft: "https://keeptradecut.com/fantasy-rankings"
};

// Defaults to a recent Chrome desktop UA. KTC 403s the default Node fetch UA.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Permissive regex - captures the JSON array literal after `playersArray =`
// up to the closing bracket + semicolon. Non-greedy so embedded `}]`
// sequences inside string keys can't terminate the match early.
const PLAYERS_ARRAY_RE = /playersArray\s*=\s*(\[[\s\S]*?\]);/;

export interface FetchKtcOptions {
  variant?: KtcVariant;
  /** Override URL - used by tests to feed fixture HTML. */
  url?: string;
  /** Inject a custom fetcher for tests. */
  fetcher?: typeof fetch;
}

export async function fetchKtcRankings({
  variant = "dynasty",
  url,
  fetcher = fetch
}: FetchKtcOptions = {}): Promise<KtcSnapshotPayload> {
  const target = url ?? VARIANT_TO_URL[variant];
  const response = await fetcher(target, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`KTC ${variant} fetch failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const found = PLAYERS_ARRAY_RE.exec(html);
  if (!found || !found[1]) {
    throw new Error(`KTC ${variant} response did not contain playersArray variable`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(found[1]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`KTC ${variant} playersArray was not valid JSON: ${msg}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`KTC ${variant} playersArray parsed to non-array`);
  }
  // Filter out non-player rows (KTC includes PICK entries for rookie draft
  // picks; those have no Sleeper/ESPN match and would just pollute the
  // matcher). Position "PICK" is the only known sentinel.
  const players = (parsed as Array<Record<string, unknown>>).filter(
    (p) => typeof p.position === "string" && p.position !== "PICK"
  );
  const validated = KtcSnapshotPayloadSchema.safeParse({ variant, players });
  if (!validated.success) {
    const summary = validated.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`KTC ${variant} payload failed schema validation: ${summary}`);
  }
  return validated.data;
}
