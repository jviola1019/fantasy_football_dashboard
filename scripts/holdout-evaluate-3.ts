/**
 * Execute FROZEN PROTOCOL 3 exactly once — does the REPUTATION EDGE predict?
 *
 * Protocol: reports/2026-08-20/holdout-protocol-3.md, committed 963bdd5 BEFORE
 * any edge metric was computed.
 *
 * Tests the quantity the product is named for, which nothing had ever tested:
 *
 *   edge = trueValue(positional rank vs replacement) − perceivedValue(overall rank)
 *
 * against whether a player beat what their draft cost implied.
 *
 *   npm run holdout:evaluate3                    # the single permitted run
 *   npm run holdout:evaluate3 -- --self-test     # arithmetic, no verdict
 *   npm run holdout:evaluate3 -- --dry-run       # sample shape, no metrics
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ecrToTrueValue, ecrToPerceivedValue } from "../src/lib/fantasypros/enrich";
import { positionReplacementRank } from "../src/lib/league/lineupDemand";
import { DEFAULT_FORMAT, type LeagueFormat } from "../src/lib/trade/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DATA_DIR = "reports/2026-08-20/holdout-data";
const BUNDLE = "reports/2026-08-20/holdout-data-p2.jsonl.gz";
const OUT = "reports/2026-08-20/holdout-result-3.md";

const BOOT = 5000;
const SEED = 20260822;
const ALPHA = 0.05;
/** Protocol 3 §7 H3: "drafted within 12 overall picks of each other". */
const COST_BAND = 12;

type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
const IDP = new Set(["DT", "DE", "LB", "CB", "S", "IDP"]);

function mapPosition(raw: string | undefined): Pos | null {
  if (!raw) return null;
  const p = raw.toUpperCase().trim();
  if (p === "PK" || p === "TMPK" || p === "K") return "K";
  if (p === "DEF" || p === "DST" || p === "TMDF" || p === "D/ST") return "DEF";
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE") return p;
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function minLimit(limit: string | undefined): number {
  if (!limit) return 0;
  const n = Number(limit.split("-")[0]);
  return Number.isFinite(n) ? n : 0;
}

function parseStarters(L: any): LeagueFormat["starters"] | null {
  const s = L?.starters;
  if (!s) return null;
  const total = Number(s.count);
  if (!Number.isFinite(total) || total < 1) return null;
  const starters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  let fixed = 0;
  for (const e of asArray<any>(s.position)) {
    const pos = mapPosition(e?.name);
    if (!pos) continue;
    const n = minLimit(e?.limit);
    starters[pos] += n;
    fixed += n;
  }
  if (fixed === 0) return null;
  starters.FLEX = Math.max(0, total - fixed);
  return starters;
}

const playerPos = new Map<string, Record<string, string>>();
let bundledPlayers: Record<string, Record<string, string>> | null = null;

function positionsFor(season: string): Record<string, string> {
  const hit = playerPos.get(season);
  if (hit) return hit;
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(readFileSync(join(DATA_DIR, `_players-${season}.json`), "utf8"));
  } catch {
    if (bundledPlayers == null) {
      try {
        bundledPlayers = JSON.parse(
          gunzipSync(readFileSync("reports/2026-08-20/holdout-players.json.gz")).toString("utf8")
        );
      } catch {
        bundledPlayers = {};
      }
    }
    map = bundledPlayers![season] ?? {};
  }
  playerPos.set(season, map);
  return map;
}

/**
 * One drafted player-season inside one league.
 *
 * `clusterKey` is `season:playerId` and is what ALL inference resamples. One NFL
 * player-season appears in up to 140 leagues with identical realized points;
 * clustering on league instead would manufacture significance from repetition
 * (protocol 3 §6).
 */
interface Obs {
  leagueKey: string;
  clusterKey: string;
  position: Pos;
  overallRank: number;
  posRank: number;
  trueValue: number;
  perceivedValue: number;
  edge: number;
  points: number;
  /** Within-league z-score of points — league scoring rules differ (§4.5). */
  pointsZ: number;
  residual: number;
}

