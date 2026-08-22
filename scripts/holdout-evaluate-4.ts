/**
 * Execute FROZEN PROTOCOL 4 exactly once.
 *
 * Protocol: reports/2026-08-20/holdout-protocol-4.md, committed 0cd6c2d BEFORE
 * any metric was computed.
 *
 *   Does USAGE through week 8 predict weeks 9-17 BEYOND what POINTS scored
 *   through week 8 already predict?
 *
 *   npm run holdout:evaluate4                  # the single permitted run
 *   npm run holdout:evaluate4 -- --self-test   # arithmetic, no verdict
 *   npm run holdout:evaluate4 -- --dry-run     # sample shape, no metrics
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIR = "reports/2026-08-20/nflverse";
const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "reports/2026-08-20/holdout-result-4.md";

/** Frozen in protocol 4 §3-4. */
const SEASONS = ["2021", "2022", "2023", "2024"];
const POSITIONS = new Set(["RB", "WR", "TE"]);
const SPLIT_WEEK = 8;
const LAST_WEEK = 17;
const MIN_GAMES = 4;

const BOOT = 5000;
const SEED = 20260823;
const ALPHA = 0.05;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── csv ────────────────────────────────────────────────────────────────────

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
  const path = join(DIR, `${name}.csv`);
  try {
    return parseCsv(readFileSync(path, "utf8"));
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

// ── build ──────────────────────────────────────────────────────────────────

interface PlayerSeason {
  playerId: string;
  name: string;
  season: string;
  position: string;
  gamesEarly: number;
  gamesLate: number;
  /** per game, weeks 1-8 */
  pointsEarly: number;
  touchesEarly: number;
  targetShareEarly: number;
  woprEarly: number;
  /** per game, weeks 9-17 — the OUTCOME */
  pointsLate: number;
  /** z-scores within (season, position), assigned after grouping */
  zPoints: number;
  zTouches: number;
  zTargetShare: number;
  zWopr: number;
  zOutcome: number;
  snapPct: number | null;
  zSnap: number;
}

function build(): { rows: PlayerSeason[]; rejected: Map<string, number>; snapMatch: { matched: number; total: number } } {
  const rejected = new Map<string, number>();
  const bump = (r: string) => rejected.set(r, (rejected.get(r) ?? 0) + 1);
  const acc = new Map<string, PlayerSeason>();

  for (const season of SEASONS) {
    const csv = readCsv(`player_stats_${season}`);
    if (!csv || csv.length < 2) { bump(`no player_stats ${season}`); continue; }
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
      let ps = acc.get(key);
      if (!ps) {
        ps = {
          playerId: r[ix.player_id!]!, name: r[ix.player_display_name!] ?? "", season, position,
          gamesEarly: 0, gamesLate: 0, pointsEarly: 0, touchesEarly: 0, targetShareEarly: 0,
          woprEarly: 0, pointsLate: 0, zPoints: 0, zTouches: 0, zTargetShare: 0, zWopr: 0,
          zOutcome: 0, snapPct: null, zSnap: 0
        };
        acc.set(key, ps);
      }
      const fp = num(r[ix.fantasy_points_ppr!]);
      if (week <= SPLIT_WEEK) {
        ps.gamesEarly += 1;
        ps.pointsEarly += fp;
        ps.touchesEarly += num(r[ix.carries!]) + num(r[ix.targets!]);
        ps.targetShareEarly += num(r[ix.target_share!]);
        ps.woprEarly += num(r[ix.wopr!]);
      } else {
        ps.gamesLate += 1;
        ps.pointsLate += fp;
      }
    }
  }

  // Per-game, then the minimum-games gate (protocol §4.3-4.4).
  const kept: PlayerSeason[] = [];
  for (const ps of acc.values()) {
    if (ps.gamesEarly < MIN_GAMES) { bump("fewer than 4 games in weeks 1-8"); continue; }
    if (ps.gamesLate < MIN_GAMES) { bump("fewer than 4 games in weeks 9-17"); continue; }
    ps.pointsEarly /= ps.gamesEarly;
    ps.touchesEarly /= ps.gamesEarly;
    ps.targetShareEarly /= ps.gamesEarly;
    ps.woprEarly /= ps.gamesEarly;
    ps.pointsLate /= ps.gamesLate;
    kept.push(ps);
  }

  // Snap share — SECONDARY, name-joined, match rate reported (protocol §3).
  const snapByKey = new Map<string, { sum: number; n: number }>();
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  for (const season of SEASONS) {
    const csv = readCsv(`snap_counts_${season}`);
    if (!csv || csv.length < 2) continue;
    const head = csv[0]!;
    const ix = Object.fromEntries(head.map((h, i) => [h, i])) as Record<string, number>;
    for (const r of csv.slice(1)) {
      if (r.length !== head.length) continue;
      if (r[ix.game_type!] !== "REG") continue;
      const week = num(r[ix.week!]);
      if (week < 1 || week > SPLIT_WEEK) continue;
      const key = `${season}:${normalise(r[ix.player!] ?? "")}`;
      const cur = snapByKey.get(key) ?? { sum: 0, n: 0 };
      cur.sum += num(r[ix.offense_pct!]);
      cur.n += 1;
      snapByKey.set(key, cur);
    }
  }
  let matched = 0;
  for (const ps of kept) {
    const hit = snapByKey.get(`${ps.season}:${normalise(ps.name)}`);
    if (hit && hit.n > 0) { ps.snapPct = hit.sum / hit.n; matched += 1; }
  }

  // Standardise WITHIN (season, position) — protocol §4.8. This is the exact
  // omission that produced protocol 3's retracted QB artifact.
  const groups = new Map<string, PlayerSeason[]>();
  for (const ps of kept) {
    const k = `${ps.season}:${ps.position}`;
    const g = groups.get(k);
    if (g) g.push(ps);
    else groups.set(k, [ps]);
  }
  const z = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    return (v: number) => (s > 0 ? (v - m) / s : 0);
  };
  for (const g of groups.values()) {
    if (g.length < 5) continue;
    const zp = z(g.map((x) => x.pointsEarly));
    const zt = z(g.map((x) => x.touchesEarly));
    const zs = z(g.map((x) => x.targetShareEarly));
    const zw = z(g.map((x) => x.woprEarly));
    const zo = z(g.map((x) => x.pointsLate));
    const withSnap = g.filter((x) => x.snapPct != null);
    const zn = withSnap.length >= 5 ? z(withSnap.map((x) => x.snapPct!)) : null;
    for (const x of g) {
      x.zPoints = zp(x.pointsEarly);
      x.zTouches = zt(x.touchesEarly);
      x.zTargetShare = zs(x.targetShareEarly);
      x.zWopr = zw(x.woprEarly);
      x.zOutcome = zo(x.pointsLate);
      x.zSnap = zn && x.snapPct != null ? zn(x.snapPct) : 0;
    }
  }

  const usable = kept.filter((x) => groups.get(`${x.season}:${x.position}`)!.length >= 5);
  return { rows: usable, rejected, snapMatch: { matched, total: kept.length } };
}

