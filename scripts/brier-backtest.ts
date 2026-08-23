#!/usr/bin/env npx tsx
/**
 * Brier score backtest — true prospective model using Sleeper data.
 *
 * DATA SOURCES (tried in order)
 * ─────────────────────────────
 * 1. Sleeper 2025 prospective   — projections endpoint (forecast) vs actual
 *                                 stats endpoint (outcome). True week-by-week
 *                                 Brier backtest: projection BEFORE game vs
 *                                 actual PPR AFTER game. Available for all 17
 *                                 regular-season weeks of the 2025 NFL season.
 * 2. nflverse 2025 per-week    — stats_player_week_2025.csv (not yet published)
 * 3. Local 2025 season-agg     — C:/tmp/nfl_stats_2025.csv (no week column;
 *                                uses season-total PPR, skips per-week k-fold)
 * 4. nflverse 2024 per-week    — stats_player_week_2024.csv (remote fallback)
 *
 * MODEL
 * ─────
 * Binary outcome: did the player's ACTUAL pts_ppr exceed the threshold? A
 * projected-startable player with NO actual row (injured / inactive / benched)
 * is scored as a FAILED forecast (outcome 0), not dropped — dropping no-shows
 * conditions on "the player actually played," which is future information and
 * removes exactly the high-projection busts that should penalise the forecast
 * (survivorship bias).
 *
 * Universe: players whose pre-game projection clears a "plausibly startable"
 * floor (≥ threshold/2). This keeps the base rate meaningful instead of
 * flooding the set with deep-bench zero-projection players.
 *
 * For Sleeper prospective: forecast = rank-based probability derived from the
 * week's pre-game projected pts_ppr (players sorted by projection within
 * position; ties share an averaged rank; rank 1 → prob ≈ 1, last → ≈ 0).
 *
 * IMPORTANT — what this measures: the rank→probability map is monotone in the
 * projection, so this is a DISCRIMINATION / ordinal-skill test (does projection
 * ORDER predict who clears the threshold?), NOT a calibration test of the
 * projection's own implied probabilities. Reliability here is the calibration of
 * our invented rank→prob mapping, not of Sleeper/Rotowire numbers. The
 * interpretation block is derived from the computed reliability/resolution, not
 * hard-coded.
 *
 * For CSV sources: the "forecast" is the within-week rank of the ACTUAL PPR
 * being scored. That is a TAUTOLOGY, not a backtest — the predictor is a
 * monotone function of the outcome, so discrimination is perfect (AUC = 1.0)
 * by construction and no skill is being measured at all. Audit 2026-08-22, P2-1;
 * it was previously described as a "lower bound", which is exactly backwards.
 *
 * The path is kept because it has one legitimate use: as a HARNESS SELF-TEST.
 * If this pipeline cannot score a perfect forecast as perfect, the pipeline is
 * broken, and that is worth knowing. So the AUC is now ASSERTED rather than
 * reported, and the run refuses to present its numbers as results.
 *
 * THRESHOLDS (chosen for roughly even positive/negative split among starters)
 *   QB: 18 pts  RB: 10 pts  WR: 8 pts  TE: 6 pts
 *
 * RUNNING
 *   npx tsx scripts/brier-backtest.ts
 */

import { brierScore, kFoldCV, reliabilityDiagram, expectedCalibrationError } from "../src/lib/stats/distribution";
import type { BrierForecast } from "../src/lib/stats/distribution";
import { fitLogisticCV } from "../src/lib/stats/logistic";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NFLVERSE_URL_2025_WEEK =
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_2025.csv";
const NFLVERSE_URL_2024_WEEK =
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_2024.csv";
const LOCAL_2025_SEASON = "C:/tmp/nfl_stats_2025.csv";

const SLEEPER_PROJ_URL = (week: number) =>
  `https://api.sleeper.app/projections/nfl/2025/${week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`;
const SLEEPER_STATS_URL = (week: number) =>
  `https://api.sleeper.app/stats/nfl/2025/${week}?season_type=regular`;

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

const THRESHOLDS: Record<Position, number> = {
  QB: 18,
  RB: 10,
  WR: 8,
  TE: 6
};

// ── Sleeper prospective data types ─────────────────────────────────────────

interface SleeperProjection {
  player_id: string;
  week: number;
  season: string;
  stats: { pts_ppr?: number };
  player?: { position?: string };
}

interface SleeperStat {
  player_id: string;
  week: number;
  season: string;
  season_type: string;
  stats: { pts_ppr?: number; gp?: number };
  player?: { position?: string };
}

