/**
 * ACQUIRE kicker and team-defence weekly data, 2017–2024.
 *
 * WHY THIS EXISTS, AND THE CLAIM IT CORRECTS.
 *
 * `docs/model-data-audit.md` reported that kickers and team defences "cannot be
 * modelled from the data this project holds", because the committed
 * `nflverse-usage` bundle has no `K` rows and no kicking columns and no
 * team-defence rows at all. That was true of the BUNDLE and false as a statement
 * about nflverse, which publishes all three of these:
 *
 *   player_stats/player_stats_kicking_<season>.csv   distance-banded FG + PAT
 *   stats_team/stats_team_week_<season>.csv          team defensive counting stats
 *   nfldata/data/games.csv                           final scores → points allowed
 *
 * "Not in the file I already had" is not the same claim as "does not exist", and
 * the first was reported as though it were the second. This script closes that.
 *
 * ── WHY POINTS ALLOWED COMES FROM games.csv ────────────────────────────────
 *
 * DST scoring is dominated by points allowed, and the team weekly table does not
 * carry it — it has `opponent_team` but no score. Points allowed is therefore
 * the OPPONENT'S final score, taken from `games.csv`, which this repository
 * already trusts for the bye schedule (`src/lib/schedule/byeSchedule.ts`).
 * Deriving points from touchdown counts instead would silently drop two-point
 * conversions, safeties and defensive scores, and would be wrong by exactly the
 * margin that decides a points-allowed band.
 *
 * ── SAFETY, copied from acquire-nflverse-usage.ts because it earned it ─────
 *
 * The header of every download is validated BEFORE the body is written. That
 * stops an HTML error page or a redirect being archived and then parsed as CSV,
 * and it breaks the untrusted-network-data-to-disk flow CodeQL flags with a real
 * check rather than a suppression. Files are pruned to the columns the harnesses
 * actually read, so the archive cannot quietly grow a column nothing validates.
 *
 *   npx tsx scripts/acquire-nflverse-kdst.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname } from "node:path";
import { parseCsvRows } from "../src/lib/stats/csv";

const SEASONS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const OUT = "reports/2026-09-03/nflverse-kdst.json.gz";
const UA = "rae-fantasy-dashboard/1.0 (offline research archive)";

/** Columns each file must declare, or the download is refused. */
const REQUIRED: Record<string, readonly string[]> = {
  kicking: ["season", "week", "season_type", "player_id", "fg_made_40_49", "pat_made"],
  team: ["season", "week", "season_type", "team", "opponent_team", "def_sacks", "def_interceptions"],
  games: ["season", "week", "game_type", "away_team", "away_score", "home_team", "home_score"]
};

/** Exactly what the harnesses read. The archive is re-serialised down to these. */
const KEEP: Record<string, readonly string[]> = {
  kicking: [
    "season",
    "week",
    "season_type",
    "player_id",
    "player_display_name",
    "team",
    "position",
    "fg_made_0_19",
    "fg_made_20_29",
    "fg_made_30_39",
    "fg_made_40_49",
    "fg_made_50_59",
    "fg_made_60_",
    "fg_missed",
    "pat_made",
    "pat_missed"
  ],
  team: [
    "season",
    "week",
    "season_type",
    "team",
    "opponent_team",
    "def_sacks",
    "def_interceptions",
    "def_tds",
    "def_safeties",
    "def_punt_blocks",
    "def_pat_blocks",
    "def_fg_blocks",
    "fumble_recovery_opp",
    "special_teams_tds"
  ],
  games: ["season", "week", "game_type", "away_team", "away_score", "home_team", "home_score"]
};

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

/** Validate the header, then re-serialise to the kept columns only. */
function prune(kind: keyof typeof KEEP, csv: string): string {
  const parsed = parseCsvRows(csv);
  if (parsed.rows.length === 0) throw new Error(`${kind}: parsed to zero rows`);
  for (const col of REQUIRED[kind]!) {
    if (!parsed.header.includes(col)) {
      throw new Error(`${kind}: header is missing "${col}" — refusing to archive this body`);
    }
  }
  if (parsed.malformed > 0) throw new Error(`${kind}: ${parsed.malformed} malformed rows`);

  const keep = KEEP[kind]!.filter((c) => parsed.header.includes(c));
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [keep.join(",")];
  for (const r of parsed.rows) lines.push(keep.map((c) => escape(r[c] ?? "")).join(","));
  return lines.join("\n");
}

async function main(): Promise<void> {
  const bundle: Record<string, string> = {};
  const report: string[] = [];

  for (const season of SEASONS) {
    for (const [kind, url] of [
      ["kicking", `${BASE}/player_stats/player_stats_kicking_${season}.csv`],
      ["team", `${BASE}/stats_team/stats_team_week_${season}.csv`]
    ] as const) {
      const csv = await fetchCsv(url);
      if (!csv) {
        report.push(`${kind}_${season}: UNAVAILABLE (${url})`);
        continue;
      }
      const pruned = prune(kind, csv);
      bundle[`${kind}_${season}`] = pruned;
      report.push(`${kind}_${season}: ${pruned.split("\n").length - 1} rows`);
      console.log(report[report.length - 1]);
    }
  }

  const games = await fetchCsv(GAMES_URL);
  if (!games) throw new Error("games.csv unavailable — points allowed cannot be derived without it");
  // Pruned to the seasons in scope, so the archive does not carry 25 years of
  // scores to answer a question about eight.
  const parsedGames = parseCsvRows(games);
  const keep = KEEP.games!.filter((c) => parsedGames.header.includes(c));
  const inScope = parsedGames.rows.filter((r) => SEASONS.includes(Number(r.season)));
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  bundle.games = [keep.join(","), ...inScope.map((r) => keep.map((c) => escape(r[c] ?? "")).join(","))].join("\n");
  report.push(`games: ${inScope.length} rows across ${SEASONS.length} seasons`);
  console.log(report[report.length - 1]);

  mkdirSync(dirname(OUT), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 });
  writeFileSync(OUT, gz);
  console.log(`\nwrote ${OUT} — ${(gz.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(bundle).length} tables`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
