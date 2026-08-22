/**
 * Execute FROZEN PROTOCOL 5 exactly once.
 *
 * Protocol: reports/2026-08-20/holdout-protocol-5.md, committed 92616f7 BEFORE
 * any weight was fitted.
 *
 *   Does a weighted combination of points-to-date and usage beat points-to-date
 *   alone, at a weight fitted WITHOUT looking at the data it is judged on?
 *
 *   FIT  2021-2024 (protocol 4's already-spent data)
 *   EVAL 2017-2019 (never touched by any protocol)
 *
 *   npm run holdout:evaluate5
 *   npm run holdout:evaluate5 -- --self-test   # arithmetic only, no verdict
 *   npm run holdout:evaluate5 -- --dry-run     # sample shape, no metrics
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIR = "reports/2026-08-20/nflverse";
const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "reports/2026-08-20/holdout-result-5.md";

/** Frozen in protocol 5 §2. */
const FIT_SEASONS = ["2021", "2022", "2023", "2024"];
const EVAL_SEASONS = ["2017", "2018", "2019"];
const COVID_SEASON = "2020";

/** Inherited from protocol 4 §4, unchanged. */
const POSITIONS = new Set(["RB", "WR", "TE"]);
const SPLIT_WEEK = 8;
const LAST_WEEK = 17;
const MIN_GAMES = 4;

const BOOT = 5000;
const SEED = 20260824;
const ALPHA = 0.05;

// ── csv (identical to protocol 4) ──────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
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
      try { bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8")); }
      catch { bundle = {}; }
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

// ── build (protocol 4's preprocessing, verbatim) ───────────────────────────

interface Row {
  playerId: string;
  season: string;
  position: string;
  zPoints: number;
  zTouches: number;
  zOutcome: number;
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
      const fp = num(r[ix.fantasy_points_ppr!]);
      if (week <= SPLIT_WEEK) {
        a.gE += 1;
        a.pE += fp;
        a.tE += num(r[ix.carries!]) + num(r[ix.targets!]);
      } else {
        a.gL += 1;
        a.pL += fp;
      }
    }
  }

  const kept = [...acc.values()].filter((a) => a.gE >= MIN_GAMES && a.gL >= MIN_GAMES);
  for (const a of kept) { a.pE /= a.gE; a.tE /= a.gE; a.pL /= a.gL; }

  // Standardise WITHIN (season, position) — protocol 4 §4.8.
  const groups = new Map<string, Acc[]>();
  for (const a of kept) {
    const k = `${a.season}:${a.position}`;
    const g = groups.get(k);
    if (g) g.push(a); else groups.set(k, [a]);
  }
  const z = (xs: number[]) => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
    return (v: number) => (sd > 0 ? (v - m) / sd : 0);
  };
  const out: Row[] = [];
  for (const g of groups.values()) {
    if (g.length < 5) continue;
    const zp = z(g.map((x) => x.pE));
    const zt = z(g.map((x) => x.tE));
    const zo = z(g.map((x) => x.pL));
    for (const x of g) {
      out.push({
        playerId: x.playerId, season: x.season, position: x.position,
        zPoints: zp(x.pE), zTouches: zt(x.tE), zOutcome: zo(x.pL)
      });
    }
  }
  return out;
}

// ── statistics ─────────────────────────────────────────────────────────────

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function rankAverage(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const out = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]!]! === xs[idx[i]!]!) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[idx[k]!] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const mx = mean(xs), my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    n += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
}

const spearman = (xs: number[], ys: number[]) => pearson(rankAverage(xs), rankAverage(ys));

/**
 * OLS of zOutcome on [zPoints, zTouches]. Returns the two coefficients.
 * Two predictors only, so the 2x2 normal equations are solved directly —
 * no pivoting needed and no library.
 */