interface ProspectiveRow {
  kind: "prospective";
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;  // pre-game projection (forecast input)
  actual_pts_ppr: number; // post-game actual (outcome); 0 if the player did not play
  played: boolean;        // false = no actual stat row (DNP / inactive / bye)
}

// ── CSV data types ──────────────────────────────────────────────────────────

interface PerWeekRow {
  kind: "week";
  player_id: string;
  position: string;
  week: number;
  season: number;
  fantasy_points_ppr: number;
}

interface SeasonRow {
  kind: "season";
  player_id: string;
  position: string;
  season: number;
  fantasy_points_ppr: number;
}

type DataRow = PerWeekRow | SeasonRow;

// ── Sleeper fetch helpers ───────────────────────────────────────────────────

async function fetchSleeperProspective(): Promise<{
  rows: ProspectiveRow[];
  weeksLoaded: number;
  dnpCount: number;
}> {
  const rows: ProspectiveRow[] = [];
  let dnpCount = 0; // projected-startable players with no actual row (scored 0)
  const REGULAR_SEASON_WEEKS = 17;

  process.stdout.write("  Fetching Sleeper 2025 projections + actual stats");

  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
    try {
      const [projRes, statsRes] = await Promise.all([
        fetch(SLEEPER_PROJ_URL(week)),
        fetch(SLEEPER_STATS_URL(week))
      ]);
      if (!projRes.ok || !statsRes.ok) continue;

      const projList = (await projRes.json()) as SleeperProjection[];
      const statsList = (await statsRes.json()) as SleeperStat[];

      // Build actual-stats map: player_id → actual pts_ppr. The URL already
      // scopes season_type=regular; the per-row guard is relaxed because Sleeper
      // sometimes omits season_type on the row (treating absent as in-scope).
      const actualMap = new Map<string, number>();
      for (const stat of statsList) {
        if (stat.stats.pts_ppr != null && (stat.season_type == null || stat.season_type === "regular")) {
          actualMap.set(stat.player_id, stat.stats.pts_ppr);
        }
      }

      // Match projections to actuals. Universe = players whose pre-game
      // projection clears a "plausibly startable" floor (≥ threshold/2). A
      // projected-startable player with no actual row did NOT play → outcome 0
      // (failed forecast), NOT dropped: dropping them is survivorship bias.
      for (const proj of projList) {
        if (!proj.player_id || proj.stats.pts_ppr == null) continue;
        const position = proj.player?.position ?? "";
        if (!POSITIONS.includes(position as Position)) continue;
        if (proj.stats.pts_ppr < THRESHOLDS[position as Position] / 2) continue;

        const actual = actualMap.get(proj.player_id);
        const played = actual != null;
        if (!played) dnpCount++;

        rows.push({
          kind: "prospective",
          player_id: proj.player_id,
          position,
          week,
          proj_pts_ppr: proj.stats.pts_ppr,
          actual_pts_ppr: actual ?? 0,
          played
        });
      }

      process.stdout.write(".");
    } catch {
      // Skip failed weeks
    }
  }
  process.stdout.write("\n");

  const weeksLoaded = new Set(rows.map((r) => r.week)).size;
  return { rows, weeksLoaded, dnpCount };
}

// ── Forecast builders ───────────────────────────────────────────────────────

/**
 * Read a file WITHOUT an existsSync pre-check.
 *
 * `existsSync(p)` then `readFileSync(p)` is a time-of-check/time-of-use race
 * (CodeQL js/file-system-race) — the file can disappear between the two calls.
 * One syscall in a try/catch has no window to race in.
 */
function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function buildProspectiveForecasts(
  rows: ProspectiveRow[],
  pos: Position
): BrierForecast[] {
  const threshold = THRESHOLDS[pos];
  const posRows = rows.filter((r) => r.position === pos);
  const byWeek = new Map<number, ProspectiveRow[]>();
  for (const r of posRows) {
    const weekRows = byWeek.get(r.week) ?? [];
    weekRows.push(r);
    byWeek.set(r.week, weekRows);
  }

  const forecasts: BrierForecast[] = [];
  for (const weekRows of byWeek.values()) {
    const n = weekRows.length;
    // A single-player group forces prob=1 regardless of projection; skip it.
    if (n < 2) continue;
    // Sort by projected pts (descending) to assign rank-based probabilities.
    // Rank 0 (highest proj) → prob 1, last rank → prob 0. Tied projections
    // share an averaged rank so equal forecasts get equal probabilities.
    const sorted = [...weekRows].sort((a, b) => b.proj_pts_ppr - a.proj_pts_ppr);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && sorted[j + 1]!.proj_pts_ppr === sorted[i]!.proj_pts_ppr) j++;
      const avgRank = (i + j) / 2; // average 0-based rank of the tie group
      const prob = 1 - avgRank / (n - 1);
      for (let k = i; k <= j; k++) {
        const outcome: 0 | 1 = sorted[k]!.actual_pts_ppr >= threshold ? 1 : 0;
        forecasts.push({ prob, outcome });
      }
      i = j + 1;
    }
  }
  return forecasts;
}