// ── statistics ─────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

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
  const mx = mean(xs);
  const my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    n += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
}

const spearman = (xs: number[], ys: number[]) => pearson(rankAverage(xs), rankAverage(ys));

/**
 * PARTIAL Spearman of x with y, controlling for c.
 *
 * This is the statistic that answers the protocol's question. A plain
 * correlation of usage with the outcome would be dominated by "good players get
 * more usage AND score more", which says nothing about incremental value.
 */
function partialSpearman(x: number[], y: number[], c: number[]): number {
  const rxy = spearman(x, y);
  const rxc = spearman(x, c);
  const ryc = spearman(y, c);
  const den = Math.sqrt((1 - rxc * rxc) * (1 - ryc * ryc));
  return den > 1e-12 ? (rxy - rxc * ryc) / den : 0;
}

/** H3: among players in the same points-to-date decile, does more usage win? */
function decileConcordance(rows: PlayerSeason[], usage: (r: PlayerSeason) => number): number {
  const byBucket = new Map<string, PlayerSeason[]>();
  const sorted = [...rows].sort((a, b) => a.zPoints - b.zPoints);
  const per = Math.max(1, Math.floor(sorted.length / 10));
  sorted.forEach((r, i) => {
    const b = `${Math.min(9, Math.floor(i / per))}`;
    const g = byBucket.get(b);
    if (g) g.push(r);
    else byBucket.set(b, [r]);
  });
  let wins = 0, total = 0;
  for (const g of byBucket.values()) {
    for (let i = 0; i < g.length; i += 1) {
      for (let j = i + 1; j < g.length; j += 1) {
        const a = g[i]!, b = g[j]!;
        if (usage(a) === usage(b)) continue;
        const hi = usage(a) > usage(b) ? a : b;
        const lo = usage(a) > usage(b) ? b : a;
        total += 1;
        if (hi.zOutcome > lo.zOutcome) wins += 1;
        else if (hi.zOutcome === lo.zOutcome) wins += 0.5;
      }
    }
  }
  return total === 0 ? 0.5 : wins / total;
}