function loadRaws(): any[] {
  try {
    const files = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .sort();
    if (files.length > 0) return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")));
  } catch {
    /* fall through to the bundle */
  }
  return gunzipSync(readFileSync(BUNDLE))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** Ranks with ties averaged — required for a correct Spearman. */
function rankAverage(xs: number[]): number[] {
  const idx = xs.map((x, i) => i).sort((a, b) => xs[a]! - xs[b]!);
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

function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const rx = rankAverage(xs);
  const ry = rankAverage(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/** Non-increasing isotonic fit — expected performance falls with worse draft slot. */
function isotonicDecreasing(values: number[], weights: number[]): number[] {
  const v: number[] = [];
  const w: number[] = [];
  const size: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    v.push(values[i]!);
    w.push(weights[i]!);
    size.push(1);
    while (v.length > 1 && v[v.length - 2]! < v[v.length - 1]!) {
      const v2 = v.pop()!, w2 = w.pop()!, s2 = size.pop()!;
      const v1 = v.pop()!, w1 = w.pop()!, s1 = size.pop()!;
      const ws = w1 + w2;
      v.push(ws > 0 ? (v1 * w1 + v2 * w2) / ws : (v1 + v2) / 2);
      w.push(ws);
      size.push(s1 + s2);
    }
  }
  const out: number[] = [];
  for (let b = 0; b < v.length; b += 1) for (let k = 0; k < size[b]!; k += 1) out.push(v[b]!);
  return out;
}

/** H3 concordance: at matched draft cost, does the higher edge score more? */
function concordanceAtMatchedCost(obs: Obs[], band = COST_BAND, samePositionOnly = false): number {
  let wins = 0;
  let total = 0;
  const byLeague = new Map<string, Obs[]>();
  for (const o of obs) {
    const b = byLeague.get(o.leagueKey);
    if (b) b.push(o);
    else byLeague.set(o.leagueKey, [o]);
  }
  for (const group of byLeague.values()) {
    const sorted = [...group].sort((a, b) => a.overallRank - b.overallRank);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (b.overallRank - a.overallRank > band) break;
        if (samePositionOnly && a.position !== b.position) continue;
        if (a.edge === b.edge) continue;
        const higher = a.edge > b.edge ? a : b;
        const lower = a.edge > b.edge ? b : a;
        total += 1;
        if (higher.pointsZ > lower.pointsZ) wins += 1;
        else if (higher.pointsZ === lower.pointsZ) wins += 0.5;
      }
    }
  }
  return total === 0 ? 0.5 : wins / total;
}

/**
 * Cluster bootstrap over PLAYER-SEASONS (§6), returning a one-sided p for
 * `statistic > nullValue` plus the interval.
 */
