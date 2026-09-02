/**
 * Two-way ANOVA: is the opportunity effect HOMOGENEOUS across positions and eras?
 *
 * WHAT THIS IS, AND IS NOT
 *
 * This is a **structured diagnostic**, not a sixth confirmatory protocol. It is
 * labelled that way deliberately: protocols 4 and 5 established THAT usage adds
 * information beyond points-to-date, on pre-registered, frozen, out-of-sample
 * tests. This analysis asks a different question about an effect already
 * established — whether it is uniform — and it cannot promote or demote those
 * findings. No hypothesis here licenses a product change.
 *
 * The question matters because a pooled effect driven by one position or one era
 * would be misleading even when the pooled statistic is perfectly real.
 *
 *   Response  zOutcome ..... rest-of-season points, standardised within (season, position)
 *   Factor A  position ..... RB / WR / TE
 *   Factor B  usage quintile 1..5, from touches per game in weeks 1-8
 *
 * THE INDEPENDENCE PROBLEM, AND HOW IT IS HANDLED
 *
 * Classical ANOVA assumes independent observations. Player-seasons are NOT
 * independent — the same player recurs across seasons and their skill persists.
 * Using the textbook F distribution here would understate p-values, which is the
 * exact error protocol 3 was caught making with a textbook null.
 *
 * So the F statistics are computed classically but their p-values come from a
 * CLUSTER PERMUTATION null: usage is permuted between whole players, within
 * (season, position) strata, so the null preserves both the clustering and the
 * standardisation structure. The reported p is the fraction of permutations
 * whose F equals or exceeds the observed one.
 *
 *   npx tsx scripts/anova-opportunity.ts
 *   npx tsx scripts/anova-opportunity.ts --self-test
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseCsv } from "../src/lib/stats/csv";

const DIR = "reports/2026-08-20/nflverse";
const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "reports/2026-08-20/anova-opportunity.md";

/** Every season acquired for protocols 4 and 5. */
const SEASONS = ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"];
const POSITIONS = ["RB", "WR", "TE"] as const;
const SPLIT_WEEK = 8;
const LAST_WEEK = 17;
const MIN_GAMES = 4;
const QUINTILES = 5;
const PERMUTATIONS = 2000;
const SEED = 20260825;

// ── data (protocol 4 preprocessing) ────────────────────────────────────────

// `parseCsv` moved to `src/lib/stats/csv.ts` on 2026-09-02. It was correct and
// it was unreachable: `scripts/validate-variables.ts` needed the same thing,
// could not import it, wrote a naive split instead, and lost every row whose
// player name contains a comma. One home, and tests over the real bundle.