function fitWeights(rows: Row[]): { bPoints: number; bTouches: number; w: number } {
  let sxx = 0, sxy = 0, syy = 0, sxo = 0, syo = 0;
  for (const r of rows) {
    sxx += r.zPoints * r.zPoints;
    syy += r.zTouches * r.zTouches;
    sxy += r.zPoints * r.zTouches;
    sxo += r.zPoints * r.zOutcome;
    syo += r.zTouches * r.zOutcome;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return { bPoints: 0, bTouches: 0, w: 0 };
  const bPoints = (syy * sxo - sxy * syo) / det;
  const bTouches = (sxx * syo - sxy * sxo) / det;
  return { bPoints, bTouches, w: bPoints === 0 ? 0 : bTouches / bPoints };
}

const weighted = (r: Row, w: number) => r.zPoints + w * r.zTouches;

/** H1: paired gain in Spearman from adding the weighted usage term. */
function gain(rows: Row[], w: number): number {
  const y = rows.map((r) => r.zOutcome);
  return spearman(rows.map((r) => weighted(r, w)), y) - spearman(rows.map((r) => r.zPoints), y);
}

/** H2: the same gain computed within position, pooled by Fisher z weighted by n. */
function gainWithinPosition(rows: Row[], w: number): number {
  const byPos = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byPos.get(r.position);
    if (g) g.push(r); else byPos.set(r.position, [r]);
  }
  let sum = 0, wt = 0;
  for (const g of byPos.values()) {
    if (g.length < 10) continue;
    sum += gain(g, w) * g.length;
    wt += g.length;
  }
  return wt === 0 ? 0 : sum / wt;
}

/** H3: at matched points-to-date, does the weighted score pick the better player? */
function decileConcordance(rows: Row[], w: number): number {
  const sorted = [...rows].sort((a, b) => a.zPoints - b.zPoints);
  const per = Math.max(1, Math.floor(sorted.length / 10));
  const buckets = new Map<number, Row[]>();
  sorted.forEach((r, i) => {
    const b = Math.min(9, Math.floor(i / per));
    const g = buckets.get(b);
    if (g) g.push(r); else buckets.set(b, [r]);
  });
  let wins = 0, total = 0;
  for (const g of buckets.values()) {
    for (let i = 0; i < g.length; i += 1) {
      for (let j = i + 1; j < g.length; j += 1) {
        const a = g[i]!, b = g[j]!;
        const sa = weighted(a, w), sb = weighted(b, w);
        if (sa === sb) continue;
        const hi = sa > sb ? a : b, lo = sa > sb ? b : a;
        total += 1;
        if (hi.zOutcome > lo.zOutcome) wins += 1;
        else if (hi.zOutcome === lo.zOutcome) wins += 0.5;
      }
    }
  }
  return total === 0 ? 0.5 : wins / total;
}

/** Cluster bootstrap over PLAYERS (protocol 5 §5). */
function clusterBootstrap(
  rows: Row[],
  stat: (r: Row[]) => number,
  nullValue: number,
  seed: number
) {
  const byPlayer = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byPlayer.get(r.playerId);
    if (g) g.push(r); else byPlayer.set(r.playerId, [r]);
  }
  const keys = [...byPlayer.keys()];
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const samples: number[] = [];
  for (let i = 0; i < BOOT; i += 1) {
    const draw: Row[] = [];
    for (let k = 0; k < keys.length; k += 1) draw.push(...byPlayer.get(keys[Math.floor(rand() * keys.length)]!)!);
    const v = stat(draw);
    if (Number.isFinite(v)) samples.push(v);
  }
  samples.sort((a, b) => a - b);
  return {
    lo: samples[Math.floor(0.025 * samples.length)] ?? Number.NaN,
    hi: samples[Math.floor(0.975 * samples.length)] ?? Number.NaN,
    p: (samples.filter((v) => v <= nullValue).length + 1) / (samples.length + 1),
    clusters: keys.length
  };
}

