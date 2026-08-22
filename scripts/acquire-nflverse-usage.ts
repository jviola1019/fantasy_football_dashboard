/**
 * Acquire and archive nflverse weekly player stats + snap counts (protocol 4).
 *
 * ACQUISITION ONLY — computes no metric.
 *
 * nflverse is CC-BY. Attribution is recorded in docs/data-source-map.md and the
 * files are archived so protocol 4 reproduces without re-fetching.
 *
 *   npx tsx scripts/acquire-nflverse-usage.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const OUT_DIR = "reports/2026-08-20/nflverse";
const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";

/** Frozen in protocol 4 §3. */
const SEASONS = ["2021", "2022", "2023", "2024"];

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

async function fetchCsv(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok) return await res.text();
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Columns every nflverse file we consume must declare.
 *
 * Validating the header before the body is written does two jobs at once: it
 * stops a redirect page or an HTML error body being archived and then silently
 * parsed as CSV, and it breaks the untrusted-network-data-to-disk flow CodeQL
 * flags (js/http-to-file-access) with a real check rather than a suppression.
 */
const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  player_stats: ["player_id", "season", "week", "position", "fantasy_points_ppr"],
  snap_counts: ["season", "week", "player", "offense_snaps", "offense_pct"]
};

function isExpectedCsv(kind: string, text: string): boolean {
  const required = REQUIRED_COLUMNS[kind];
  if (!required) return false;
  const header = text.slice(0, 4096).split("\n", 1)[0] ?? "";
  if (!header.includes(",")) return false;
  const cols = new Set(header.replace(/\r$/, "").split(","));
  return required.every((c) => cols.has(c));
}

/**
 * Read a cached file WITHOUT checking existence first.
 *
 * `existsSync(p)` followed by `readFileSync(p)` is a time-of-check/time-of-use
 * race (CodeQL js/file-system-race): the file can vanish between the two calls.
 * A single syscall in a try/catch has no window to race in.
 */
function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Record<string, { rows: number; bytes: number; url: string }> = {};

  for (const season of SEASONS) {
    for (const [kind, url] of [
      ["player_stats", `${BASE}/player_stats/player_stats_${season}.csv`],
      ["snap_counts", `${BASE}/snap_counts/snap_counts_${season}.csv`]
    ] as const) {
      // `kind` and `season` both come from the frozen literal lists above, never
      // from a response, so the path cannot be influenced by the network.
      const dest = join(OUT_DIR, `${kind}_${season}.csv`);

      const cached = readIfPresent(dest);
      if (cached != null) {
        manifest[`${kind}_${season}`] = { rows: cached.split("\n").length - 1, bytes: cached.length, url };
        console.log(`${kind} ${season}: cached`);
        continue;
      }
      const text = await fetchCsv(url);
      if (!text) {
        console.error(`${kind} ${season}: FAILED`);
        continue;
      }
      if (!isExpectedCsv(kind, text)) {
        console.error(`${kind} ${season}: REJECTED — not the expected CSV (header is missing required columns)`);
        continue;
      }
      writeFileSync(dest, text);
      manifest[`${kind}_${season}`] = { rows: text.split("\n").length - 1, bytes: text.length, url };
      console.log(`${kind} ${season}: ${text.split("\n").length - 1} rows`);
    }
  }

  writeFileSync(join(OUT_DIR, "_manifest.json"), JSON.stringify(manifest, null, 1));

  // Committable bundle so protocol 4 reproduces from a clean checkout — the same
  // reproducibility rule protocols 1-3 had to learn the hard way.
  const bundle: Record<string, string> = {};
  for (const key of Object.keys(manifest)) {
    bundle[key] = readFileSync(join(OUT_DIR, `${key}.csv`), "utf8");
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 });
  writeFileSync(BUNDLE, gz);

  console.log(`\nbundled -> ${BUNDLE} (${(gz.length / 1e6).toFixed(2)} MB)`);
  console.log("No metric was computed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
