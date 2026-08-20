/**
 * Acquire the MFL player database (id -> position) for each holdout season.
 *
 * Audit §19 companion to `acquire-mfl-holdout.ts`. Split out because it is
 * per-SEASON, not per-league — one call covers every league in that season.
 *
 * This is INPUT metadata (a player's position), never outcome data, so fetching
 * it after the protocol was frozen does not compromise the holdout. It was
 * needed because `TYPE=playerScores` returns `{id, week, score, isAvailable}`
 * and carries no position at all — a defect caught by running the evaluator in
 * `--parse-only` mode, which verifies parsing without computing any metric.
 *
 *   npx tsx scripts/acquire-mfl-players.ts [2021,2022,2023,2024]
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// MFL responses are untyped third-party JSON.
/* eslint-disable @typescript-eslint/no-explicit-any */

const OUT_DIR = "reports/2026-08-20/holdout-data";
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";
const SEASONS = ["2021", "2022", "2023", "2024"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seasons reach both a URL and a file path, so they are validated at entry. */
function isSafeSeason(v: string): boolean {
  return /^[0-9]{4}$/.test(v);
}

/** Race-free existence probe: attempt the stat, treat any error as absent. */
function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function fetchPlayers(season: string): Promise<Record<string, string> | null> {
  const url = `https://api.myfantasyleague.com/${season}/export?TYPE=players&DETAILS=0&JSON=1`;
  for (let attempt = 0; attempt <= 6; attempt += 1) {
    await sleep(2000);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    } catch {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      console.log(`  ${season}: HTTP ${res.status}, backing off (attempt ${attempt + 1})`);
      await sleep(8000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const list = j?.players?.player;
    const arr = Array.isArray(list) ? list : list ? [list] : [];
    if (arr.length === 0) return null;
    const map: Record<string, string> = {};
    for (const p of arr) {
      if (p?.id && p?.position) map[String(p.id)] = String(p.position);
    }
    return map;
  }
  return null;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const seasons = (process.argv[2] ?? SEASONS.join(",")).split(",").map((s) => s.trim());
  for (const season of seasons) {
    if (!isSafeSeason(season)) {
      console.error(`${season}: refusing non-numeric season`);
      continue;
    }
    const out = join(OUT_DIR, `_players-${season}.json`);
    if (fileExists(out)) {
      console.log(`${season}: already cached`);
      continue;
    }
    const map = await fetchPlayers(season);
    if (!map) {
      console.error(`${season}: FAILED to fetch player database`);
      continue;
    }
    // Ids and positions are keys/values from a third-party response that the
    // evaluator later reads back. Constrained here so a malformed payload cannot
    // smuggle odd keys into the cache.
    const safe: Record<string, string> = {};
    for (const [id, position] of Object.entries(map)) {
      if (/^[0-9]{1,12}$/.test(id) && /^[A-Za-z/]{1,8}$/.test(position)) safe[id] = position;
    }
    writeFileSync(out, JSON.stringify(safe));
    const positions = new Map<string, number>();
    for (const p of Object.values(safe)) positions.set(p, (positions.get(p) ?? 0) + 1);
    console.log(
      `${season}: ${Object.keys(safe).length} players — ` +
        [...positions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p}:${n}`).join(" ")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