/** Per-position base rate (climatology) = fraction of outcomes that are 1. */
function baseRate(rows: ProspectiveRow[], pos: Position): { clim: number; n: number; dnp: number } {
  const posRows = rows.filter((r) => r.position === pos);
  const positives = posRows.filter((r) => r.actual_pts_ppr >= THRESHOLDS[pos]).length;
  const dnp = posRows.filter((r) => !r.played).length;
  return { clim: posRows.length ? positives / posRows.length : 0, n: posRows.length, dnp };
}

/**
 * Out-of-fold logistic CALIBRATION model. Fits P(actual ≥ threshold) directly
 * from the projected points via logistic regression, training on all OTHER weeks
 * and predicting each held-out week. Unlike the rank→prob model, the probability
 * comes from the projection itself, so its Reliability measures the calibration
 * of the PROJECTIONS — the question the rank model cannot answer. Returns []
 * when too few rows to fit, and ALSO when fewer than two distinct weeks are
 * present — see the note in the body.
 *
 * WHAT LEAVE-ONE-WEEK-OUT DOES AND DOES NOT CONTROL (audit 2026-08-22, P2-7).
 *
 * This used to say "leave-one-week-out, so no leakage", which claims more than
 * the design delivers. Holding out a WEEK removes temporal leakage: no outcome
 * from the scored week is in the training set. It does NOT make the folds
 * independent, because THE SAME PLAYERS appear in every other week. A player's
 * week-5 projection is correlated with their weeks 1–4, so the fitted
 * projection→probability mapping is partly learned from the very players it is
 * then scored on.
 *
 * That is a dependence problem, not an outcome-leakage problem: the model never
 * sees a scored outcome, and the single feature is the projection, not player
 * identity — so the effect is bounded. But it means the effective sample size is
 * closer to the number of distinct PLAYERS than to the number of player-weeks,
 * and the out-of-fold error is optimistic by an unmeasured amount. Fixing it
 * properly needs grouped CV that holds out players and weeks together, which is
 * a protocol change, not a code tweak. Stated rather than fixed.
 */
function buildLogisticCalibration(rows: ProspectiveRow[], pos: Position): BrierForecast[] {
  const threshold = THRESHOLDS[pos];
  const posRows = rows.filter((r) => r.position === pos);
  if (posRows.length < 20) return [];
  const X = posRows.map((r) => [r.proj_pts_ppr]);
  const y = posRows.map((r) => (r.actual_pts_ppr >= threshold ? 1 : 0));
  const fold = posRows.map((r) => r.week);

  // Leave-one-week-out needs at least TWO weeks. With one, every row is its own
  // and only fold, `fitLogisticCV` correctly refuses to leak and returns the
  // max-entropy prior 0.5 for every row -- and the caller then reported the ECE
  // of a constant 0.5 as "the projections' TRUE calibration error". That number
  // is a property of the base rate; the projections are not in it at all.
  // Audit 2026-08-22, P2-2. Returning [] makes the model ABSENT from the report,
  // which is what "we could not measure this" should look like.
  const distinctWeeks = new Set(fold).size;
  if (distinctWeeks < 2) {
    console.warn(
      `${pos}: only ${distinctWeeks} week of data — leave-one-week-out cannot run, so no ` +
        `calibration model is reported (it would be the ECE of a constant 0.5).`
    );
    return [];
  }

  const oof = fitLogisticCV(X, y, fold, { l2: 1.0 });
  return oof.map((p, i) => ({ prob: p, outcome: y[i]! as 0 | 1 }));
}

/**
 * RFC 4180-compliant CSV row splitter. Handles quoted fields that may contain
 * commas (e.g. headshot URLs "https://...f_auto,q_auto/...").
 */
function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"'; i += 2;
        } else if (line[i] === '"') {
          i++; break;
        } else {
          field += line[i++];
        }
      }
      if (line[i] === ",") i++;
      fields.push(field);
    } else {
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i));
      if (line[i] === ",") i++;
    }
  }
  return fields;
}

function parseCsvColumns(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) idx[header[i]!] = i;
  return idx;
}