/** Within-position partial correlation, pooled by Fisher z weighted by n (H2). */
function withinPositionPartial(rows: PlayerSeason[]): number {
  const byPos = new Map<string, PlayerSeason[]>();
  for (const r of rows) {
    const g = byPos.get(r.position);
    if (g) g.push(r);
    else byPos.set(r.position, [r]);
  }
  let zSum = 0, wSum = 0;
  for (const g of byPos.values()) {
    if (g.length < 10) continue;
    const r = partialSpearman(g.map((x) => x.zTouches), g.map((x) => x.zOutcome), g.map((x) => x.zPoints));
    const rc = Math.max(-0.999999, Math.min(0.999999, r));
    const w = g.length - 3;
    if (w <= 0) continue;
    zSum += 0.5 * Math.log((1 + rc) / (1 - rc)) * w;
    wSum += w;
  }
  if (wSum === 0) return 0;
  const zb = zSum / wSum;
  return (Math.exp(2 * zb) - 1) / (Math.exp(2 * zb) + 1);
}

/** Cluster bootstrap over PLAYERS (protocol §5). */
function clusterBootstrap(
  rows: PlayerSeason[],
  stat: (r: PlayerSeason[]) => number,
  nullValue: number,
  seed: number
) {
  const byPlayer = new Map<string, PlayerSeason[]>();
  for (const r of rows) {
    const g = byPlayer.get(r.playerId);
    if (g) g.push(r);
    else byPlayer.set(r.playerId, [r]);
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
    const draw: PlayerSeason[] = [];
    for (let k = 0; k < keys.length; k += 1) draw.push(...byPlayer.get(keys[Math.floor(rand() * keys.length)]!)!);
    const v = stat(draw);
    if (Number.isFinite(v)) samples.push(v);
  }
  samples.sort((a, b) => a - b);
  const atOrBelow = samples.filter((v) => v <= nullValue).length;
  return {
    lo: samples[Math.floor(0.025 * samples.length)] ?? Number.NaN,
    hi: samples[Math.floor(0.975 * samples.length)] ?? Number.NaN,
    p: (atOrBelow + 1) / (samples.length + 1),
    clusters: keys.length,
    distinct: new Set(samples.map((v) => v.toFixed(6))).size
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

/** Leave-one-season-out Spearman of a linear combination against the outcome. */
function looSeason(rows: PlayerSeason[], features: Array<(r: PlayerSeason) => number>): number {
  const seasons = [...new Set(rows.map((r) => r.season))];
  const preds: number[] = [];
  const actual: number[] = [];
  for (const held of seasons) {
    const train = rows.filter((r) => r.season !== held);
    const test = rows.filter((r) => r.season === held);
    if (train.length < 50 || test.length === 0) continue;
    // OLS via normal equations on standardised features (all already z-scored).
    const d = features.length;
    const X = train.map((r) => features.map((f) => f(r)));
    const y = train.map((r) => r.zOutcome);
    const XtX = Array.from({ length: d }, () => new Array(d).fill(0));
    const Xty = new Array(d).fill(0);
    for (let i = 0; i < X.length; i += 1) {
      for (let a = 0; a < d; a += 1) {
        Xty[a] += X[i]![a]! * y[i]!;
        for (let b = 0; b < d; b += 1) XtX[a]![b]! += X[i]![a]! * X[i]![b]!;
      }
    }
    for (let a = 0; a < d; a += 1) XtX[a]![a]! += 1e-6; // ridge, keeps it invertible
    // Gaussian elimination.
    const M = XtX.map((row, i) => [...row, Xty[i]!]);
    for (let col = 0; col < d; col += 1) {
      let piv = col;
      for (let r = col + 1; r < d; r += 1) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
      [M[col], M[piv]] = [M[piv]!, M[col]!];
      const p = M[col]![col]!;
      if (Math.abs(p) < 1e-12) continue;
      for (let c = col; c <= d; c += 1) M[col]![c]! /= p;
      for (let r = 0; r < d; r += 1) {
        if (r === col) continue;
        const f = M[r]![col]!;
        for (let c = col; c <= d; c += 1) M[r]![c]! -= f * M[col]![c]!;
      }
    }
    const w = M.map((row) => row[d]!);
    for (const r of test) {
      preds.push(features.reduce((a, f, i) => a + f(r) * w[i]!, 0));
      actual.push(r.zOutcome);
    }
  }
  return preds.length > 3 ? spearman(preds, actual) : Number.NaN;
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): void {
  const fails: string[] = [];
  const ck = (n: string, got: number, want: number, tol = 1e-6) => {
    if (!Number.isFinite(got) || Math.abs(got - want) > tol) fails.push(`${n}: ${got} != ${want}`);
    else console.log(`  ok  ${n} = ${got.toFixed(6)}`);
  };

  ck("spearman perfect", spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  ck("spearman inverted", spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);

  // Partial correlation must REMOVE a confound. y is driven purely by c; x is a
  // noisy copy of c. The raw correlation of x with y is high; the partial must
  // collapse toward zero.
  const c = [1, 2, 3, 4, 5, 6, 7, 8];
  const x = c.map((v) => v + (v % 2 === 0 ? 0.1 : -0.1));
  const y = [...c];
  const raw = spearman(x, y);
  const partial = partialSpearman(x, y, c);
  if (!(Math.abs(partial) < Math.abs(raw))) fails.push(`partial must shrink a confounded correlation: raw ${raw}, partial ${partial}`);
  else console.log(`  ok  partial removes the confound (raw ${raw.toFixed(3)} -> ${partial.toFixed(3)})`);

  // And it must PRESERVE a genuine independent effect. x2 must NOT be collinear
  // with the control, or the partial is undefined rather than zero.
  const c2 = [1, 2, 3, 4, 5, 6, 7, 8];
  const x2 = [1, 5, 2, 6, 3, 7, 4, 8];
  const y2 = [2, 5, 1, 6, 4, 7, 3, 8];
  const p2 = partialSpearman(x2, y2, c2);
  if (!(p2 > 0.5)) fails.push(`partial must keep a real effect: ${p2}`);
  else console.log(`  ok  partial keeps a real effect (${p2.toFixed(3)})`);

  // Perfect collinearity between predictor and control makes the partial
  // UNDEFINED. Returning 0 there is deliberate and is pinned here so a future
  // change cannot start reporting a spurious value from a degenerate case.
  const pDegenerate = partialSpearman([8, 7, 6, 5, 4, 3, 2, 1], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]);
  if (pDegenerate !== 0) fails.push(`collinear predictor/control must yield 0, got ${pDegenerate}`);
  else console.log("  ok  collinear predictor/control yields 0, not a spurious value");

  // Cluster bootstrap must resample PLAYERS, not rows: a statistic on data where
  // every row shares one player can have no spread.
  const one = Array.from({ length: 40 }, (_, i) => ({ playerId: "P1", zTouches: i, zOutcome: i, zPoints: 0 }) as any);
  const bootOne = clusterBootstrap(one, (r) => spearman(r.map((x) => x.zTouches), r.map((x) => x.zOutcome)), 0, 1);
  if (bootOne.clusters !== 1 || bootOne.distinct !== 1) fails.push(`single-cluster bootstrap must be degenerate: clusters ${bootOne.clusters}, distinct ${bootOne.distinct}`);
  else console.log("  ok  bootstrap resamples clusters (1 player -> no spread)");

  const h = holm([{ id: "A", p: 0.01 }, { id: "B", p: 0.04 }, { id: "C", p: 0.9 }]);
  const rej = h.filter((z) => z.reject).map((z) => z.id).join(",");
  if (rej !== "A") fails.push(`Holm expected A, got [${rej}]`);
  else console.log("  ok  Holm rejects only A");

  if (fails.length > 0) {
    console.error("\nSELF-TEST FAILED:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nself-test PASSED — arithmetic verified, holdout untouched.");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const { rows, rejected, snapMatch } = build();
  const clusters = new Set(rows.map((r) => r.playerId)).size;

  if (process.argv.includes("--dry-run")) {
    console.log(`dry run — ${rows.length} player-seasons, ${clusters} distinct players. NO metric computed.`);
    for (const [r, n] of [...rejected].sort((a, b) => b[1] - a[1])) console.log(`  rejected ${String(n).padStart(4)} — ${r}`);
    console.log(`  snap-share name join: ${snapMatch.matched}/${snapMatch.total}`);
    return;
  }
  if (rows.length < 50) { console.error("too few observations"); process.exit(2); }

  say("# Holdout result 4 — does opportunity add over production to date?");
  say();
  say(`**Executed** ${new Date().toISOString()} · **Protocol** [holdout-protocol-4.md](./holdout-protocol-4.md) (frozen \`0cd6c2d\`)`);
  say();
  say("> Baseline is **production to date**, not a stale ADP. A week-9 waiver decision has eight weeks of results available. Features standardised within (season, position); all inference clustered on **player**.");
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| player-seasons | **${rows.length}** |`);
  say(`| distinct players (effective N) | **${clusters}** |`);
  say(`| seasons | ${[...new Set(rows.map((r) => r.season))].sort().join(", ")} |`);
  say(`| positions | ${[...new Set(rows.map((r) => r.position))].sort().join(", ")} |`);
  say(`| snap-share name join | ${snapMatch.matched}/${snapMatch.total} (${((snapMatch.matched / snapMatch.total) * 100).toFixed(1)}%) |`);
  say();

  const h1s = (r: PlayerSeason[]) => partialSpearman(r.map((x) => x.zTouches), r.map((x) => x.zOutcome), r.map((x) => x.zPoints));
  const h3s = (r: PlayerSeason[]) => decileConcordance(r, (x) => x.zTouches);

  const h1 = h1s(rows), h2 = withinPositionPartial(rows), h3 = h3s(rows);
  const b1 = clusterBootstrap(rows, h1s, 0, SEED);
  const b2 = clusterBootstrap(rows, withinPositionPartial, 0, SEED + 1);
  const b3 = clusterBootstrap(rows, h3s, 0.5, SEED + 2);

  const fam = holm([{ id: "H1", p: b1.p }, { id: "H2", p: b2.p }, { id: "H3", p: b3.p }]);
  const v = new Map(fam.map((f) => [f.id, f]));

  say("## Confirmatory tests (Holm-Bonferroni, all three required)");
  say();
  say("| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |");
  say("|---|---|---|---|---|---|---|");
  say(`| H1 | usage adds over production | ${h1.toFixed(4)} | [${b1.lo.toFixed(4)}, ${b1.hi.toFixed(4)}] | ${b1.p.toFixed(4)} | ${v.get("H1")!.threshold.toFixed(4)} | ${v.get("H1")!.reject ? "**YES**" : "no"} |`);
  say(`| H2 | same, WITHIN position | ${h2.toFixed(4)} | [${b2.lo.toFixed(4)}, ${b2.hi.toFixed(4)}] | ${b2.p.toFixed(4)} | ${v.get("H2")!.threshold.toFixed(4)} | ${v.get("H2")!.reject ? "**YES**" : "no"} |`);
  say(`| H3 | decile concordance (>0.5) | ${h3.toFixed(4)} | [${b3.lo.toFixed(4)}, ${b3.hi.toFixed(4)}] | ${b3.p.toFixed(4)} | ${v.get("H3")!.threshold.toFixed(4)} | ${v.get("H3")!.reject ? "**YES**" : "no"} |`);
  say();
  say(`Cluster bootstrap over **${b1.clusters} players**, ${BOOT} resamples.`);
  say();

  const all = fam.every((f) => f.reject);
  say(`### Verdict: ${all ? "**OPPORTUNITY ADDS PREDICTIVE VALUE**" : "**NOT DEMONSTRATED**"}`);
  say();
  say(all
    ? "All three pre-registered hypotheses survive Holm correction. Usage carries information beyond production to date, it is not a position artifact, and it changes a decision at matched production."
    : "Protocol 4 §6 requires **all three**. No threshold, weight or window is adjusted, and no re-run is permitted on this sample.");
  say();

  say("## Diagnostics (reported, NOT adjudicating)");
  say();
  say("### D1 — leave-one-season-out predictive Spearman");
  say();
  say("| model | out-of-fold Spearman vs weeks 9-17 |");
  say("|---|---|");
  say(`| points-to-date alone | ${looSeason(rows, [(r) => r.zPoints]).toFixed(4)} |`);
  say(`| touches alone | ${looSeason(rows, [(r) => r.zTouches]).toFixed(4)} |`);
  say(`| **points + touches** | **${looSeason(rows, [(r) => r.zPoints, (r) => r.zTouches]).toFixed(4)}** |`);
  say();
  say("### D2 — share-based usage instead of counts");
  say();
  say("| predictor | partial Spearman (controlling for points-to-date) |");
  say("|---|---|");
  say(`| touches | ${h1.toFixed(4)} |`);
  say(`| target share | ${partialSpearman(rows.map((r) => r.zTargetShare), rows.map((r) => r.zOutcome), rows.map((r) => r.zPoints)).toFixed(4)} |`);
  say(`| wopr | ${partialSpearman(rows.map((r) => r.zWopr), rows.map((r) => r.zOutcome), rows.map((r) => r.zPoints)).toFixed(4)} |`);
  say();
  const withSnap = rows.filter((r) => r.snapPct != null);
  say("### D3 — snap share (RAE's actual `opportunity` field), name-joined");
  say();
  say(`Matched ${snapMatch.matched} of ${snapMatch.total} (${((snapMatch.matched / snapMatch.total) * 100).toFixed(1)}%). Secondary precisely because the join can fail.`);
  say();
  say(`Partial Spearman on the matched subset (n=${withSnap.length}): **${partialSpearman(withSnap.map((r) => r.zSnap), withSnap.map((r) => r.zOutcome), withSnap.map((r) => r.zPoints)).toFixed(4)}**`);
  say();
  const mdc = (1.6449 + 0.8416) / Math.sqrt(Math.max(1, clusters - 3));
  say("### D4 — minimum detectable correlation");
  say();
  say(`With ${clusters} effective clusters, about **${mdc.toFixed(4)}** at 80% power (one-sided). Note this closed form assumes independent units and is a conservative approximation; the cluster bootstrap above is the primary inference.`);
  say();
  const sorted = [...rows].sort((a, b) => a.zTouches - b.zTouches);
  const q = Math.floor(sorted.length / 5);
  say("### D5 — effect size in plain units");
  say();
  say(`Top touches quintile mean outcome z: **${mean(sorted.slice(-q).map((r) => r.zOutcome)).toFixed(4)}**`);
  say(`Bottom touches quintile mean outcome z: **${mean(sorted.slice(0, q).map((r) => r.zOutcome)).toFixed(4)}**`);
  say();

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

const direct = (process.argv[1] ?? "").split("\\").join("/").endsWith("holdout-evaluate-4.ts");
if (direct) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
