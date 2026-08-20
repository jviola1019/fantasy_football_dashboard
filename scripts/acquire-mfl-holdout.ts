/**
 * Acquire the untouched holdout sample from MyFantasyLeague (audit §19).
 *
 * ACQUISITION ONLY. This script fetches and archives raw league data and
 * computes NO metric of any kind. Scoring lives in a separate harness so that
 * running this cannot leak a peek at the answer, and so the archived data can be
 * re-scored without re-fetching.
 *
 * The sampling frame is frozen in reports/2026-08-20/holdout-protocol.md and is
 * fully deterministic: fixed seasons, fixed search terms in a fixed order,
 * candidate ids sorted ascending as integers, walked in order. There is no
 * randomisation and no scoring-dependent selection.
 *
 *   npx tsx scripts/acquire-mfl-holdout.ts [--seasons 2021,2022] [--target 200]
 *
 * Resumable: already-archived leagues are skipped, so an interrupted run
 * continues rather than redrawing the sample.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// MFL responses are untyped third-party JSON; the shapes are validated
// structurally at the gates rather than by a nominal type.
/* eslint-disable @typescript-eslint/no-explicit-any */

const OUT_DIR = "reports/2026-08-20/holdout-data";
const BUNDLE_PATH = "reports/2026-08-20/holdout-data.jsonl.gz";
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";

/** Frozen frame (protocol §5). */
const SEASONS = ["2021", "2022", "2023", "2024"];
const SEARCH_TERMS = [
  "redraft",
  "league",
  "football",
  "ffl",
  "fantasy",
  "money",
  "friends",
  "keeper",
  "the",
  "dynasty"
];
const TARGET_LEAGUES = 200;
/** Bound the load on a free public API (protocol §5). */
const MAX_FETCHED_PER_SEASON = 400;

/** MFL 429s when pushed; be a good citizen by default. */
// 1100ms was fine for ONE process; a 429 storm during this audit turned out to
// be three concurrent runs, not the rate itself. 1500ms leaves headroom so a
// single long run stays polite to a free public API.
const THROTTLE_MS = 1500;
const MAX_RETRIES = 4;

const args = process.argv.slice(2);
function arg(name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : null;
}
const seasons = (arg("seasons") ?? SEASONS.join(",")).split(",").map((s) => s.trim());
const target = Number(arg("target") ?? TARGET_LEAGUES);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Validate an identifier that will reach a FILE PATH or a URL.
 *
 * League ids and seasons here come from a third-party API response, and both are
 * interpolated into a filename under OUT_DIR and into the request URL.
 * Interpolating an unvalidated remote string into a path is a traversal waiting
 * to happen - an id of "../../x" would escape OUT_DIR. Flagged by CodeQL
 * (js/http-to-file-access, js/file-access-to-http) on the first CI run of this
 * script. The ids are numeric by contract, so the fix is to ENFORCE that
 * contract rather than sanitise after the fact.
 */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{1,12}$/.test(v);
}

function isSafeSeason(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{4}$/.test(v);
}