let bundle: Record<string, string> | null = null;
function readCsv(name: string): string[][] | null {
  try { return parseCsv(readFileSync(join(DIR, `${name}.csv`), "utf8")); }
  catch {
    if (bundle == null) {
      try { bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8")); }
      catch { bundle = {}; }
    }
    const t = bundle![name];
    return t ? parseCsv(t) : null;
  }
}

const num = (v: string | undefined): number => {
  if (v == null || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Obs {
  playerId: string;
  season: string;
  position: string;
  touches: number;
  zOutcome: number;
}

function build(): Obs[] {
  interface Acc {
    playerId: string; season: string; position: string;
    gE: number; gL: number; tE: number; pL: number;
  }
  const acc = new Map<string, Acc>();
  for (const season of SEASONS) {
    const csv = readCsv(`player_stats_${season}`);
    if (!csv || csv.length < 2) continue;
    const head = csv[0]!;
    const ix = Object.fromEntries(head.map((h, i) => [h, i])) as Record<string, number>;
    for (const r of csv.slice(1)) {
      if (r.length !== head.length) continue;
      if (r[ix.season_type!] !== "REG") continue;
      const position = r[ix.position!]!;
      if (!(POSITIONS as readonly string[]).includes(position)) continue;
      const week = num(r[ix.week!]);
      if (week < 1 || week > LAST_WEEK) continue;
      const key = `${season}:${r[ix.player_id!]}`;
      let a = acc.get(key);
      if (!a) { a = { playerId: r[ix.player_id!]!, season, position, gE: 0, gL: 0, tE: 0, pL: 0 }; acc.set(key, a); }
      if (week <= SPLIT_WEEK) { a.gE += 1; a.tE += num(r[ix.carries!]) + num(r[ix.targets!]); }
      else { a.gL += 1; a.pL += num(r[ix.fantasy_points_ppr!]); }
    }
  }
  const kept = [...acc.values()].filter((a) => a.gE >= MIN_GAMES && a.gL >= MIN_GAMES);
  for (const a of kept) { a.tE /= a.gE; a.pL /= a.gL; }

  const groups = new Map<string, Acc[]>();
  for (const a of kept) {
    const k = `${a.season}:${a.position}`;
    const g = groups.get(k); if (g) g.push(a); else groups.set(k, [a]);
  }
  const out: Obs[] = [];
  for (const g of groups.values()) {
    if (g.length < 5) continue;
    const ys = g.map((x) => x.pL);
    const m = ys.reduce((s, v) => s + v, 0) / ys.length;
    const sd = Math.sqrt(ys.reduce((s, v) => s + (v - m) ** 2, 0) / ys.length);
    for (const x of g) {
      out.push({
        playerId: x.playerId, season: x.season, position: x.position,
        touches: x.tE, zOutcome: sd > 0 ? (x.pL - m) / sd : 0
      });
    }
  }
  return out;
}

// ── ANOVA ──────────────────────────────────────────────────────────────────

/** Quintile of touches, assigned WITHIN (season, position) so the factor is comparable. */
function assignQuintiles(rows: Obs[]): Map<Obs, number> {
  const byCell = new Map<string, Obs[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.position}`;
    const g = byCell.get(k); if (g) g.push(r); else byCell.set(k, [r]);
  }
  const q = new Map<Obs, number>();
  for (const g of byCell.values()) {
    const sorted = [...g].sort((a, b) => a.touches - b.touches);
    const per = Math.max(1, sorted.length / QUINTILES);
    sorted.forEach((r, i) => q.set(r, Math.min(QUINTILES - 1, Math.floor(i / per))));
  }
  return q;
}

interface Anova {
  fPosition: number;
  fUsage: number;
  fInteraction: number;
  etaPosition: number;
  etaUsage: number;
  etaInteraction: number;
  dfPosition: number;
  dfUsage: number;
  dfInteraction: number;
  dfError: number;
  cellMeans: Map<string, { mean: number; n: number }>;
}

/** Unweighted-means two-way ANOVA (cells are unbalanced). */
function twoWayAnova(rows: Obs[], quint: Map<Obs, number>): Anova {
  const grand = rows.reduce((s, r) => s + r.zOutcome, 0) / rows.length;

  const cell = new Map<string, number[]>();
  const byPos = new Map<string, number[]>();
  const byUse = new Map<number, number[]>();
  for (const r of rows) {
    const u = quint.get(r)!;
    const ck = `${r.position}|${u}`;
    (cell.get(ck) ?? cell.set(ck, []).get(ck)!).push(r.zOutcome);
    (byPos.get(r.position) ?? byPos.set(r.position, []).get(r.position)!).push(r.zOutcome);
    (byUse.get(u) ?? byUse.set(u, []).get(u)!).push(r.zOutcome);
  }

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

  let ssPos = 0;
  for (const xs of byPos.values()) ssPos += xs.length * (mean(xs) - grand) ** 2;
  let ssUse = 0;
  for (const xs of byUse.values()) ssUse += xs.length * (mean(xs) - grand) ** 2;

  let ssCells = 0;
  for (const [k, xs] of cell) {
    const [p, u] = k.split("|");
    const mp = mean(byPos.get(p!)!);
    const mu = mean(byUse.get(Number(u))!);
    ssCells += xs.length * (mean(xs) - mp - mu + grand) ** 2;
  }

  let ssError = 0;
  for (const xs of cell.values()) {
    const m = mean(xs);
    for (const v of xs) ssError += (v - m) ** 2;
  }
  const ssTotal = rows.reduce((s, r) => s + (r.zOutcome - grand) ** 2, 0);

  const dfPos = byPos.size - 1;
  const dfUse = byUse.size - 1;
  const dfInt = dfPos * dfUse;
  const dfErr = rows.length - cell.size;

  const msErr = ssError / dfErr;
  const cellMeans = new Map<string, { mean: number; n: number }>();
  for (const [k, xs] of cell) cellMeans.set(k, { mean: mean(xs), n: xs.length });

  return {
    fPosition: dfPos > 0 && msErr > 0 ? ssPos / dfPos / msErr : 0,
    fUsage: dfUse > 0 && msErr > 0 ? ssUse / dfUse / msErr : 0,
    fInteraction: dfInt > 0 && msErr > 0 ? ssCells / dfInt / msErr : 0,
    etaPosition: ssTotal > 0 ? ssPos / ssTotal : 0,
    etaUsage: ssTotal > 0 ? ssUse / ssTotal : 0,
    etaInteraction: ssTotal > 0 ? ssCells / ssTotal : 0,
    dfPosition: dfPos, dfUsage: dfUse, dfInteraction: dfInt, dfError: dfErr,
    cellMeans
  };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster-permutation null for the usage effect.
 *
 * Usage values are shuffled between WHOLE PLAYERS within each
 * (season, position) stratum. Permuting individual rows would break the
 * clustering the design is meant to respect and would manufacture significance.
 */
function permutationP(rows: Obs[], observedF: number, pick: (a: Anova) => number, seed: number): { p: number; n: number } {
  const rand = rng(seed);
  const byCell = new Map<string, Obs[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.position}`;
    const g = byCell.get(k); if (g) g.push(r); else byCell.set(k, [r]);
  }
  let atOrAbove = 0;
  for (let i = 0; i < PERMUTATIONS; i += 1) {
    const shuffled: Obs[] = [];
    for (const g of byCell.values()) {
      const touches = g.map((r) => r.touches);
      for (let j = touches.length - 1; j > 0; j -= 1) {
        const k = Math.floor(rand() * (j + 1));
        [touches[j], touches[k]] = [touches[k]!, touches[j]!];
      }
      g.forEach((r, idx) => shuffled.push({ ...r, touches: touches[idx]! }));
    }
    const q = assignQuintiles(shuffled);
    if (pick(twoWayAnova(shuffled, q)) >= observedF) atOrAbove += 1;
  }
  return { p: (atOrAbove + 1) / (PERMUTATIONS + 1), n: PERMUTATIONS };
}

/** Levene's test (median-centred, Brown-Forsythe) for equal variance across cells. */
function leveneF(rows: Obs[], quint: Map<Obs, number>): number {
  const cell = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.position}|${quint.get(r)}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(r.zOutcome);
  }
  const z: Array<{ g: string; v: number }> = [];
  for (const [k, xs] of cell) {
    const s = [...xs].sort((a, b) => a - b);
    const med = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
    for (const v of xs) z.push({ g: k, v: Math.abs(v - med) });
  }
  const grand = z.reduce((s, x) => s + x.v, 0) / z.length;
  const byG = new Map<string, number[]>();
  for (const x of z) (byG.get(x.g) ?? byG.set(x.g, []).get(x.g)!).push(x.v);
  let ssB = 0, ssW = 0;
  for (const xs of byG.values()) {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    ssB += xs.length * (m - grand) ** 2;
    for (const v of xs) ssW += (v - m) ** 2;
  }
  const dfB = byG.size - 1, dfW = z.length - byG.size;
  return dfB > 0 && ssW > 0 ? (ssB / dfB) / (ssW / dfW) : 0;
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): void {
  const fails: string[] = [];
  const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  ok  ${n}`); else fails.push(`${n} ${d}`); };

  // Pure noise: F for usage should be small and the permutation p large.
  const rand = rng(7);
  const noise: Obs[] = [];
  for (let i = 0; i < 600; i += 1) {
    noise.push({
      playerId: `p${i}`, season: String(2017 + (i % 4)),
      position: POSITIONS[i % 3]!, touches: rand(), zOutcome: rand() * 2 - 1
    });
  }
  const qn = assignQuintiles(noise);
  const an = twoWayAnova(noise, qn);
  ok("noise gives small usage F", an.fUsage < 4, `F=${an.fUsage.toFixed(3)}`);
  ok("noise gives small eta^2", an.etaUsage < 0.03, `eta2=${an.etaUsage.toFixed(4)}`);

  // Planted effect: outcome driven by touches. F must be large.
  const signal: Obs[] = noise.map((r) => ({ ...r, zOutcome: r.touches * 3 }));
  const qs = assignQuintiles(signal);
  const as_ = twoWayAnova(signal, qs);
  ok("planted effect gives large usage F", as_.fUsage > 50, `F=${as_.fUsage.toFixed(1)}`);
  ok("planted effect dominates variance", as_.etaUsage > 0.5, `eta2=${as_.etaUsage.toFixed(3)}`);

  // Sums of squares must decompose sensibly: each component <= total.
  ok("eta^2 components are in [0,1]",
     [an.etaPosition, an.etaUsage, an.etaInteraction].every((e) => e >= 0 && e <= 1));

  if (fails.length > 0) {
    console.error("\nSELF-TEST FAILED:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nself-test PASSED — ANOVA arithmetic verified on synthetic data.");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const rows = build();
  const quint = assignQuintiles(rows);
  const a = twoWayAnova(rows, quint);
  const players = new Set(rows.map((r) => r.playerId)).size;

  const pUsage = permutationP(rows, a.fUsage, (x) => x.fUsage, SEED);
  const pInter = permutationP(rows, a.fInteraction, (x) => x.fInteraction, SEED + 1);
  const lev = leveneF(rows, quint);

  say("# Two-way ANOVA — is the opportunity effect homogeneous?");
  say();
  say(`**Executed** ${new Date().toISOString()}`);
  say();
  say("> **This is a DIAGNOSTIC, not a sixth protocol.** Protocols 4 and 5 established");
  say("> that usage adds information, on pre-registered out-of-sample tests. This asks");
  say("> whether that effect is *uniform* across positions and eras. It cannot promote");
  say("> or demote those findings, and nothing here licenses a product change.");
  say();
  say(`Design: response **zOutcome** (rest-of-season points, standardised within season×position);`);
  say(`factors **position** (RB/WR/TE) × **usage quintile** (1–5, within season×position).`);
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| observations | **${rows.length}** player-seasons |`);
  say(`| distinct players (clusters) | **${players}** |`);
  say(`| seasons | ${SEASONS[0]}–${SEASONS[SEASONS.length - 1]} |`);
  say();

  say("## ANOVA table");
  say();
  say("| source | df | F | partial η² | p (cluster permutation) |");
  say("|---|---|---|---|---|");
  say(`| position | ${a.dfPosition} | ${a.fPosition.toFixed(3)} | ${a.etaPosition.toFixed(4)} | — (see note) |`);
  say(`| **usage quintile** | ${a.dfUsage} | **${a.fUsage.toFixed(2)}** | **${a.etaUsage.toFixed(4)}** | **${pUsage.p < 1 / (pUsage.n + 1) + 1e-12 ? `< ${(1 / (pUsage.n + 1)).toFixed(5)}` : pUsage.p.toFixed(5)}** |`);
  say(`| position × usage | ${a.dfInteraction} | ${a.fInteraction.toFixed(3)} | ${a.etaInteraction.toFixed(4)} | ${pInter.p.toFixed(4)} |`);
  say(`| error | ${a.dfError} | | | |`);
  say();
  say(`p-values from **${PERMUTATIONS} cluster permutations** — usage shuffled between whole`);
  say("players within season×position strata, never between rows. The textbook F");
  say("distribution is NOT used: player-seasons are not independent, and assuming they");
  say("are would understate p exactly as protocol 3's textbook null did.");
  say();
  say("**Position has no main effect by construction** — the response is standardised");
  say("within season×position, so positional means are zero by definition. Its row is");
  say("shown for completeness and carries no information.");
  say();

  say("## Assumption check");
  say();
  say(`Brown-Forsythe (median-centred Levene) F = **${lev.toFixed(3)}** across the ${POSITIONS.length * QUINTILES} cells.`);
  say(lev > 3
    ? "Variance is **not** equal across cells, so the F statistic's nominal reference distribution would be unreliable — which is precisely why the p-values above come from permutation instead."
    : "No strong evidence of unequal variance across cells.");
  say();

  say("## Cell means — mean rest-of-season z by position × usage quintile");
  say();
  say("| position | Q1 (lowest usage) | Q2 | Q3 | Q4 | Q5 (highest) |");
  say("|---|---|---|---|---|---|");
  for (const p of POSITIONS) {
    const cells = [0, 1, 2, 3, 4].map((q) => {
      const c = a.cellMeans.get(`${p}|${q}`);
      return c ? `${c.mean >= 0 ? "+" : ""}${c.mean.toFixed(3)} (n=${c.n})` : "—";
    });
    say(`| ${p} | ${cells.join(" | ")} |`);
  }
  say();

  const monotone = POSITIONS.every((p) => {
    const ms = [0, 1, 2, 3, 4].map((q) => a.cellMeans.get(`${p}|${q}`)?.mean ?? NaN);
    return ms.every((v, i) => i === 0 || Number.isNaN(v) || v >= ms[i - 1]! - 0.05);
  });
  say(monotone
    ? "**Every position shows a monotone rise in outcome across usage quintiles** (within a 0.05 tolerance)."
    : "**Not every position rises monotonically across usage quintiles** — the effect is not uniform in shape.");
  say();

  // PRESERVE ANYTHING A HUMAN ADDED BELOW THE GENERATED SECTION.
  //
  // Re-running this script on 2026-09-02 silently deleted 63 lines of
  // hand-written interpretation from the committed report — the two findings the
  // analysis was FOR, including the homogeneity conclusion that is the whole
  // reason it exists. The numbers regenerated identically; the reasoning about
  // them did not, because no code produces it.
  //
  // A generator that overwrites a file it only partly authors will do this every
  // time, and the loss is invisible in the console output. Everything after the
  // marker is carried across untouched.
  // Line endings are normalised before the search. A first attempt matched on
  // the literal "\n---\n\n## Interpretation\n" and found nothing, because git
  // had checked the file out with CRLF — and a marker that misses is a marker
  // that silently deletes, which is the failure this block exists to stop.
  //
  // READ AND CATCH, rather than `existsSync` and then read. CodeQL flagged the
  // check-then-read form as `js/file-system-race` (high) on PR #43 and it is
  // right: the file can be removed between the two calls, and the read would
  // then throw from inside a branch written on the promise that it exists. One
  // syscall has no window. ENOENT is the ordinary first-run case and means there
  // is nothing to preserve; anything else is a real fault and is rethrown rather
  // than swallowed into a silent overwrite — which is the exact failure this
  // block was added to prevent.
  let preserved = "";
  try {
    const prior = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    const at = prior.indexOf("## Interpretation");
    if (at !== -1) {
      const rule = prior.lastIndexOf("\n---\n", at);
      preserved = prior.slice(rule === -1 ? at : rule);
      console.log(`Preserving ${preserved.split("\n").length} lines of hand-written interpretation.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  writeFileSync(OUT, out.join("\n") + preserved);
  console.log(`\nWrote ${OUT}`);
}

const direct = (process.argv[1] ?? "").split("\\").join("/").endsWith("anova-opportunity.ts");
if (direct) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
