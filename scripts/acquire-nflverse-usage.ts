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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Record<string, { rows: number; bytes: number; url: string }> = {};

  for (const season of SEASONS) {
    for (const [kind, url] of [
      ["player_stats", `${BASE}/player_stats/player_stats_${season}.csv`],
      ["snap_counts", `${BASE}/snap_counts/snap_counts_${season}.csv`]
    ] as const) {
      const dest = join(OUT_DIR, `${kind}_${season}.csv`);
      if (existsSync(dest)) {
        const text = readFileSync(dest, "utf8");
        manifest[`${kind}_${season}`] = { rows: text.split("\n").length - 1, bytes: text.length, url };
        console.log(`${kind} ${season}: cached`);
        continue;
      }
      const text = await fetchCsv(url);
      if (!text) {
        console.error(`${kind} ${season}: FAILED`);
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