function parseCsv(csv: string): { rows: DataRow[]; hasWeek: boolean } {
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], hasWeek: false };
  const header = splitCsvRow(lines[0]!).map((h) => h.trim());
  const idx = parseCsvColumns(header);
  const hasWeek = "week" in idx;
  const iPlayerId = idx["player_id"] ?? -1;
  const iPosition = idx["position"] ?? -1;
  const iSeason = idx["season"] ?? -1;
  const iWeek = idx["week"] ?? -1;
  const iSeasonType = idx["season_type"] ?? -1;
  const iPpr = idx["fantasy_points_ppr"] ?? -1;

  const rows: DataRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]!);
    const get = (idx: number) => cols[idx]?.trim() ?? "";
    if (iSeasonType >= 0) {
      const st = get(iSeasonType);
      if (st && st !== "REG") continue;
    }
    const ppr = parseFloat(get(iPpr));
    if (!isFinite(ppr)) continue;
    if (hasWeek) {
      rows.push({
        kind: "week",
        player_id: get(iPlayerId),
        position: get(iPosition),
        season: parseInt(get(iSeason)),
        week: parseInt(get(iWeek)),
        fantasy_points_ppr: ppr
      });
    } else {
      rows.push({
        kind: "season",
        player_id: get(iPlayerId),
        position: get(iPosition),
        season: parseInt(get(iSeason)),
        fantasy_points_ppr: ppr
      });
    }
  }
  return { rows, hasWeek };
}

function buildSelfTestForecasts(rows: DataRow[], pos: Position): BrierForecast[] {
  const threshold = THRESHOLDS[pos];
  const posRows = rows.filter((r) => r.position === pos);
  if (posRows[0]?.kind === "week") {
    const byWeek = new Map<number, PerWeekRow[]>();
    for (const r of posRows as PerWeekRow[]) {
      const wrs = byWeek.get(r.week) ?? [];
      wrs.push(r);
      byWeek.set(r.week, wrs);
    }
    const forecasts: BrierForecast[] = [];
    for (const weekRows of byWeek.values()) {
      const sorted = [...weekRows].sort((a, b) => b.fantasy_points_ppr - a.fantasy_points_ppr);
      const n = sorted.length;
      for (let rank = 0; rank < n; rank++) {
        const row = sorted[rank]!;
        forecasts.push({ prob: 1 - rank / Math.max(1, n - 1), outcome: row.fantasy_points_ppr >= threshold ? 1 : 0 });
      }
    }
    return forecasts;
  } else {
    const sorted = [...(posRows as SeasonRow[])].sort((a, b) => b.fantasy_points_ppr - a.fantasy_points_ppr);
    const n = sorted.length;
    const seasonThreshold = threshold * 17;
    return sorted.map((row, rank) => ({
      prob: 1 - rank / Math.max(1, n - 1),
      outcome: row.fantasy_points_ppr >= seasonThreshold ? 1 : (0 as 0 | 1)
    }));
  }
}


/**
 * AUC by the Mann-Whitney rank identity, with ties averaged.
 *
 * Used only by the self-test path, where it must come out at 1.0 — see P2-1.
 */
function rankAuc(forecasts: BrierForecast[]): number | null {
  const pos = forecasts.filter((f) => f.outcome === 1).length;
  const neg = forecasts.length - pos;
  if (pos === 0 || neg === 0) return null;
  const sorted = [...forecasts].sort((a, b) => a.prob - b.prob);
  const ranks = new Array<number>(sorted.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.prob === sorted[i]!.prob) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = avg;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let i = 0; i < sorted.length; i += 1) if (sorted[i]!.outcome === 1) rankSumPos += ranks[i]!;
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}


/**
 * A stable fingerprint of the rows a run was scored on (audit 2026-08-22, P2-5).
 *
 * Every source here is fetched LIVE -- the Sleeper projections and stats APIs,
 * and the nflverse release CSVs -- and none of it is snapshotted. The report
 * called itself seeded and deterministic, which is true of the ARITHMETIC and
 * false of the RUN: the same command on two different days scores different
 * data, and nothing in the output said which. Two reports could disagree and
 * both be correct.
 *
 * A real fix is to snapshot the inputs. Until then, recording a fingerprint at
 * least makes two runs COMPARABLE: identical fingerprints mean identical
 * inputs, and different ones mean the numbers are not being compared like for
 * like. That is the difference between "unreproducible" and "unreproducible and
 * undetectable".
 *
 * FNV-1a over the sorted row keys -- dependency-free and stable across runs.
 */