function holm(tests: Array<{ id: string; p: number }>) {
  const ordered = [...tests].sort((a, b) => a.p - b.p);
  const m = ordered.length;
  const out: Array<{ id: string; p: number; threshold: number; reject: boolean }> = [];
  let still = true;
  ordered.forEach((t, i) => {
    const threshold = ALPHA / (m - i);
    const reject = still && t.p <= threshold;
    if (!reject) still = false;
    out.push({ ...t, threshold, reject });
  });
  return out;
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): void {
  const fails: string[] = [];
  const ok = (n: string, cond: boolean, detail = "") => {
    if (cond) console.log(`  ok  ${n}`);
    else fails.push(`${n} ${detail}`);
  };

  ok("spearman perfect", Math.abs(spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1) < 1e-9);
  ok("spearman inverted", Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);

  // OLS must recover a known relationship. outcome = 1*points + 0.5*touches.
  const synth: Row[] = [];
  for (let i = 0; i < 200; i += 1) {
    const p = Math.sin(i) * 1.3;
    const t = Math.cos(i * 0.7) * 0.9;
    synth.push({ playerId: `p${i}`, season: "x", position: "RB", zPoints: p, zTouches: t, zOutcome: p + 0.5 * t });
  }
  const f = fitWeights(synth);
  ok("OLS recovers w=0.5", Math.abs(f.w - 0.5) < 0.02, `got ${f.w.toFixed(4)}`);

  // A useless predictor must fit to roughly zero weight.
  const noise: Row[] = synth.map((r, i) => ({ ...r, zTouches: ((i * 37) % 11) - 5, zOutcome: r.zPoints }));
  ok("OLS gives ~0 weight to noise", Math.abs(fitWeights(noise).w) < 0.15, `got ${fitWeights(noise).w.toFixed(4)}`);

  // gain() must be positive when the weighted score is genuinely better, and
  // ~0 at w=0 by construction.
  ok("gain is 0 at w=0", Math.abs(gain(synth, 0)) < 1e-12);
  ok("gain is positive at the true weight", gain(synth, 0.5) > 0, `got ${gain(synth, 0.5).toFixed(6)}`);

  const h = holm([{ id: "A", p: 0.01 }, { id: "B", p: 0.04 }, { id: "C", p: 0.9 }]);
  ok("Holm rejects only A", h.filter((x) => x.reject).map((x) => x.id).join(",") === "A");

  // Bootstrap must resample CLUSTERS: one player => no spread.
  const one: Row[] = Array.from({ length: 40 }, (_, i) => ({
    playerId: "P1", season: "x", position: "RB", zPoints: i, zTouches: i, zOutcome: i
  }));
  ok("bootstrap clusters, not rows", clusterBootstrap(one, (r) => gain(r, 0.5), 0, 1).clusters === 1);

  // The builder must reproduce protocol 4 EXACTLY on protocol 4's seasons.
  // Asserting verbatim inheritance empirically rather than by claim.
  const p4 = build(FIT_SEASONS);
  const players = new Set(p4.map((r) => r.playerId)).size;
  ok("preprocessing matches protocol 4 (958 rows)", p4.length === 958, `got ${p4.length}`);
  ok("preprocessing matches protocol 4 (452 players)", players === 452, `got ${players}`);

  if (fails.length > 0) {
    console.error("\nSELF-TEST FAILED:");
    for (const f2 of fails) console.error("  - " + f2);
    process.exit(1);
  }
  console.log("\nself-test PASSED — arithmetic verified, evaluation set untouched.");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const fit = build(FIT_SEASONS);
  const evalRows = build(EVAL_SEASONS);

  if (process.argv.includes("--dry-run")) {
    console.log(`dry run — fit ${fit.length} rows / ${new Set(fit.map((r) => r.playerId)).size} players`);
    console.log(`          eval ${evalRows.length} rows / ${new Set(evalRows.map((r) => r.playerId)).size} players`);
    console.log("NO weight fitted, NO metric computed.");
    return;
  }
  if (evalRows.length < 100) { console.error("evaluation set too small"); process.exit(2); }

  // THE WEIGHT — fitted on the fit set only, once.
  const fitted = fitWeights(fit);
  const w = fitted.w;

  const evalClusters = new Set(evalRows.map((r) => r.playerId)).size;

  say("# Holdout result 5 — what weight should opportunity carry?");
  say();
  say(`**Executed** ${new Date().toISOString()} · **Protocol** [holdout-protocol-5.md](./holdout-protocol-5.md) (frozen \`92616f7\`)`);
  say();
  say("> Weight fitted on **2021–2024** (protocol 4's already-spent data), evaluated on **2017–2019**, which no protocol in this audit has touched. The weight was computed once and never adjusted.");
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| fit set | ${fit.length} player-seasons, ${new Set(fit.map((r) => r.playerId)).size} players |`);
  say(`| evaluation set | **${evalRows.length}** player-seasons, **${evalClusters}** players |`);
  say(`| b_points (fit) | ${fitted.bPoints.toFixed(4)} |`);
  say(`| b_touches (fit) | ${fitted.bTouches.toFixed(4)} |`);
  say(`| **fitted weight w** | **${w.toFixed(4)}** |`);
  say();

  const h1 = gain(evalRows, w);
  const h2 = gainWithinPosition(evalRows, w);
  const h3 = decileConcordance(evalRows, w);
  const b1 = clusterBootstrap(evalRows, (r) => gain(r, w), 0, SEED);
  const b2 = clusterBootstrap(evalRows, (r) => gainWithinPosition(r, w), 0, SEED + 1);
  const b3 = clusterBootstrap(evalRows, (r) => decileConcordance(r, w), 0.5, SEED + 2);

  const fam = holm([{ id: "H1", p: b1.p }, { id: "H2", p: b2.p }, { id: "H3", p: b3.p }]);
  const v = new Map(fam.map((f) => [f.id, f]));

  say("## Confirmatory tests on the UNTOUCHED evaluation set (Holm, all three required)");
  say();
  say("| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |");
  say("|---|---|---|---|---|---|---|");
  say(`| H1 | weighted beats points alone | ${h1.toFixed(4)} | [${b1.lo.toFixed(4)}, ${b1.hi.toFixed(4)}] | ${b1.p.toFixed(4)} | ${v.get("H1")!.threshold.toFixed(4)} | ${v.get("H1")!.reject ? "**YES**" : "no"} |`);
  say(`| H2 | same, WITHIN position | ${h2.toFixed(4)} | [${b2.lo.toFixed(4)}, ${b2.hi.toFixed(4)}] | ${b2.p.toFixed(4)} | ${v.get("H2")!.threshold.toFixed(4)} | ${v.get("H2")!.reject ? "**YES**" : "no"} |`);
  say(`| H3 | decile concordance (>0.5) | ${h3.toFixed(4)} | [${b3.lo.toFixed(4)}, ${b3.hi.toFixed(4)}] | ${b3.p.toFixed(4)} | ${v.get("H3")!.threshold.toFixed(4)} | ${v.get("H3")!.reject ? "**YES**" : "no"} |`);
  say();
  say(`Cluster bootstrap over **${b1.clusters} players**, ${BOOT} resamples.`);
  say();

  const all = fam.every((f) => f.reject);
  say(`### Verdict: ${all ? "**THE WEIGHT GENERALISES**" : "**NOT DEMONSTRATED**"}`);
  say();
  say(all
    ? `All three pre-registered hypotheses survive Holm correction on seasons the weight was never fitted on. w = ${w.toFixed(4)} is licensed for the in-season ranking.`
    : "Protocol 5 §6 requires **all three**. The weight is NOT licensed. Per §9 the honest reading is that opportunity is real (protocol 4) but its magnitude is not stable enough to encode; no weight is changed and no threshold is retried.");
  say();

  say("## Diagnostics (reported, NOT adjudicating)");
  say();
  const refit = fitWeights(evalRows);
  say("### D2 — the weight refitted independently on the evaluation set");
  say();
  say("| set | b_points | b_touches | w |");
  say("|---|---|---|---|");
  say(`| fit (2021–2024) | ${fitted.bPoints.toFixed(4)} | ${fitted.bTouches.toFixed(4)} | **${w.toFixed(4)}** |`);
  say(`| eval (2017–2019) | ${refit.bPoints.toFixed(4)} | ${refit.bTouches.toFixed(4)} | **${refit.w.toFixed(4)}** |`);
  say();
  say(refit.w * w > 0
    ? "Same sign in both eras."
    : "**Opposite signs** — the weight does not carry across eras, whatever H1 says.");
  say();

  const withCovid = build([...EVAL_SEASONS, COVID_SEASON]);
  say("### D3 — evaluation with 2020 added back (the a-priori exclusion)");
  say();
  say(`With 2020: ${withCovid.length} player-seasons, gain ${gain(withCovid, w).toFixed(4)} (primary excluded it: ${h1.toFixed(4)}).`);
  say();

  const y = evalRows.map((r) => r.zOutcome);
  say("### D4 — out-of-sample Spearman on the evaluation set");
  say();
  say("| model | Spearman vs weeks 9–17 |");
  say("|---|---|");
  say(`| points-to-date alone | ${spearman(evalRows.map((r) => r.zPoints), y).toFixed(4)} |`);
  say(`| touches alone | ${spearman(evalRows.map((r) => r.zTouches), y).toFixed(4)} |`);
  say(`| **points + ${w.toFixed(3)} × touches** | **${spearman(evalRows.map((r) => weighted(r, w)), y).toFixed(4)}** |`);
  say();

  say("### D5 — sensitivity of the gain to w");
  say();
  say("| w | gain on eval |");
  say("|---|---|");
  for (const cand of [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0]) {
    say(`| ${cand.toFixed(2)}${Math.abs(cand - w) < 0.051 ? " ← fitted" : ""} | ${gain(evalRows, cand).toFixed(4)} |`);
  }
  say();

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

const direct = (process.argv[1] ?? "").split("\\").join("/").endsWith("holdout-evaluate-5.ts");
if (direct) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