/** League keys already on disk. Race-free: attempt the listing, tolerate absence. */
function listArchivedKeys(): string[] {
  try {
    return readdirSync(OUT_DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/**
 * Read + JSON.parse without an existsSync pre-check.
 *
 * existsSync(p) followed by readFileSync(p) is a TOCTOU race (CodeQL
 * js/file-system-race): the file can vanish between the two calls. Attempting
 * the read and handling the error is both race-free and simpler.
 */
function readJsonOrNull<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

let requests = 0;
let rateLimited = 0;

async function mfl<T>(season: string, query: string): Promise<T | null> {
  if (!isSafeSeason(season)) throw new Error(`refusing non-numeric season: ${season}`);
  const url = `https://api.myfantasyleague.com/${season}/export?${query}&JSON=1`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await sleep(THROTTLE_MS);
    requests += 1;
    let res: Response;
    try {
      // redirect: "follow" is REQUIRED — the api host 302s to the league's own
      // server (www44.myfantasyleague.com etc.) and a non-following fetch gets
      // an empty body with a 302 that looks like a schema failure.
      res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    } catch {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      rateLimited += 1;
      // Exponential backoff. Being throttled is the API telling us to slow down,
      // not an error to retry tightly.
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** MFL returns a bare object when a list has one element. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

interface RawLeague {
  season: string;
  leagueId: string;
  league: unknown;
  draftResults: unknown;
  leagueStandings: unknown;
  playoffBrackets: unknown;
  playerScores: unknown;
  acquiredAt: string;
  source: string;
}

/** Structural gate (protocol §5). Cheap checks first so we fetch less. */
function structurallyEligible(league: any, draft: any): { ok: boolean; reason: string } {
  const franchises = asArray(league?.league?.franchises?.franchise);
  const n = franchises.length;
  if (n < 8 || n > 16) return { ok: false, reason: `franchises=${n} outside 8-16` };

  let du = draft?.draftResults?.draftUnit;
  if (Array.isArray(du)) du = du[0];
  const picks = asArray(du?.draftPick);
  if (picks.length === 0) return { ok: false, reason: "no draft picks" };

  const ratio = picks.length / n;
  if (ratio < 12) {
    // A dynasty rookie draft is ~5 picks per franchise; positional rank computed
    // from it would be meaningless.
    return { ok: false, reason: `picks/franchise=${ratio.toFixed(1)} < 12 (rookie draft)` };
  }
  return { ok: true, reason: `${n} franchises, ${picks.length} picks` };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // `--bundle-only` rebuilds the reproducible artifact from whatever is already
  // archived, without fetching. Needed because the bundle is otherwise written
  // only when a full run completes, and a run truncated by rate limiting still
  // has to leave a committable, re-scorable artifact behind.
  if (args.includes("--bundle-only")) {
    bundle();
    return;
  }

  // `_manifest.json` and `_frame-*.json` are bookkeeping, not leagues. Counting
  // them as archived would inflate `kept` and stop the run short of target.
  const already = new Set(
    // No existsSync pre-check: attempt the read and handle failure (see
    // readJsonOrNull for the same TOCTOU reasoning).
    listArchivedKeys()
  );
  console.log(`acquire-mfl-holdout — target ${target} leagues, ${already.size} already archived\n`);

  const manifest: Array<{
    season: string;
    leagueId: string;
    kept: boolean;
    reason: string;
  }> = [];

  let kept = already.size;

  for (const season of seasons) {
    if (kept >= target) break;
    console.log(`\n=== season ${season} ===`);

    // --- frame: pooled candidate ids, sorted ascending as integers -----------
    // Cached to disk: the frame is deterministic, so re-deriving it on a restart
    // would cost ~7 minutes of search calls AND risk drawing a different frame
    // if MFL's search index shifted between runs. Caching pins the sample.
    const framePath = join(OUT_DIR, `_frame-${season}.json`);
    // Cached frame entries are RE-validated on read: the file is data from a
    // previous run, and trusting it because we wrote it once is how a validated
    // boundary quietly becomes an unvalidated one.
    const cachedFrame = readJsonOrNull<string[]>(framePath);
    let frame: string[];
    if (cachedFrame) {
      frame = cachedFrame.filter(isSafeId);
      console.log(`  frame for ${season}: ${frame.length} ids (cached)`);
    } else {
      const ids = new Set<string>();
      for (const term of SEARCH_TERMS) {
        const j = await mfl<any>(season, `TYPE=leagueSearch&SEARCH=${encodeURIComponent(term)}`);
        const list = asArray(j?.leagues?.league);
        for (const l of list) {
          const id = l?.id == null ? null : String(l.id);
          if (isSafeId(id)) ids.add(id);
        }
        console.log(`  search "${term}": +${list.length} (frame now ${ids.size})`);
      }
      frame = [...ids].sort((a, b) => Number(a) - Number(b));
      writeFileSync(framePath, JSON.stringify(frame));
    }
    let fetched = 0;
    for (const leagueId of frame) {
      if (kept >= target) break;
      if (fetched >= MAX_FETCHED_PER_SEASON) {
        console.log(`  reached per-season fetch cap (${MAX_FETCHED_PER_SEASON})`);
        break;
      }
      const key = `${season}-${leagueId}`;
      if (already.has(key)) continue;

      fetched += 1;
      const league = await mfl<any>(season, `TYPE=league&L=${leagueId}`);
      if (!league?.league) {
        manifest.push({ season, leagueId, kept: false, reason: "league fetch failed" });
        continue;
      }
      const draft = await mfl<any>(season, `TYPE=draftResults&L=${leagueId}`);
      if (!draft) {
        manifest.push({ season, leagueId, kept: false, reason: "draftResults fetch failed" });
        continue;
      }

      const gate = structurallyEligible(league, draft);
      if (fetched % 25 === 0) {
        console.log(
          `    ...examined ${fetched} in ${season} (archived ${kept}, 429s ${rateLimited}, ${requests} reqs)`
        );
      }
      if (!gate.ok) {
        manifest.push({ season, leagueId, kept: false, reason: gate.reason });
        continue;
      }

      // Only now spend the remaining three requests.
      const standings = await mfl<any>(season, `TYPE=leagueStandings&L=${leagueId}`);
      const brackets = await mfl<any>(season, `TYPE=playoffBrackets&L=${leagueId}`);
      const scores = await mfl<any>(season, `TYPE=playerScores&L=${leagueId}&W=YTD`);

      if (!standings?.leagueStandings) {
        manifest.push({ season, leagueId, kept: false, reason: "no standings" });
        continue;
      }

      const raw: RawLeague = {
        season,
        leagueId,
        league,
        draftResults: draft,
        leagueStandings: standings,
        playoffBrackets: brackets,
        // Archived for a SEPARATELY frozen PAR protocol. Not used by the
        // holdout scoring harness (protocol §3).
        playerScores: scores,
        acquiredAt: new Date().toISOString(),
        source: `https://api.myfantasyleague.com/${season}/export?L=${leagueId}`
      };
      // `key` is season-leagueId, both already validated numeric above. Asserted
      // again AT the filesystem call so the guarantee is local to it rather than
      // several hundred lines away.
      if (!/^[0-9]{4}-[0-9]{1,12}$/.test(key)) {
        manifest.push({ season, leagueId, kept: false, reason: "unsafe league id" });
        continue;
      }
      writeFileSync(join(OUT_DIR, `${key}.json`), JSON.stringify(raw));
      already.add(key);
      kept += 1;
      manifest.push({ season, leagueId, kept: true, reason: gate.reason });
      if (kept % 10 === 0) {
        console.log(`  archived ${kept}/${target} (season ${season}, fetched ${fetched}, 429s ${rateLimited})`);
      }
    }
    console.log(`  season ${season}: fetched ${fetched}, archived total ${kept}`);
  }

  const manifestPath = join(OUT_DIR, "_manifest.json");
  const prior = readJsonOrNull<typeof manifest>(manifestPath) ?? [];
  writeFileSync(manifestPath, JSON.stringify([...prior, ...manifest], null, 1));

  const rejected = manifest.filter((m) => !m.kept);
  const byReason = new Map<string, number>();
  for (const r of rejected) {
    const bucket = r.reason.replace(/=[\d.]+/g, "=N").replace(/\d+/g, "N");
    byReason.set(bucket, (byReason.get(bucket) ?? 0) + 1);
  }
  console.log(`\n--- acquisition summary ---`);
  console.log(`archived leagues : ${kept}`);
  console.log(`http requests    : ${requests}`);
  console.log(`rate-limited     : ${rateLimited}`);
  console.log(`rejected         : ${rejected.length}`);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
  // Compressed bundle for the repository. The loose per-league files are the
  // working set (gitignored); this is what makes the run reproducible from a
  // clean checkout without re-fetching, per protocol §10.
  bundle();

  console.log(`\nNo metric was computed. Scoring is scripts/holdout-evaluate.ts.`);
}

/** One JSON object per line, gzipped. ~10x smaller than the loose files. */
function bundle(): void {
  const files = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();
  if (files.length === 0) return;
  const lines = files
    .map((f) => {
      try {
        return readFileSync(join(OUT_DIR, f), "utf8").trim();
      } catch {
        return null; // removed between readdir and read - skip rather than crash
      }
    })
    .filter((l): l is string => l != null && l.length > 0);
  const gz = gzipSync(Buffer.from(lines.join("\n"), "utf8"), { level: 9 });
  writeFileSync(BUNDLE_PATH, gz);
  console.log(
    `\nbundled ${files.length} leagues -> ${BUNDLE_PATH} (${(gz.length / 1e6).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error("acquisition failed:", err);
  process.exit(1);
});