function fingerprintRows(keys: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const key of [...keys].sort()) {
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

function asciiBar(v: number, width = 20): string {
  const filled = Math.round(v * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function fetchCsv(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("RAE Brier Backtest — NFL 2025 Season\n");

  type DataSource =
    | { kind: "prospective"; rows: ProspectiveRow[]; weeksLoaded: number; dnpCount: number; season: number }
    | { kind: "csv"; rows: DataRow[]; hasWeek: boolean; season: number; source: string };

  let data: DataSource;

  // Source 1: Sleeper prospective (projections vs actual stats)
  console.log("Source 1: Sleeper 2025 projections vs actual stats...");
  const { rows: prospRows, weeksLoaded, dnpCount } = await fetchSleeperProspective();
  if (prospRows.length > 100) {
    console.log(`  → Loaded ${prospRows.length} startable player-weeks across ${weeksLoaded} weeks (${dnpCount} scored 0 for not playing).`);
    data = { kind: "prospective", rows: prospRows, weeksLoaded, dnpCount, season: 2025 };
  } else {
    // Source 2: nflverse 2025 per-week
    console.log("  → Sleeper returned insufficient data. Trying nflverse 2025 per-week...");
    const csv2025 = await fetchCsv(NFLVERSE_URL_2025_WEEK);
    if (csv2025) {
      const parsed = parseCsv(csv2025);
      data = { kind: "csv", rows: parsed.rows, hasWeek: parsed.hasWeek, season: 2025, source: NFLVERSE_URL_2025_WEEK };
    } else {
      // Source 3: local season-aggregate
      console.log("  → Trying local C:/tmp/nfl_stats_2025.csv...");
      const csv = readIfPresent(LOCAL_2025_SEASON);
      if (csv != null) {
        const parsed = parseCsv(csv);
        if (parsed.rows.length > 0) {
          console.log(`  → Local 2025 season-aggregate (${parsed.rows.length} rows).`);
          data = { kind: "csv", rows: parsed.rows, hasWeek: parsed.hasWeek, season: 2025, source: LOCAL_2025_SEASON };
        } else {
          // Source 4: nflverse 2024 fallback
          console.log("  → Falling back to nflverse 2024 per-week...");
          const csv2024 = await fetchCsv(NFLVERSE_URL_2024_WEEK);
          if (!csv2024) { console.error("All sources failed."); process.exit(1); }
          const parsed = parseCsv(csv2024);
          data = { kind: "csv", rows: parsed.rows, hasWeek: parsed.hasWeek, season: 2024, source: NFLVERSE_URL_2024_WEEK };
        }
      } else {
        const csv2024 = await fetchCsv(NFLVERSE_URL_2024_WEEK);
        if (!csv2024) { console.error("All sources failed."); process.exit(1); }
        const parsed = parseCsv(csv2024);
        data = { kind: "csv", rows: parsed.rows, hasWeek: parsed.hasWeek, season: 2024, source: NFLVERSE_URL_2024_WEEK };
      }
    }
  }

  // Build report header
  const lines: string[] = ["# Brier Score Backtest Results", ""];
  if (data.kind === "prospective") {
    lines.push(`> **Season:** 2025  `);
    lines.push(`> **Source:** Sleeper projections API (forecast) + Sleeper stats API (outcome)  `);
    lines.push(`> **Method:** TRUE PROSPECTIVE — pre-game projection vs post-game actual PPR  `);
    lines.push(`> **Two models per position:** (1) DISCRIMINATION — rank→prob (ordinal skill of projection order); (2) CALIBRATION — out-of-fold logistic mapping projected pts → P(≥ threshold), scored by Expected Calibration Error (the projections' true calibration error)  `);
    lines.push(`> **Coverage:** ${data.weeksLoaded} regular-season weeks, ${data.rows.length} startable player-weeks (${data.dnpCount} DNP scored 0)  `);
    lines.push(`> **Universe:** players projected ≥ threshold/2; no-shows scored 0 (no survivorship filter)  `);
    // P2-5. Every source here is fetched LIVE and none of it is snapshotted, so
    // "seeded and deterministic" describes the arithmetic, not the run. Two
    // reports with different fingerprints scored different data and must not be
    // compared as though they scored the same.
    lines.push(
      `> **Input fingerprint:** \`${fingerprintRows(
        data.rows.map((r) => `${r.player_id}|${r.week}|${r.proj_pts_ppr}|${r.actual_pts_ppr}`)
      )}\` over ${data.rows.length} rows — the inputs are fetched LIVE and are NOT snapshotted, so a rerun on a different day scores different data. Compare two reports only when this value matches.  `
    );
  } else {
    const src = (data as { source?: string }).source ?? "local";
    lines[0] = "# Brier Harness SELF-TEST — not a backtest";
    lines.push(`> ## THIS PAGE MEASURES NOTHING ABOUT THE MODEL.  `);
    lines.push(
      `> The "forecast" below is the rank of the ACTUAL PPR being scored, so it is a monotone ` +
        `function of the outcome. Discrimination is perfect by construction and every number here ` +
        `is a property of the arithmetic, not of any prediction. Audit 2026-08-22, P2-1.  `
    );
    lines.push(`> Its only use is confirming the scoring pipeline works: a perfect forecast must score perfectly.  `);
    lines.push(`> For real results run the Sleeper PROSPECTIVE path.  `);
    lines.push(`>  `);
    lines.push(`> **Season:** ${data.season}  `);
    lines.push(`> **Source:** ${src}  `);
    lines.push(`> **Method:** self-test — rank of actual PPR vs threshold on the same actual PPR  `);
    lines.push(
      `> **Input fingerprint:** \`${fingerprintRows(
        (data.rows as Array<{ player_id?: string; position: string; fantasy_points_ppr: number }>).map(
          (r, i) => `${r.player_id ?? i}|${r.position}|${r.fantasy_points_ppr}`
        )
      )}\` over ${data.rows.length} rows (fetched live, not snapshotted — P2-5).  `
    );
  }
  lines.push("", "---", "");

  const posResults: {
    pos: Position;
    score: number;
    reliability: number;
    resolution: number;
    clim: number;
    discrimEce?: number;
    calibScore?: number;
    calibEce?: number;
  }[] = [];

  for (const pos of POSITIONS) {
    let forecasts: BrierForecast[];
    let weekFolded: BrierForecast[][] = [];
    let hasWeekFolds = false;

    if (data.kind === "prospective") {
      forecasts = buildProspectiveForecasts(data.rows, pos);
      // k-fold by week (drop empty week-folds so an empty fold can't score a
      // spurious perfect 0 in the CV mean).
      const weekNums = Array.from(new Set(data.rows.filter((r) => r.position === pos).map((r) => r.week))).sort((a, b) => a - b);
      weekFolded = weekNums
        .map((w) => buildProspectiveForecasts((data.rows as ProspectiveRow[]).filter((r) => r.position === pos && r.week === w), pos))
        .filter((f) => f.length > 0);
      hasWeekFolds = weekFolded.length >= 2;
    } else {
      forecasts = buildSelfTestForecasts(data.rows, pos);
      // The assertion that turns a tautology into a useful invariant. The
      // predictor IS the outcome, so a working pipeline must score it as
      // perfectly discriminating. Anything less means the scoring code, the
      // threshold handling, or the tie handling is broken — which is the only
      // thing this path can legitimately tell us. Audit 2026-08-22, P2-1.
      const selfTestAuc = rankAuc(forecasts);
      if (selfTestAuc != null && selfTestAuc < 0.999) {
        console.error(
          `SELF-TEST FAILED for ${pos}: AUC ${selfTestAuc.toFixed(4)} < 0.999, but the "forecast" is ` +
            `a monotone function of the outcome. The scoring harness is broken.`
        );
        process.exitCode = 1;
      }
      if ((data as { hasWeek: boolean }).hasWeek) {
        const weekNums = Array.from(new Set((data.rows as PerWeekRow[]).filter((r) => r.position === pos).map((r) => r.week))).sort((a, b) => a - b);
        weekFolded = weekNums
          .map((w) => buildSelfTestForecasts((data.rows as PerWeekRow[]).filter((r) => r.position === pos && r.week === w), pos))
          .filter((f) => f.length > 0);
        hasWeekFolds = weekFolded.length >= 2;
      }
    }

    if (forecasts.length === 0) {
      lines.push(`## ${pos}\n\nNo data.\n`);
      continue;
    }

    const result = brierScore(forecasts);
    const diagram = reliabilityDiagram(forecasts, 10);
    const br = data.kind === "prospective"
      ? baseRate(data.rows as ProspectiveRow[], pos)
      : { clim: forecasts.filter((f) => f.outcome === 1).length / forecasts.length, n: forecasts.length, dnp: 0 };

    // Binned calibration error of the rank model (comparable across models,
    // unlike the Murphy reliability term which over-bins continuous probs).
    const discrimEce = expectedCalibrationError(forecasts, 10).ece;

    // Genuine calibration model (prospective only): OOF logistic on projected pts.
    const calibForecasts = data.kind === "prospective" ? buildLogisticCalibration(data.rows, pos) : [];
    const calibResult = calibForecasts.length > 0 ? brierScore(calibForecasts) : null;
    const calibDiagram = calibForecasts.length > 0 ? reliabilityDiagram(calibForecasts, 10) : null;
    const calibCal = calibForecasts.length > 0 ? expectedCalibrationError(calibForecasts, 10) : null;

    posResults.push({
      pos,
      score: result.score,
      reliability: result.reliability,
      resolution: result.resolution,
      clim: br.clim,
      discrimEce,
      calibScore: calibResult?.score,
      calibEce: calibCal?.ece
    });

    lines.push(`## ${pos}`);
    lines.push("");
    lines.push(
      `**Threshold:** ≥ ${THRESHOLDS[pos]} PPR pts | **n:** ${result.n.toLocaleString()} forecasts | ` +
      `**Base rate:** ${(br.clim * 100).toFixed(1)}% positive` +
      (data.kind === "prospective" ? ` (${br.dnp} DNP scored 0)` : "")
    );
    lines.push("");
    lines.push(data.kind === "prospective"
      ? "### Discrimination model — rank→prob (Murphy decomposition)"
      : "### Brier Score (Murphy Decomposition)");
    lines.push("");
    lines.push("| Component | Value | Notes |");
    lines.push("| --- | --- | --- |");
    lines.push(`| **Score** | ${result.score.toFixed(4)} | Lower is better (0=perfect, 0.25=random) |`);
    lines.push(`| Reliability | ${result.reliability.toFixed(4)} | Calibration error |`);
    lines.push(`| Resolution | ${result.resolution.toFixed(4)} | Sharpness beyond base rate |`);
    lines.push(`| Uncertainty | ${result.uncertainty.toFixed(4)} | Irreducible base-rate variance |`);
    lines.push(`| Check R−Res+U | ${(result.reliability - result.resolution + result.uncertainty).toFixed(4)} | = Score ✓ |`);
    lines.push("");

    if (hasWeekFolds && weekFolded.length >= 2) {
      const cvResult = kFoldCV(weekFolded, Math.min(5, weekFolded.length), (_train, test) => {
        const flat = test.flat();
        return flat.length > 0 ? brierScore(flat).score : 0;
      });
      lines.push(`### ${Math.min(5, weekFolded.length)}-Fold Cross-Validation (by week)`);
      lines.push("");
      lines.push(`| Mean Brier | Std | Fold scores |`);
      lines.push(`| --- | --- | --- |`);
      lines.push(`| ${cvResult.meanScore.toFixed(4)} | ${cvResult.stdScore.toFixed(4)} | ${cvResult.foldScores.map((s) => s.toFixed(3)).join(", ")} |`);
      lines.push("");
    }

    lines.push("### Reliability Diagram (ASCII)");
    lines.push("```");
    lines.push("Obs.freq │");
    for (const bin of [...diagram].reverse()) {
      const bar = asciiBar(bin.observedFreq, 20);
      lines.push(`${bin.observedFreq.toFixed(2)}     │${bar} f=${bin.meanForecast.toFixed(2)} n=${bin.n}`);
    }
    lines.push("         └" + "─".repeat(26));
    lines.push("           Forecast probability →");
    lines.push("```");
    lines.push("");

    // Calibration model subsection (prospective only): the projection's OWN
    // calibrated probability, out-of-fold by week. Its Reliability is the real
    // calibration error of the projections (vs. the rank map's invented one).
    if (calibResult && calibDiagram && calibCal) {
      lines.push("### Calibration model — out-of-fold logistic (projected pts → P(≥ threshold))");
      lines.push("");
      lines.push("| Metric | Value | Notes |");
      lines.push("| --- | --- | --- |");
      lines.push(`| **Brier** | ${calibResult.score.toFixed(4)} | OOF logistic Brier (leave-one-week-out) |`);
      lines.push(`| **ECE** | ${calibCal.ece.toFixed(4)} | Expected Calibration Error (10-bin) — the projections' TRUE calibration error |`);
      lines.push(`| MCE | ${calibCal.mce.toFixed(4)} | worst-bin calibration gap |`);
      lines.push(`| rank-model ECE | ${discrimEce.toFixed(4)} | same metric for the rank→prob model, for comparison |`);
      lines.push("");
      lines.push("```");
      lines.push("Obs.freq │");
      for (const bin of [...calibDiagram].reverse()) {
        const bar = asciiBar(bin.observedFreq, 20);
        lines.push(`${bin.observedFreq.toFixed(2)}     │${bar} f=${bin.meanForecast.toFixed(2)} n=${bin.n}`);
      }
      lines.push("         └" + "─".repeat(26));
      lines.push("           Forecast probability →");
      lines.push("```");
      lines.push("");
    }

    console.log(
      `  ${pos}: discrim Brier=${result.score.toFixed(4)} (ECE ${discrimEce.toFixed(4)}), n=${result.n}` +
      (calibResult && calibCal ? `; calib Brier=${calibResult.score.toFixed(4)} (ECE ${calibCal.ece.toFixed(4)})` : "") +
      (hasWeekFolds ? `, ${weekFolded.length} week folds` : "")
    );
  }

  lines.push("---", "", "## Interpretation", "");
  if (data.kind === "prospective" && posResults.length > 0) {
    // Data-driven: a forecast has net skill when Resolution > Reliability (it
    // beats the base-rate-only "climatology" forecast). Resolution > 0 means
    // projection ORDER separates scorers from non-scorers (discrimination).
    const beat = posResults.filter((r) => r.resolution > r.reliability);
    const discriminating = posResults.filter((r) => r.resolution > 0.001);
    const meanScore = posResults.reduce((s, r) => s + r.score, 0) / posResults.length;
    lines.push(
      "This is a **true prospective backtest**: pre-game projections vs post-game actual PPR. " +
      "It measures the **discrimination/ordinal skill** of projection rank, not the calibration of " +
      "the projection's own implied probabilities (the rank→prob map is ours, so Reliability reflects " +
      "that map's calibration, not Sleeper's)."
    );
    lines.push("");
    lines.push(
      `Mean Brier across positions: **${meanScore.toFixed(4)}**. ` +
      `${discriminating.length}/${posResults.length} positions show positive Resolution ` +
      `(projection order carries signal: ${discriminating.map((r) => r.pos).join(", ") || "none"}). ` +
      `${beat.length}/${posResults.length} beat the base-rate-only benchmark, i.e. Resolution > Reliability ` +
      `(${beat.map((r) => r.pos).join(", ") || "none"}).`
    );
    const worst = [...posResults].sort((a, b) => (b.reliability - b.resolution) - (a.reliability - a.resolution))[0];
    if (worst && worst.reliability > worst.resolution) {
      lines.push("");
      lines.push(
        `**Caveat:** ${worst.pos} has Reliability (${worst.reliability.toFixed(3)}) ≥ Resolution ` +
        `(${worst.resolution.toFixed(3)}) — the rank→prob mapping is mis-calibrated there and does not ` +
        `clear the base-rate-only forecast; treat its score as no better than climatology.`
      );
    }

    // Compare the calibration (logistic) model against the discrimination model
    // on the SAME binned metric (ECE), which is the apples-to-apples comparison.
    const withCalib = posResults.filter((r) => r.calibScore != null && r.calibEce != null && r.discrimEce != null);
    if (withCalib.length > 0) {
      const meanCalibBrier = withCalib.reduce((s, r) => s + r.calibScore!, 0) / withCalib.length;
      const meanRankBrier = withCalib.reduce((s, r) => s + r.score, 0) / withCalib.length;
      const meanCalibEce = withCalib.reduce((s, r) => s + r.calibEce!, 0) / withCalib.length;
      const meanRankEce = withCalib.reduce((s, r) => s + r.discrimEce!, 0) / withCalib.length;
      lines.push("");
      lines.push(
        `**Calibration model (out-of-fold logistic, projected pts → P(≥ threshold)).** Mean Brier ` +
        `**${meanCalibBrier.toFixed(4)}** vs the rank model's ${meanRankBrier.toFixed(4)}; mean Expected ` +
        `Calibration Error (10-bin) **${meanCalibEce.toFixed(4)}** vs the rank model's ${meanRankEce.toFixed(4)}. ` +
        (meanCalibEce < meanRankEce
          ? "Lower ECE means the projected POINTS carry genuine probability information beyond rank order — " +
            "mapping them through a fitted logistic yields better-calibrated start/sit probabilities and a " +
            "defensible probability the production model can consume directly."
          : "The logistic mapping does not beat the rank model on ECE here, so projected-point magnitude adds " +
            "little calibration value beyond rank order at these thresholds.") +
        " ECE is occupancy-weighted |observed − forecast| over 10 bins — comparable across models, unlike the " +
        "Murphy reliability term which over-bins the logistic's continuous probabilities."
      );
    }
  }
  lines.push("");
  lines.push(
    "**Scope:** this backtest measures weekly *start/sit projection discrimination* only. " +
      "The season simulator's `playoffProbability` / `championshipProbability` calibration " +
      "(targets Brier ≤ 0.20 / ≤ 0.10) is a different quantity, measured separately by " +
      "`scripts/brier-season-sim.ts` → `docs/season-calibration.md`."
  );
  lines.push("");
  lines.push("See `docs/calibration.md` for the full calibration contract.");

  const outPath = join(process.cwd(), "docs", "brier-results.md");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