function clusterBootstrap(
  obs: Obs[],
  stat: (o: Obs[]) => number,
  nullValue: number,
  seed: number
): { lo: number; hi: number; p: number; clusters: number; distinct: number } {
  const byCluster = new Map<string, Obs[]>();
  for (const o of obs) {
    const b = byCluster.get(o.clusterKey);
    if (b) b.push(o);
    else byCluster.set(o.clusterKey, [o]);
  }
  const keys = [...byCluster.keys()];
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
    const draw: Obs[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      draw.push(...byCluster.get(keys[Math.floor(rand() * keys.length)]!)!);
    }
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

/** Within-position Spearman, pooled by Fisher z weighted by n (H2). */
function withinPositionSpearman(obs: Obs[]): number {
  const byPos = new Map<Pos, Obs[]>();
  for (const o of obs) {
    const b = byPos.get(o.position);
    if (b) b.push(o);
    else byPos.set(o.position, [o]);
  }
  let zSum = 0;
  let wSum = 0;
  for (const group of byPos.values()) {
    if (group.length < 10) continue;
    const r = spearman(group.map((o) => o.edge), group.map((o) => o.residual));
    const rc = Math.max(-0.999999, Math.min(0.999999, r));
    const z = 0.5 * Math.log((1 + rc) / (1 - rc));
    const w = group.length - 3;
    if (w <= 0) continue;
    zSum += z * w;
    wSum += w;
  }
  if (wSum === 0) return 0;
  const zBar = zSum / wSum;
  return (Math.exp(2 * zBar) - 1) / (Math.exp(2 * zBar) + 1);
}

// ── build ──────────────────────────────────────────────────────────────────

function build(): { obs: Obs[]; leagues: number; rejected: Map<string, number> } {
  const rejected = new Map<string, number>();
  const bump = (r: string) => rejected.set(r, (rejected.get(r) ?? 0) + 1);

  // Pass 1 — per league, collect drafted players with realized points.
  interface Pending {
    leagueKey: string;
    season: string;
    position: Pos;
    playerId: string;
    overallRank: number;
    posRank: number;
    points: number;
    format: LeagueFormat;
  }
  const perLeague = new Map<string, Pending[]>();
  let leagues = 0;

  for (const raw of loadRaws()) {
    const L = raw?.league?.league;
    if (!L) {
      bump("no league payload");
      continue;
    }
    const numTeams = asArray<any>(L?.franchises?.franchise).length;
    if (numTeams < 8 || numTeams > 16) {
      bump("franchise count");
      continue;
    }
    const starters = parseStarters(L);
    if (!starters) {
      bump("unparseable starters");
      continue;
    }
    const format: LeagueFormat = { ...DEFAULT_FORMAT, numTeams, starters };

    let du = raw?.draftResults?.draftResults?.draftUnit;
    if (Array.isArray(du)) du = du[0];
    const picks = asArray<any>(du?.draftPick)
      .map((p) => ({
        round: Number(p?.round),
        pick: Number(p?.pick),
        playerId: String(p?.player ?? "")
      }))
      .filter((p) => p.playerId && Number.isFinite(p.round) && Number.isFinite(p.pick));
    if (picks.length === 0) {
      bump("no picks");
      continue;
    }
    picks.sort((a, b) => a.round - b.round || a.pick - b.pick);

    const scores = new Map<string, number>();
    for (const row of asArray<any>(raw?.playerScores?.playerScores?.playerScore)) {
      const v = Number(row?.score);
      if (row?.id && Number.isFinite(v)) scores.set(String(row.id), v);
    }
    if (scores.size === 0) {
      bump("no player scores");
      continue;
    }

    const posById = positionsFor(String(raw.season));
    if (Object.keys(posById).length === 0) {
      bump("no player database for season");
      continue;
    }

    let idp = 0;
    let known = 0;
    const posCounter = new Map<Pos, number>();
    const rows: Pending[] = [];
    let overall = 0;

    for (const pick of picks) {
      overall += 1;
      const rawPos = posById[pick.playerId];
      if (rawPos) {
        known += 1;
        if (IDP.has(rawPos.toUpperCase())) idp += 1;
      }
      const position = mapPosition(rawPos);
      if (!position) continue;
      const posRank = (posCounter.get(position) ?? 0) + 1;
      posCounter.set(position, posRank);
      const pts = scores.get(pick.playerId);
      if (pts == null) continue;
      rows.push({
        leagueKey: `${raw.season}-${raw.leagueId}`,
        season: String(raw.season),
        position,
        playerId: pick.playerId,
        overallRank: overall,
        posRank,
        points: pts,
        format
      });
    }

    if (known === 0 || idp / known >= 0.15) {
      bump("IDP league");
      continue;
    }
    if (rows.length < 20) {
      bump("too few scored picks");
      continue;
    }
    perLeague.set(rows[0]!.leagueKey, rows);
    leagues += 1;
  }

  // Pass 2 — within-league z-score, then edge.
  const staged: Array<Omit<Obs, "residual">> = [];
  for (const rows of perLeague.values()) {
    const pts = rows.map((r) => r.points);
    const m = mean(pts);
    const s = sd(pts);
    if (!(s > 0)) continue;
    for (const r of rows) {
      const replacement = positionReplacementRank(r.position, r.format);
      const trueValue = ecrToTrueValue(r.posRank, r.posRank, replacement);
      const perceivedValue = ecrToPerceivedValue(r.overallRank, rows.length);
      staged.push({
        leagueKey: r.leagueKey,
        clusterKey: `${r.season}:${r.playerId}`,
        position: r.position,
        overallRank: r.overallRank,
        posRank: r.posRank,
        trueValue,
        perceivedValue,
        edge: trueValue - perceivedValue,
        points: r.points,
        pointsZ: (r.points - m) / s
      });
    }
  }

  // Pass 3 — leave-one-league-out expected performance by overall draft slot.
  const byLeague = new Map<string, Array<Omit<Obs, "residual">>>();
  for (const o of staged) {
    const b = byLeague.get(o.leagueKey);
    if (b) b.push(o);
    else byLeague.set(o.leagueKey, [o]);
  }

  const obs: Obs[] = [];
  for (const [held, rows] of byLeague) {
    const train = [...byLeague.entries()].filter(([k]) => k !== held).flatMap(([, v]) => v);
    if (train.length < 100) continue;
    const maxRank = Math.max(...train.map((t) => t.overallRank));
    const sums = new Array(maxRank + 1).fill(0);
    const counts = new Array(maxRank + 1).fill(0);
    for (const t of train) {
      sums[t.overallRank] += t.pointsZ;
      counts[t.overallRank] += 1;
    }
    const means: number[] = [];
    const weights: number[] = [];
    let last = 0;
    for (let r = 1; r <= maxRank; r += 1) {
      if (counts[r] > 0) {
        last = sums[r] / counts[r];
        means.push(last);
        weights.push(counts[r]);
      } else {
        means.push(last);
        weights.push(0);
      }
    }
    const fitted = isotonicDecreasing(means, weights);
    for (const o of rows) {
      const idx = Math.max(0, Math.min(fitted.length - 1, o.overallRank - 1));
      obs.push({ ...o, residual: o.pointsZ - fitted[idx]! });
    }
  }

  return { obs, leagues, rejected };
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): void {
  const fails: string[] = [];
  const ck = (name: string, got: number, want: number, tol = 1e-9) => {
    if (!Number.isFinite(got) || Math.abs(got - want) > tol) fails.push(`${name}: ${got} != ${want}`);
    else console.log(`  ok  ${name} = ${got.toFixed(6)}`);
  };

  ck("spearman perfect", spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  ck("spearman inverted", spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  ck("spearman ties handled", spearman([1, 1, 2, 2], [1, 1, 2, 2]), 1);

  const iso = isotonicDecreasing([1, 5, 3], [1, 1, 1]);
  if (iso[0]! < iso[1]! - 1e-9 || iso[1]! < iso[2]! - 1e-9) fails.push("isotonic not non-increasing");
  else console.log(`  ok  isotonic non-increasing [${iso.map((x) => x.toFixed(2)).join(", ")}]`);

  // Concordance: construct edge perfectly aligned with pointsZ at matched cost.
  const mk = (o: number, e: number, z: number, lg = "L"): Obs => ({
    leagueKey: lg, clusterKey: `s:${o}`, position: "RB", overallRank: o, posRank: o,
    trueValue: 0, perceivedValue: 0, edge: e, points: z, pointsZ: z, residual: z
  });
  ck("concordance perfect", concordanceAtMatchedCost([mk(1, 10, 5), mk(2, 1, -5)]), 1);
  ck("concordance inverted", concordanceAtMatchedCost([mk(1, 1, 5), mk(2, 10, -5)]), 0);

  // The cost band must EXCLUDE pairs drafted far apart.
  const far = concordanceAtMatchedCost([mk(1, 10, -5), mk(200, 1, 5)]);
  ck("cost band excludes distant pairs", far, 0.5);

  // Clustering must collapse duplicates: the same player-season repeated across
  // leagues must not inflate the cluster count.
  const dup: Obs[] = [];
  for (let lg = 0; lg < 50; lg += 1) dup.push({ ...mk(1, 5, 1, `L${lg}`), clusterKey: "s:same" });
  const b = clusterBootstrap(dup, (o) => o.length, 0, 1);
  if (b.clusters !== 1) fails.push(`clustering must see 1 player-season, saw ${b.clusters}`);
  else console.log("  ok  50 league copies of one player-season = 1 cluster");

  const h = holm([{ id: "A", p: 0.01 }, { id: "B", p: 0.04 }, { id: "C", p: 0.9 }]);
  const rej = h.filter((x) => x.reject).map((x) => x.id).join(",");
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

  const { obs, leagues, rejected } = build();
  const clusters = new Set(obs.map((o) => o.clusterKey)).size;

  if (process.argv.includes("--dry-run")) {
    console.log(`dry run — ${leagues} leagues, ${obs.length} player-season-league rows, ${clusters} distinct player-seasons. NO metric computed.`);
    for (const [r, n] of [...rejected].sort((a, b) => b[1] - a[1])) console.log(`  rejected ${String(n).padStart(3)} — ${r}`);
    return;
  }
  if (obs.length === 0) {
    console.error("no observations — nothing to score");
    process.exit(2);
  }

  say("# Holdout result 3 — does the reputation edge predict?");
  say();
  say(`**Executed** ${new Date().toISOString()} · **Protocol** [holdout-protocol-3.md](./holdout-protocol-3.md) (frozen \`963bdd5\`)`);
  say();
  say("> Tests the quantity the product is named for, which nothing had previously tested: `edge = trueValue − perceivedValue`. All inference clusters on **player-season**, not league — one NFL player-season appears in many leagues with identical points.");
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| leagues | ${leagues} |`);
  say(`| player-season-league rows | **${obs.length}** |`);
  say(`| **distinct player-seasons (effective N)** | **${clusters}** |`);
  say(`| mean edge | ${mean(obs.map((o) => o.edge)).toFixed(3)} |`);
  say(`| sd edge | ${sd(obs.map((o) => o.edge)).toFixed(3)} |`);
  say();

  // ── confirmatory ─────────────────────────────────────────────────────────
  const h1Stat = (o: Obs[]) => spearman(o.map((x) => x.edge), o.map((x) => x.residual));
  const h2Stat = withinPositionSpearman;
  const h3Stat = (o: Obs[]) => concordanceAtMatchedCost(o);

  const h1 = h1Stat(obs);
  const h2 = h2Stat(obs);
  const h3 = h3Stat(obs);
  const b1 = clusterBootstrap(obs, h1Stat, 0, SEED);
  const b2 = clusterBootstrap(obs, h2Stat, 0, SEED + 1);
  const b3 = clusterBootstrap(obs, h3Stat, 0.5, SEED + 2);

  const fam = holm([{ id: "H1", p: b1.p }, { id: "H2", p: b2.p }, { id: "H3", p: b3.p }]);
  const v = new Map(fam.map((f) => [f.id, f]));

  say("## Confirmatory tests (Holm-Bonferroni, all three required)");
  say();
  say("| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |");
  say("|---|---|---|---|---|---|---|");
  say(`| H1 | edge predicts beating draft cost | ${h1.toFixed(4)} | [${b1.lo.toFixed(4)}, ${b1.hi.toFixed(4)}] | ${b1.p.toFixed(4)} | ${v.get("H1")!.threshold.toFixed(4)} | ${v.get("H1")!.reject ? "**YES**" : "no"} |`);
  say(`| H2 | same, WITHIN position | ${h2.toFixed(4)} | [${b2.lo.toFixed(4)}, ${b2.hi.toFixed(4)}] | ${b2.p.toFixed(4)} | ${v.get("H2")!.threshold.toFixed(4)} | ${v.get("H2")!.reject ? "**YES**" : "no"} |`);
  say(`| H3 | concordance at matched cost (>0.5) | ${h3.toFixed(4)} | [${b3.lo.toFixed(4)}, ${b3.hi.toFixed(4)}] | ${b3.p.toFixed(4)} | ${v.get("H3")!.threshold.toFixed(4)} | ${v.get("H3")!.reject ? "**YES**" : "no"} |`);
  say();
  say(`Cluster bootstrap over **${b1.clusters} player-seasons**, ${BOOT} resamples, ${b1.distinct} distinct H1 values.`);
  say();

  const all = fam.every((f) => f.reject);
  say(`### Verdict: ${all ? "**THE REPUTATION EDGE IS DEMONSTRATED**" : "**NOT DEMONSTRATED**"}`);
  say();
  say(
    all
      ? "All three pre-registered hypotheses survive Holm correction. The edge predicts, it is not merely a position label, and it wins as a decision rule at matched draft cost."
      : "Protocol 3 §7 requires **all three**. No weight, threshold or transform is adjusted, and no re-run is permitted on this sample."
  );
  say();

  // ── diagnostics ──────────────────────────────────────────────────────────
  say("## Diagnostics (reported, NOT adjudicating)");
  say();

  const sorted = [...obs].sort((a, b) => a.edge - b.edge);
  const q = Math.floor(sorted.length / 5);
  const bottom = sorted.slice(0, q);
  const top = sorted.slice(sorted.length - q);
  say("### D1 — effect size in plain units");
  say();
  say(`Top edge quintile mean pointsZ: **${mean(top.map((o) => o.pointsZ)).toFixed(4)}**`);
  say(`Bottom edge quintile mean pointsZ: **${mean(bottom.map((o) => o.pointsZ)).toFixed(4)}**`);
  say(`Difference: **${(mean(top.map((o) => o.pointsZ)) - mean(bottom.map((o) => o.pointsZ))).toFixed(4)}** standard deviations of within-league scoring.`);
  say();

  say("### D2 — is the edge just a position label?");
  say();
  say("| position | n | mean edge | sd edge | mean residual |");
  say("|---|---|---|---|---|");
  const byPos = new Map<Pos, Obs[]>();
  for (const o of obs) {
    const b = byPos.get(o.position);
    if (b) b.push(o);
    else byPos.set(o.position, [o]);
  }
  for (const [pos, g] of [...byPos].sort((a, b) => b[1].length - a[1].length)) {
    say(`| ${pos} | ${g.length} | ${mean(g.map((o) => o.edge)).toFixed(2)} | ${sd(g.map((o) => o.edge)).toFixed(2)} | ${mean(g.map((o) => o.residual)).toFixed(4)} |`);
  }
  say();
  const betweenPos = sd([...byPos.values()].map((g) => mean(g.map((o) => o.edge))));
  const withinPos = mean([...byPos.values()].map((g) => sd(g.map((o) => o.edge))));
  say(`Between-position sd of mean edge: **${betweenPos.toFixed(2)}** · mean within-position sd: **${withinPos.toFixed(2)}**.`);
  say(
    withinPos < betweenPos
      ? "Within-position variation is SMALLER than between-position variation, so the edge is substantially a positional signal — which is what H2 exists to separate."
      : "Within-position variation exceeds between-position variation, so the edge is not merely a position label."
  );
  say();

  say("### D3 — minimum detectable correlation at 80% power");
  say();
  const mdc = (1.6449 + 0.8416) / Math.sqrt(Math.max(1, clusters - 3));
  say(`With **${clusters}** effective clusters, the smallest detectable Spearman correlation is about **${mdc.toFixed(4)}** (one-sided, α = 0.05).`);
  say(
    Math.abs(h1) < mdc
      ? `The observed ${h1.toFixed(4)} is **below** that, so a null means no effect large enough to detect was found — not that the effect is zero.`
      : `The observed ${h1.toFixed(4)} **exceeds** that, so the sample was adequately powered for it.`
  );
  say();

  say("### D4 — which half carries the signal?");
  say();
  const rTrue = spearman(obs.map((o) => o.trueValue), obs.map((o) => o.residual));
  const rPerc = spearman(obs.map((o) => o.perceivedValue), obs.map((o) => o.residual));
  say("| predictor | Spearman vs residual |");
  say("|---|---|");
  say(`| edge (trueValue − perceivedValue) | ${h1.toFixed(4)} |`);
  say(`| trueValue alone | ${rTrue.toFixed(4)} |`);
  say(`| perceivedValue alone | ${rPerc.toFixed(4)} |`);
  say();
  say("### D5 — same-position concordance at matched cost");
  say();
  say(`${concordanceAtMatchedCost(obs, COST_BAND, true).toFixed(4)} (H3 restricted to pairs of the same position).`);
  say();

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

const direct = (process.argv[1] ?? "").split("\\").join("/").endsWith("holdout-evaluate-3.ts");
if (direct) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
