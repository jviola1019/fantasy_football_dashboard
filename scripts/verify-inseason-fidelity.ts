/**
 * FIDELITY CHECK — does the SHIPPED ranking compute what protocol 5 validated?
 *
 * This is deliberately NOT a new protocol, and calling it one would inflate what
 * it is. Protocols 4 and 5 already settled the hypothesis: in-season usage
 * predicts rest-of-season scoring beyond points already scored. Re-testing that
 * would be re-testing a settled question, which the frozen-protocol discipline
 * exists to prevent.
 *
 * The open question is different, and it is an engineering one:
 *
 *   **Does `src/lib/models/inSeasonScore.ts` — the code that will actually rank
 *   players for users — compute the same statistic the validated harness did?**
 *
 * A model can be validated and then shipped as something subtly different: a
 * standardisation applied across positions instead of within them, a weight
 * applied to the wrong term, a cohort filter that changes who is compared. Each
 * would leave the protocol's result intact and the product's behaviour
 * unjustified. That gap is where "validated" quietly stops being true.
 *
 * So this replays protocol 5's evaluation set through the SHIPPED function and
 * checks it reproduces the published gain.
 *
 *   npm run verify:inseason
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { rankCohort, OPPORTUNITY_WEIGHT } from "../src/lib/models/inSeasonScore";

const DIR = "reports/2026-08-20/nflverse";
const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";

/** Protocol 5 §2–§3, copied verbatim so the comparison is like for like. */
const EVAL_SEASONS = ["2017", "2018", "2019"];
const POSITIONS = new Set(["RB", "WR", "TE"]);
const SPLIT_WEEK = 8;
const LAST_WEEK = 17;
const MIN_GAMES = 4;

/** Protocol 5's published H1 gain on the evaluation set. */
const PUBLISHED_GAIN = 0.0195;
const TOLERANCE = 0.0002;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const QUOTE = String.fromCharCode(34);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
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

let bundle: Record<string, string> | null = null;
function readCsv(name: string): string[][] | null {
  try {
    return parseCsv(readFileSync(join(DIR, `${name}.csv`), "utf8"));
  } catch {
    if (bundle == null) {
      try {
        bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8"));
      } catch {
        bundle = {};
      }
    }
    const text = bundle![name];
    return text ? parseCsv(text) : null;
  }
}

