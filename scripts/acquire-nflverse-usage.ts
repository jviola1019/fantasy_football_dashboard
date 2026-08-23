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
const QUOTE = String.fromCharCode(34);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const UA = "RAE-audit/1.0 (model validation research; contact jviola1@vols.utk.edu)";

/** Frozen in protocol 4 §3. */
const SEASONS = [
  // Protocol 5 evaluation set — never touched by protocol 4.
  "2017", "2018", "2019",
  // 2020 is excluded from protocol 5's PRIMARY (COVID) but acquired so the
  // pre-registered D3 diagnostic can add it back.
  "2020",
  // Protocol 4's set, reused as protocol 5's FIT set.
  "2021", "2022", "2023", "2024"
];

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

/**
 * Every column any harness reads, per file kind.
 *
 * The archive is re-serialised down to exactly these (audit 2026-08-23). Two
 * reasons, and the second is the one that matters:
 *
 * 1. Nothing unvalidated is persisted. What lands on disk is built from cells
 *    that survived a parse, not from the response body.
 * 2. It ends the `js/http-to-file-access` dataflow with a REAL structural
 *    change rather than a suppression. `writeFileSync(dest, text)` writes the
 *    HTTP response; `writeFileSync(dest, reserialize(...))` writes a string
 *    this file constructed. The header check alone could not do that -- it
 *    validated the body and then wrote the body.
 *
 * The union is taken across holdout-evaluate-4, holdout-evaluate-5 and
 * anova-opportunity. Every harness reads columns BY NAME, so a subset is safe;
 * dropping one a harness names would not be, which is why `reserialize`
 * REJECTS a file missing any of them rather than writing a partial archive.
 */
const KEEP_COLUMNS: Record<string, readonly string[]> = {
  player_stats: [
    "player_id",
    "player_display_name",
    "season",
    "season_type",
    "week",
    "position",
    "carries",
    "targets",
    "target_share",
    "wopr",
    "fantasy_points_ppr"
  ],
  snap_counts: ["player", "season", "game_type", "week", "offense_snaps", "offense_pct"]
};

/** Minimal RFC-4180 reader; mirrors the harnesses so a round-trip is faithful. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === QUOTE) {
        if (text[i + 1] === QUOTE) { field += QUOTE; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === QUOTE) quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === LF) { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== CR) field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Quote only when a cell could otherwise change the shape of the row. */
function csvCell(v: string): string {
  return v.includes(QUOTE) || v.includes(",") || v.includes(LF) || v.includes(CR)
    ? QUOTE + v.split(QUOTE).join(QUOTE + QUOTE) + QUOTE
    : v;
}

/**
 * Rebuild the file from parsed cells, keeping only the columns a harness reads.
 *
 * Returns null when a required column is absent, so a partial archive is never
 * written -- a file that parses but is missing `carries` would produce a
 * silently wrong protocol result, which is worse than no file.
 */
function reserialize(kind: string, text: string): string | null {
  const keep = KEEP_COLUMNS[kind];
  if (!keep) return null;
  const rows = parseCsv(text);
  const head = rows[0];
  if (!head || head.length < 2) return null;
  const idx = keep.map((c) => head.indexOf(c));
  if (idx.some((i) => i < 0)) return null;

  const out: string[] = [keep.join(",")];
  for (const r of rows.slice(1)) {
    // Ragged rows are dropped, exactly as every harness already drops them.
    if (r.length !== head.length) continue;
    out.push(idx.map((i) => csvCell(r[i] ?? "")).join(","));
  }
  return out.join(LF) + LF;
}

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
      // The response body is never written. `reserialize` rebuilds the file
      // from parsed cells, keeping only the columns a harness reads.
      const archived = reserialize(kind, text);
      if (archived == null) {
        console.error(`${kind} ${season}: REJECTED — parsed, but a required column is missing`);
        continue;
      }
      writeFileSync(dest, archived);
      manifest[`${kind}_${season}`] = { rows: archived.split("\n").length - 2, bytes: archived.length, url };
      console.log(`${kind} ${season}: ${archived.split("\n").length - 2} rows`);
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
