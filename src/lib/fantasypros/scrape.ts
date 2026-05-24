import { FpEcrDataSchema, type FpEcrData, type FpScoring } from "./types";

// FantasyPros serves a static HTML page with `window.ecrData = {...};`
// embedded inline. No JS rendering, no API key, no auth — just fetch +
// regex + parse.
//
// We intentionally don't pull in a heavy HTML parser like cheerio: the
// variable is consistently emitted on a single semicolon-terminated line
// and a regex is both faster and immune to layout changes elsewhere on
// the page.

const SCORING_TO_URL: Record<FpScoring, string> = {
  STD: "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php",
  PPR: "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
  HALF: "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php"
};

// FantasyPros 403s default Node fetch UAs. Spoof a recent desktop browser.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Capture the JSON object literal assigned to `ecrData`. The regex is
// deliberately permissive — `[\s\S]*?` non-greedy, terminated by the
// closing brace + semicolon FantasyPros uses on every render seen so far.
const ECR_DATA_RE = /ecrData\s*=\s*(\{[\s\S]*?\});/;

export interface FetchEcrOptions {
  scoring?: FpScoring;
  /** Override URL — useful for tests against fixture HTML. */
  url?: string;
  /** Inject a custom fetcher — tests use this to feed canned HTML. */
  fetcher?: typeof fetch;
}

export async function fetchFpEcr({
  scoring = "PPR",
  url,
  fetcher = fetch
}: FetchEcrOptions = {}): Promise<FpEcrData> {
  const target = url ?? SCORING_TO_URL[scoring];
  const response = await fetcher(target, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`FantasyPros ${scoring} fetch failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const match = ECR_DATA_RE.exec(html);
  if (!match || !match[1]) {
    throw new Error(`FantasyPros ${scoring} response did not contain ecrData variable`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`FantasyPros ${scoring} ecrData was not valid JSON: ${msg}`);
  }
  const validated = FpEcrDataSchema.safeParse(parsed);
  if (!validated.success) {
    // Zod's pretty-printed issue list is more useful than the raw error here.
    const summary = validated.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`FantasyPros ${scoring} ecrData failed schema validation: ${summary}`);
  }
  // Sanity check: the scoring in the parsed payload should match the URL
  // we asked for. Catches a silent CDN redirect from PPR -> STD.
  if (validated.data.scoring !== scoring) {
    throw new Error(
      `FantasyPros returned scoring=${validated.data.scoring} when we asked for ${scoring}`
    );
  }
  return validated.data;
}