const num = (v: string | undefined): number => {
  if (v == null || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  id: string;
  season: string;
  position: string;
  pointsPerGame: number;
  touchesPerGame: number;
  outcome: number;
}

function build(seasons: string[]): Row[] {
  interface Acc {
    playerId: string; season: string; position: string;
    gE: number; gL: number; pE: number; tE: number; pL: number;
  }
  const acc = new Map<string, Acc>();

  for (const season of seasons) {
    const csv = readCsv(`player_stats_${season}`);
    if (!csv || csv.length < 2) continue;
    const head = csv[0]!;
    const ix = Object.fromEntries(head.map((h, i) => [h, i])) as Record<string, number>;

    for (const r of csv.slice(1)) {
      if (r.length !== head.length) continue;
      if (r[ix.season_type!] !== "REG") continue;
      const position = r[ix.position!]!;
      if (!POSITIONS.has(position)) continue;
      const week = num(r[ix.week!]);
      if (week < 1 || week > LAST_WEEK) continue;

      const key = `${season}:${r[ix.player_id!]}`;
      let a = acc.get(key);
      if (!a) {
        a = { playerId: r[ix.player_id!]!, season, position, gE: 0, gL: 0, pE: 0, tE: 0, pL: 0 };
        acc.set(key, a);
      }
      const pts = num(r[ix.fantasy_points_ppr!]);
      const touches = num(r[ix.carries!]) + num(r[ix.targets!]);
      if (week <= SPLIT_WEEK) { a.gE += 1; a.pE += pts; a.tE += touches; }
      else { a.gL += 1; a.pL += pts; }
    }
  }

  return [...acc.values()]
    .filter((a) => a.gE >= MIN_GAMES && a.gL >= MIN_GAMES)
    .map((a) => ({
      id: `${a.season}:${a.playerId}`,
      season: a.season,
      position: a.position,
      pointsPerGame: a.pE / a.gE,
      touchesPerGame: a.tE / a.gE,
      outcome: a.pL / a.gL
    }));
}

/**
 * Mid-rank Spearman — imported, not reimplemented.
 *
 * This file used to carry its own copy under a comment reading "matching
 * `src/lib/trade/backtest.ts` after P2-4". Two implementations of one statistic,
 * with a comment asserting they agree, is a drift hazard wearing a disclaimer:
 * the next correction to either one silently makes the comment false, and this
 * script is the CI gate that proves the shipped ranker reproduces protocol 5.
 *
 * Importing it also gives `trade/backtest.ts` a caller that is not a test
 * (audit 2026-08-24 reachability pass), which is what it should have had.
 */
import { spearman } from "../src/lib/trade/backtest";

function main(): void {
  const rows = build(EVAL_SEASONS);
  if (rows.length === 0) {
    console.error("FAIL — no rows built; the archive is missing or unreadable.");
    process.exitCode = 1;
    return;
  }

  // Standardise WITHIN (season, position), as both protocols did, by handing
  // each cohort to the shipped ranker separately. If the shipped code
  // standardised across positions this is where the number would diverge.
  const cohorts = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.season}:${r.position}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), r]);
  }

  const scored: Array<{ row: Row; score: number; zPoints: number; zOutcome: number }> = [];
  for (const cohort of cohorts.values()) {
    const ranked = rankCohort(
      cohort.map((r) => ({ id: r.id, pointsPerGame: r.pointsPerGame, touchesPerGame: r.touchesPerGame })),
      OPPORTUNITY_WEIGHT
    );
    const byId = new Map(ranked.map((x) => [x.id, x]));

    // The OUTCOME is standardised within cohort too, because protocol 5 does
    // (`gain()` correlates against `r.zOutcome`, not the raw per-game figure).
    // Spearman is rank-based, so standardising within cohort changes the
    // cross-cohort ordering of outcomes — using the raw value here was a defect
    // in THIS CHECK, and it accounted for most of the gap it was reporting.
    // Population sd, matching the harness.
    const outs = cohort.map((r) => r.outcome);
    const mo = outs.reduce((a, b) => a + b, 0) / outs.length;
    const sdo = Math.sqrt(outs.reduce((a, b) => a + (b - mo) ** 2, 0) / outs.length);
    const zo = (v: number) => (sdo > 0 ? (v - mo) / sdo : 0);

    for (const r of cohort) {
      const x = byId.get(r.id);
      if (x) scored.push({ row: r, score: x.score, zPoints: x.zPoints, zOutcome: zo(r.outcome) });
    }
  }

  const y = scored.map((s) => s.zOutcome);
  const withUsage = spearman(scored.map((s) => s.score), y);
  const pointsOnly = spearman(scored.map((s) => s.zPoints), y);
  const gain = withUsage - pointsOnly;
  const delta = Math.abs(gain - PUBLISHED_GAIN);
  const ok = delta <= TOLERANCE;

  console.log("in-season ranking — fidelity against protocol 5\n");
  console.log(`evaluation seasons     ${EVAL_SEASONS.join(", ")} (never used to fit the weight)`);
  console.log(`player-seasons         ${scored.length}`);
  console.log(`cohorts                ${cohorts.size}  (season x position)`);
  console.log(`weight                 ${OPPORTUNITY_WEIGHT}\n`);
  console.log(`Spearman, points only  ${pointsOnly.toFixed(4)}`);
  console.log(`Spearman, + usage      ${withUsage.toFixed(4)}`);
  console.log(`gain (shipped code)    ${gain.toFixed(4)}`);
  console.log(`gain (protocol 5)      ${PUBLISHED_GAIN.toFixed(4)}`);
  console.log(`difference             ${delta.toFixed(6)}   tolerance ${TOLERANCE}\n`);

  if (ok) {
    console.log(
      "PASS — the shipped ranker reproduces the validated statistic. What users\n" +
        "will be ranked by is the thing that was tested, not something that resembles it."
    );
  } else {
    console.error(
      "FAIL — the shipped ranker does NOT reproduce protocol 5's gain.\n" +
        "The product would be ranking players by something the protocol never validated.\n" +
        "Do not ship this until the difference is explained."
    );
    process.exitCode = 1;
  }
}

main();
