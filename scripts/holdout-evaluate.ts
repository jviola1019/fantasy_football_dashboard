/**
 * Execute the FROZEN holdout protocol exactly once (audit §19).
 *
 * Protocol: reports/2026-08-20/holdout-protocol.md, committed 7688d14 BEFORE
 * any data was scored. Nothing in this file may be adjusted after the first
 * execution without disclosing the change and showing both results.
 *
 * Scores the SHIPPED production chain, unchanged:
 *
 *   draft pick order -> positional rank -> positionReplacementRank
 *     -> ecrToTrueValue -> PlayerMarketRecord -> runNexusSimulation
 *     -> playoffProbability
 *
 * against real playoff qualification in untouched MyFantasyLeague leagues.
 *
 *   npm run holdout:evaluate
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runNexusSimulation } from "../src/lib/simulation";
import { ecrToTrueValue } from "../src/lib/fantasypros/enrich";
import { positionReplacementRank } from "../src/lib/league/lineupDemand";
import { DEFAULT_FORMAT, type LeagueFormat, type ScoringFormat } from "../src/lib/trade/format";
import type { PlayerMarketRecord } from "../src/lib/governance";

const DATA_DIR = "reports/2026-08-20/holdout-data";
/** Protocol 1's IMMUTABLE 21-league sample. Never re-bundled into. */
const BUNDLE = "reports/2026-08-20/holdout-data.jsonl.gz";
/** Protocol 2's frozen 150-league sample. */
const BUNDLE_P2 = "reports/2026-08-20/holdout-data-p2.jsonl.gz";
const PLAYERS_BUNDLE = "reports/2026-08-20/holdout-players.json.gz";
const OUT = "reports/2026-08-20/holdout-result.md";

/** Production SIM_BASE, unmodified (protocol §7). */
const SEED = 20260513;
const ITERATIONS = 2500;
const RISK_TOLERANCE = 0.58;
/** Draft order carries no dispersion signal; constant across teams (as in the Sleeper harness). */
const MEDIAN_VOLATILITY = 35;

const BOOTSTRAP_ITERATIONS = 5000;
const BOOTSTRAP_SEED = 12345;

type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
const IDP = new Set(["DT", "DE", "LB", "CB", "S", "IDP"]);

/* eslint-disable @typescript-eslint/no-explicit-any */

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** MFL position token -> RAE position, or null when it is IDP/unknown. */
function mapPosition(raw: string | undefined): Pos | null {
  if (!raw) return null;
  const p = raw.toUpperCase().trim();
  if (p === "PK" || p === "TMPK" || p === "K") return "K";
  if (p === "DEF" || p === "DST" || p === "TMDF" || p === "D/ST") return "DEF";
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE") return p;
  return null;
}

function isIdp(raw: string | undefined): boolean {
  return raw ? IDP.has(raw.toUpperCase().trim()) : false;
}

/** MFL limits are "1" or a "2-3" range. The MIN is the fixed slot. */
function minLimit(limit: string | undefined): number {
  if (!limit) return 0;
  const first = limit.split("-")[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : 0;
}

export interface HoldoutLeague {
  key: string;
  season: number;
  leagueId: string;
  name: string;
  format: LeagueFormat;
  franchises: string[];
  playoffField: number;
  /** franchiseId -> drafted players, in pick order. */
  rosters: Map<string, Array<{ playerId: string; position: Pos; adpRank: number; pickNo: number }>>;
  /** franchiseId -> regular-season standings rank (1 = best). */
  standingsRank: Map<string, number>;
  totalPicks: number;
}

/**
 * Parse MFL starter slots into the RAE LeagueStarters shape.
 *
 * MFL gives per-position ranges plus a total `count`. Fixed slots are the range
 * minimums; whatever the total exceeds their sum is FLEX. This is the standard
 * reading of an MFL lineup and does not require guessing.
 */
function parseStarters(L: any): LeagueFormat["starters"] | null {
  const s = L?.starters;
  if (!s) return null;
  const total = Number(s.count);
  if (!Number.isFinite(total) || total < 1) return null;

  const starters = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, DEF: 0, K: 0, SUPERFLEX: 0 };
  let fixed = 0;
  for (const entry of asArray<any>(s.position)) {
    const pos = mapPosition(entry?.name);
    if (!pos) continue; // IDP slots are handled by the league-level IDP filter
    const n = minLimit(entry?.limit);
    starters[pos] += n;
    fixed += n;
  }
  if (fixed === 0) return null;
  starters.FLEX = Math.max(0, total - fixed);
  return starters;
}

/**
 * Playoff field size P (protocol §6): the largest non-consolation bracket.
 * The exclusion pattern is the one frozen in the protocol.
 */
const CONSOLATION = /consolation|toilet|loser|place|3rd|5th|7th/i;

function playoffField(brackets: any): number | null {
  const list = asArray<any>(brackets?.playoffBrackets?.playoffBracket);
  let best = 0;
  for (const b of list) {
    const label = `${b?.name ?? ""} ${b?.bracketWinnerTitle ?? ""}`;
    if (CONSOLATION.test(label)) continue;
    const n = Number(b?.teamsInvolved);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best >= 2 ? best : null;
}

/**
 * season -> (playerId -> MFL position), from `_players-{season}.json`.
 *
 * `TYPE=playerScores` returns `{id, week, score, isAvailable}` and carries NO
 * position, so the per-season player database is the only source. Caught by
 * running this harness in `--parse-only` mode before any metric was computed.
 */
const playerPositions = new Map<string, Record<string, string>>();

/** Loaded lazily from the committed bundle when the loose files are absent. */
let bundledPlayers: Record<string, Record<string, string>> | null = null;

function positionsFor(season: string): Record<string, string> {
  const cached = playerPositions.get(season);
  if (cached) return cached;

  let map: Record<string, string> = {};
  try {
    // Working set first.
    map = JSON.parse(readFileSync(join(DATA_DIR, `_players-${season}.json`), "utf8")) as Record<
      string,
      string
    >;
  } catch {
    // Fall back to the committed bundle. Without this the holdout does NOT
    // reproduce from a clean checkout: the loose files are gitignored, so every
    // league is rejected for "no player database for season" and the result
    // silently becomes empty. Found by actually deleting the working directory
    // and re-running, rather than by asserting the claim.
    if (bundledPlayers == null) {
      try {
        bundledPlayers = JSON.parse(
          gunzipSync(readFileSync(PLAYERS_BUNDLE)).toString("utf8")
        ) as Record<string, Record<string, string>>;
      } catch {
        bundledPlayers = {};
      }
    }
    map = bundledPlayers[season] ?? {};
  }

  playerPositions.set(season, map);
  return map;
}

function parseLeague(raw: any): { league: HoldoutLeague | null; reason: string } {
  const L = raw?.league?.league;
  if (!L) return { league: null, reason: "no league payload" };

  const franchises = asArray<any>(L?.franchises?.franchise)
    .map((f) => String(f?.id ?? ""))
    .filter(Boolean);
  const numTeams = franchises.length;
  if (numTeams < 8 || numTeams > 16) return { league: null, reason: "franchise count" };

  const starters = parseStarters(L);
  if (!starters) return { league: null, reason: "unparseable starters" };

  const P = playoffField(raw?.playoffBrackets);
  if (P == null || P >= numTeams) return { league: null, reason: "no usable playoff bracket" };

  // --- draft -> positional ranks ------------------------------------------
  let du = raw?.draftResults?.draftResults?.draftUnit;
  if (Array.isArray(du)) du = du[0];
  const picks = asArray<any>(du?.draftPick)
    .map((p) => ({
      pickNo: Number(p?.pick),
      round: Number(p?.round),
      playerId: String(p?.player ?? ""),
      franchise: String(p?.franchise ?? "")
    }))
    .filter((p) => p.playerId && p.franchise && Number.isFinite(p.round) && Number.isFinite(p.pickNo));
  if (picks.length === 0) return { league: null, reason: "no picks" };

  // MFL `pick` restarts each round, so overall order is (round, pick).
  picks.sort((a, b) => (a.round - b.round) || (a.pickNo - b.pickNo));

  // MFL draftResults carries only player ids, so positions come from the
  // per-season player database (see positionsFor).
  const posById = positionsFor(String(raw.season));
  if (Object.keys(posById).length === 0) {
    return { league: null, reason: "no player database for season — run acquire-mfl-players" };
  }

  let idpCount = 0;
  let known = 0;
  const rosters = new Map<string, Array<{ playerId: string; position: Pos; adpRank: number; pickNo: number }>>();
  const posCounter = new Map<Pos, number>();
  let overall = 0;

  for (const pick of picks) {
    overall += 1;
    const rawPos = posById[pick.playerId];
    if (rawPos) {
      known += 1;
      if (isIdp(rawPos)) idpCount += 1;
    }
    const position = mapPosition(rawPos);
    if (!position) continue;
    const adpRank = (posCounter.get(position) ?? 0) + 1;
    posCounter.set(position, adpRank);
    const list = rosters.get(pick.franchise) ?? [];
    list.push({ playerId: pick.playerId, position, adpRank, pickNo: overall });
    rosters.set(pick.franchise, list);
  }

  if (known === 0) return { league: null, reason: "no player positions resolvable" };
  if (idpCount / known >= 0.15) return { league: null, reason: "IDP league" };
  if (rosters.size < numTeams) return { league: null, reason: "not every franchise drafted" };

  // --- standings -> rank ---------------------------------------------------
  const rows = asArray<any>(raw?.leagueStandings?.leagueStandings?.franchise)
    .map((f) => ({ id: String(f?.id ?? ""), w: Number(f?.h2hw), pf: Number(f?.pf) }))
    .filter((f) => f.id && Number.isFinite(f.w) && Number.isFinite(f.pf));
  if (rows.length !== numTeams) return { league: null, reason: "standings incomplete" };

  rows.sort((a, b) => b.w - a.w || b.pf - a.pf);
  // Protocol §6: franchises still tied after (wins, points-for) are excluded
  // rather than ordered arbitrarily — an arbitrary order would fabricate the
  // outcome label for the teams on the playoff cut line.
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i]!.w === rows[i - 1]!.w && rows[i]!.pf === rows[i - 1]!.pf) {
      return { league: null, reason: "unbreakable standings tie" };
    }
  }
  const standingsRank = new Map<string, number>();
  rows.forEach((r, i) => standingsRank.set(r.id, i + 1));

  const scoringFormat: ScoringFormat = "PPR"; // see limitations; MFL scoring is not parsed
  const format: LeagueFormat = {
    ...DEFAULT_FORMAT,
    numTeams,
    scoringFormat,
    starters,
    rosterSize: Number(L?.rosterSize) || DEFAULT_FORMAT.rosterSize,
    playoffTeams: P,
    playoffWeekStart: Number(L?.lastRegularSeasonWeek)
      ? Number(L.lastRegularSeasonWeek) + 1
      : DEFAULT_FORMAT.playoffWeekStart
  };

  return {
    league: {
      key: `${raw.season}-${raw.leagueId}`,
      season: Number(raw.season),
      leagueId: String(raw.leagueId),
      name: String(L?.name ?? raw.leagueId),
      format,
      franchises,
      playoffField: P,
      rosters,
      standingsRank,
      totalPicks: overall
    },
    reason: "ok"
  };
}

function record(p: { playerId: string; position: Pos }, trueValue: number): PlayerMarketRecord {
  return {
    id: p.playerId,
    name: p.playerId,
    position: p.position,
    team: null,
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: MEDIAN_VOLATILITY,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: p.position,
    status: "active",
    imageUrl: "",
    imageSource: "holdout"
  } as PlayerMarketRecord;
}

export interface Row {
  leagueKey: string;
  franchise: string;
  forecast: number;
  actual: 0 | 1;
  climatology: number;
  draftCapital: number;
  /**
   * Draft-only features for the D3 "signal ceiling" diagnostic (protocol 2 §4).
   *
   * All are computable before week 1 and contain no outcome information, so
   * fitting on them cannot leak. They exist to answer a question the model's own
   * failure cannot: is ANY draft-derived predictor better than the base rate, or
   * is the task itself close to unpredictable?
   *
   * Adding fields here does not affect any protocol-1 metric — the forecast,
   * outcome and climatology columns are untouched — and that invariance was
   * verified by re-running and comparing.
   */
  features: {
    /** Sum over picks of (totalPicks - pickNo). Higher = earlier overall draft slot. */
    draftCapital: number;
    /** Fraction of the franchise's first five picks spent on QB or TE. */
    earlyQbTeShare: number;
    /** Best (lowest) positional rank the franchise holds anywhere. */
    bestPositionalRank: number;
    /** Mean positional rank across the roster — overall draft quality. */
    meanPositionalRank: number;
    /** Count of top-12-at-position players held. */
    eliteCount: number;
    /** Shannon entropy of the positional mix — balanced vs concentrated. */
    positionalEntropy: number;
  };
}

/**
 * Score every league into rows. Exported so the post-hoc diagnostics run on the
 * SAME construction — a second implementation could drift and would then be
 * characterising a different model than the one that was evaluated.
 */
export function scoreLeagues(leagues: HoldoutLeague[]): {
  rows: Row[];
  byLeague: Map<string, Row[]>;
} {
  const rows: Row[] = [];
  const byLeague = new Map<string, Row[]>();

  for (const lg of leagues) {
    const leagueRows: Row[] = [];
    const rosterSlots = Math.max(
      1,
      Object.values(lg.format.starters).reduce((a, b) => a + b, 0)
    );
    for (const [franchise, players] of lg.rosters) {
      const rank = lg.standingsRank.get(franchise);
      if (rank == null) continue;
      const records = players.map((p) =>
        record(
          p,
          ecrToTrueValue(p.adpRank, p.adpRank, positionReplacementRank(p.position, lg.format))
        )
      );
      const sim = runNexusSimulation(records, {
        seed: SEED,
        iterations: ITERATIONS,
        rosterSlots,
        riskTolerance: RISK_TOLERANCE,
        scoringFormat: lg.format.scoringFormat,
        numTeams: lg.format.numTeams,
        playoffTeams: lg.playoffField,
        regularSeasonWeeks: Math.max(1, (lg.format.playoffWeekStart ?? 15) - 1),
        // Off-season structural path — the path a pre-draft user sees.
        weeklyProjections: null
      });
      leagueRows.push({
        leagueKey: lg.key,
        franchise,
        forecast: sim.playoffProbability / 100,
        actual: rank <= lg.playoffField ? 1 : 0,
        climatology: lg.playoffField / lg.format.numTeams,
        draftCapital: players.reduce((a, p) => a + (lg.totalPicks - p.pickNo), 0),
        features: draftFeatures(players, lg.totalPicks)
      });
    }
    if (leagueRows.length === 0) continue;
    byLeague.set(lg.key, leagueRows);
    rows.push(...leagueRows);
  }

  return { rows, byLeague };
}

/**
 * Draft-only features (protocol 2 D3). Pre-season by construction: every input
 * is a pick number or a positional rank, both fixed before week 1.
 */
function draftFeatures(
  players: Array<{ position: Pos; adpRank: number; pickNo: number }>,
  totalPicks: number
): Row["features"] {
  const byPick = [...players].sort((a, b) => a.pickNo - b.pickNo);
  const firstFive = byPick.slice(0, 5);
  const counts = new Map<Pos, number>();
  for (const p of players) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);

  let entropy = 0;
  for (const c of counts.values()) {
    const q = c / players.length;
    if (q > 0) entropy -= q * Math.log(q);
  }

  return {
    draftCapital: players.reduce((a, p) => a + (totalPicks - p.pickNo), 0),
    earlyQbTeShare:
      firstFive.length === 0
        ? 0
        : firstFive.filter((p) => p.position === "QB" || p.position === "TE").length /
          firstFive.length,
    bestPositionalRank: players.length === 0 ? 999 : Math.min(...players.map((p) => p.adpRank)),
    meanPositionalRank:
      players.length === 0 ? 999 : players.reduce((a, p) => a + p.adpRank, 0) / players.length,
    eliteCount: players.filter((p) => p.adpRank <= 12).length,
    positionalEntropy: entropy
  };
}

/** Load, parse and score in one call — the entry point diagnostics use. */
export function buildHoldoutRows(source: RawSource = "pinned"): {
  rows: Row[];
  leagues: HoldoutLeague[];
} {
  const leagues: HoldoutLeague[] = [];
  for (const raw of loadRaw(source)) {
    const { league } = parseLeague(raw);
    if (league) leagues.push(league);
  }
  return { rows: scoreLeagues(leagues).rows, leagues };
}

// ── metrics ────────────────────────────────────────────────────────────────

const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

const brier = (rows: Row[], f: (r: Row) => number) =>
  rows.reduce((a, r) => a + (f(r) - r.actual) ** 2, 0) / rows.length;

const logLoss = (rows: Row[], f: (r: Row) => number) =>
  -rows.reduce((a, r) => {
    const p = clamp(f(r));
    return a + (r.actual === 1 ? Math.log(p) : Math.log(1 - p));
  }, 0) / rows.length;

function auc(rows: Row[], f: (r: Row) => number): number | null {
  const pos = rows.filter((r) => r.actual === 1).map(f);
  const neg = rows.filter((r) => r.actual === 0).map(f);
  if (pos.length === 0 || neg.length === 0) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

function reliability(rows: Row[], f: (r: Row) => number, bins = 10) {
  const out: Array<{ lo: number; hi: number; n: number; mean: number; observed: number }> = [];
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = rows.filter((r) => {
      const p = f(r);
      return b === bins - 1 ? p >= lo && p <= hi : p >= lo && p < hi;
    });
    if (inBin.length === 0) {
      out.push({ lo, hi, n: 0, mean: Number.NaN, observed: Number.NaN });
      continue;
    }
    out.push({
      lo,
      hi,
      n: inBin.length,
      mean: inBin.reduce((a, r) => a + f(r), 0) / inBin.length,
      observed: inBin.reduce((a, r) => a + r.actual, 0) / inBin.length
    });
  }
  return out;
}

function ece(rows: Row[], f: (r: Row) => number, bins = 10): number {
  let total = 0;
  for (const b of reliability(rows, f, bins)) {
    if (b.n === 0) continue;
    total += (b.n / rows.length) * Math.abs(b.mean - b.observed);
  }
  return total;
}

/**
 * Cluster bootstrap over whole leagues, reporting the resolution the interval
 * actually has (audit §5 — a k-cluster bootstrap reaches only C(2k-1,k)
 * distinct multisets, regardless of iteration count).
 */
function clusterBootstrap(
  byLeague: Map<string, Row[]>,
  stat: (rows: Row[]) => number | null
): { lo: number; hi: number; distinct: number; clusters: number } | null {
  const keys = [...byLeague.keys()];
  if (keys.length < 2) return null;
  let s = BOOTSTRAP_SEED >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const samples: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i += 1) {
    const rows: Row[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      rows.push(...byLeague.get(keys[Math.floor(rand() * keys.length)]!)!);
    }
    const v = stat(rows);
    if (v != null && Number.isFinite(v)) samples.push(v);
  }
  if (samples.length < 100) return null;
  samples.sort((a, b) => a - b);
  return {
    lo: samples[Math.floor(0.025 * samples.length)]!,
    hi: samples[Math.floor(0.975 * samples.length)]!,
    distinct: new Set(samples.map((v) => v.toFixed(6))).size,
    clusters: keys.length
  };
}

// ── main ───────────────────────────────────────────────────────────────────

/**
 * Where to read leagues from.
 *
 * `"pinned"` reads ONLY the committed bundle. Protocol 1's sample is frozen at
 * the 21 leagues archived when it ran, so its harness must never silently pick
 * up leagues acquired later — otherwise `npm run holdout:evaluate` reports a
 * different number under the same protocol name every time the working
 * directory grows. That is not hypothetical: it happened during this audit, and
 * a run intended as a determinism check silently scored 43 clusters instead of
 * 13. Disclosed in the ledger.
 *
 * `"working"` reads the live acquisition directory and is what protocol 2 uses.
 */
export type RawSource = "pinned" | "working";

function loadRaw(source: RawSource = "pinned"): any[] {
  const readBundle = (path: string): any[] =>
    gunzipSync(readFileSync(path))
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

  if (source === "working") {
    // Live acquisition directory first; otherwise protocol 2's frozen bundle, so
    // protocol 2 reproduces from a clean checkout exactly as protocol 1 does.
    if (existsSync(DATA_DIR)) {
      const files = readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
        .sort();
      if (files.length > 0) {
        return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")));
      }
    }
    if (existsSync(BUNDLE_P2)) return readBundle(BUNDLE_P2);
    throw new Error("no protocol-2 sample — run `npm run holdout:acquire` first");
  }

  // "pinned": protocol 1's immutable 21-league sample, and nothing else. It must
  // never absorb later-acquired leagues.
  if (existsSync(BUNDLE)) return readBundle(BUNDLE);
  throw new Error("protocol 1's pinned bundle is missing");
}

/**
 * Verify the metric implementations against inputs with KNOWN answers.
 *
 * The frozen protocol permits one execution, so the scoring path must be right
 * the first time. `--parse-only` already proves the MFL parsing; this proves the
 * arithmetic, and neither touches the holdout answer.
 */
function selfTest(): void {
  const mk = (forecast: number, actual: 0 | 1, league = "L1"): Row => ({
    leagueKey: league,
    franchise: `${league}-${forecast}-${actual}`,
    forecast,
    actual,
    climatology: 0.5,
    draftCapital: forecast,
    features: {
      draftCapital: 0,
      earlyQbTeShare: 0,
      bestPositionalRank: 1,
      meanPositionalRank: 1,
      eliteCount: 0,
      positionalEntropy: 0
    }
  });
  const f = (r: Row) => r.forecast;
  const fail: string[] = [];
  const check = (name: string, got: number | null, want: number, tol = 1e-9) => {
    if (got == null || Math.abs(got - want) > tol) fail.push(`${name}: got ${got}, want ${want}`);
    else console.log(`  ok  ${name} = ${got}`);
  };

  // A perfect ranker separates every positive above every negative.
  check("AUC perfect", auc([mk(0.9, 1), mk(0.8, 1), mk(0.2, 0), mk(0.1, 0)], f), 1);
  // A perfectly inverted ranker is 0 — the shape the shipped model shows.
  check("AUC inverted", auc([mk(0.1, 1), mk(0.2, 1), mk(0.8, 0), mk(0.9, 0)], f), 0);
  // Constant forecasts are all ties, counted 0.5.
  check("AUC constant", auc([mk(0.5, 1), mk(0.5, 0)], f), 0.5);

  // Brier of a perfect deterministic forecaster is 0; of a maximally wrong one, 1.
  check("Brier perfect", brier([mk(1, 1), mk(0, 0)], f), 0);
  check("Brier inverted", brier([mk(0, 1), mk(1, 0)], f), 1);
  // Always 0.5 against a 50% base rate.
  check("Brier constant", brier([mk(0.5, 1), mk(0.5, 0)], f), 0.25);

  // Log loss of a confident correct forecast is ~0; clamping keeps it finite
  // rather than -Infinity on a confident wrong one.
  check("logLoss perfect", logLoss([mk(1, 1), mk(0, 0)], f), 0, 1e-5);
  const blown = logLoss([mk(0, 1)], f);
  if (!Number.isFinite(blown)) fail.push("logLoss must stay finite under clamping");
  else console.log(`  ok  logLoss clamped = ${blown.toFixed(4)}`);

  // A perfectly calibrated forecaster has ECE 0.
  const calibrated = [mk(0.5, 1), mk(0.5, 0), mk(0.9, 1), mk(0.9, 1)];
  check("ECE calibrated", ece(calibrated, f), 0.1, 0.1001);

  // Cluster bootstrap must report the RESOLUTION limit, not just an interval.
  const byLeague = new Map<string, Row[]>([
    ["A", [mk(0.9, 1, "A"), mk(0.1, 0, "A")]],
    ["B", [mk(0.8, 1, "B"), mk(0.2, 0, "B")]],
    ["C", [mk(0.7, 1, "C"), mk(0.3, 0, "C")]]
  ]);
  const b = clusterBootstrap(byLeague, (rs) => auc(rs, f));
  if (!b || b.clusters !== 3) fail.push("bootstrap must report cluster count");
  else console.log(`  ok  bootstrap clusters=${b.clusters} distinct=${b.distinct}`);

  if (fail.length > 0) {
    console.error("\nSELF-TEST FAILED:");
    for (const m of fail) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("\nself-test PASSED — metric arithmetic verified, holdout untouched.");
}

function main(): void {
  const out: string[] = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  const raws = loadRaw();
  say("# Holdout result — shipped valuation chain on untouched MyFantasyLeague data");
  say();
  say(`**Executed** ${new Date().toISOString()} · **Protocol** [holdout-protocol.md](./holdout-protocol.md) (frozen \`7688d14\`)`);
  say();
  say(`Archived leagues read: **${raws.length}**`);
  say();

  const leagues: HoldoutLeague[] = [];
  const rejected = new Map<string, number>();
  for (const raw of raws) {
    const { league, reason } = parseLeague(raw);
    if (league) leagues.push(league);
    else rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
  }

  say("## Sample construction");
  say();
  say(`| stage | leagues |`);
  say(`|---|---|`);
  say(`| archived | ${raws.length} |`);
  for (const [reason, n] of [...rejected].sort((a, b) => b[1] - a[1])) {
    say(`| rejected — ${reason} | ${n} |`);
  }
  say(`| **scored** | **${leagues.length}** |`);
  say();

  // A diagnostic mode must never touch the result file. `--parse-only` used to
  // fall through to this write and OVERWROTE a completed run's 185-line report
  // with a stub — exactly the quiet destruction of evidence this audit exists to
  // prevent. Found by doing it.
  const parseOnly = process.argv.includes("--parse-only");

  if (leagues.length < 2) {
    say("Fewer than two usable leagues — no claim can be made. Stopping.");
    if (!parseOnly) writeFileSync(OUT, out.join("\n"));
    return;
  }

  // `--parse-only` verifies MFL parsing against real shapes without computing
  // ANY metric, so the harness can be debugged without peeking at the holdout
  // answer. Nothing below this point runs in that mode.
  if (process.argv.includes("--parse-only")) {
    console.log("\n--- parse-only: sample construction only, NO metric computed ---");
    for (const lg of leagues.slice(0, 8)) {
      const slots = Object.entries(lg.format.starters)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}${n}`)
        .join("/");
      console.log(
        `  ${lg.key.padEnd(14)} ${String(lg.format.numTeams).padStart(2)} teams  ` +
          `P=${lg.playoffField}  rosters=${lg.rosters.size}  picks=${lg.totalPicks}  ${slots}`
      );
    }
    return;
  }

  // --- score ---------------------------------------------------------------
  const { rows, byLeague } = scoreLeagues(leagues);

  const nClusters = byLeague.size;
  const observedRate = rows.reduce((a, r) => a + r.actual, 0) / rows.length;
  const structuralRate = rows.reduce((a, r) => a + r.climatology, 0) / rows.length;

  say("## Sample");
  say();
  say(`| quantity | value |`);
  say(`|---|---|`);
  say(`| team-seasons (rows) | **${rows.length}** |`);
  say(`| leagues (clusters) | **${nClusters}** |`);
  say(`| seasons | ${[...new Set(leagues.map((l) => l.season))].sort().join(", ")} |`);
  say(`| league sizes | ${[...new Set(leagues.map((l) => l.format.numTeams))].sort((a, b) => a - b).join(", ")} |`);
  say(`| playoff fields | ${[...new Set(leagues.map((l) => l.playoffField))].sort((a, b) => a - b).join(", ")} |`);
  say(`| observed qualification rate | ${observedRate.toFixed(4)} |`);
  say(`| structural rate (mean P/N) | ${structuralRate.toFixed(4)} |`);
  say();
  say(
    "> **Self-check caveat, stated rather than hidden.** Protocol §6 declared a " +
      "check that the observed rate equals the structural rate. Because the outcome " +
      "label is DEFINED as `standings rank <= P`, that identity holds by " +
      "construction and the check is therefore vacuous — it validates arithmetic, " +
      "not the bracket read. A genuine check would compare against actual bracket " +
      "participants (`TYPE=playoffBracket&BRACKET_ID=`), which was not acquired. " +
      "The risk this leaves: if `P` is misread for some league shape, those teams " +
      "are mislabeled. `P` is taken from the largest non-consolation bracket's " +
      "`teamsInvolved`, which is the field size in every league inspected by hand."
  );
  say();

  const f = (r: Row) => r.forecast;
  const c = (r: Row) => r.climatology;

  const modelBrier = brier(rows, f);
  const climBrier = brier(rows, c);
  const skill = 1 - modelBrier / climBrier;
  const modelAuc = auc(rows, f);
  const capitalAuc = auc(rows, (r) => r.draftCapital);

  say("## Headline");
  say();
  say("| forecaster | Brier | log loss | AUC | ECE |");
  say("|---|---|---|---|---|");
  say(
    `| **shipped chain** | **${modelBrier.toFixed(4)}** | ${logLoss(rows, f).toFixed(4)} | **${modelAuc?.toFixed(4) ?? "n/a"}** | ${ece(rows, f).toFixed(4)} |`
  );
  say(
    `| structural climatology (P/N) | ${climBrier.toFixed(4)} | ${logLoss(rows, c).toFixed(4)} | 0.5 by construction | ${ece(rows, c).toFixed(4)} |`
  );
  say(`| raw draft capital | — | — | ${capitalAuc?.toFixed(4) ?? "n/a"} | — |`);
  say();
  say(`Brier skill score vs structural climatology: **${skill.toFixed(4)}**`);
  say();

  // --- uncertainty ---------------------------------------------------------
  const aucCI = clusterBootstrap(byLeague, (rs) => auc(rs, f));
  const skillCI = clusterBootstrap(byLeague, (rs) => {
    const cb = brier(rs, c);
    return cb > 0 ? 1 - brier(rs, f) / cb : null;
  });

  say("## Uncertainty — cluster bootstrap over whole leagues");
  say();
  say(`| quantity | 95% CI | clusters | distinct resample values |`);
  say(`|---|---|---|---|`);
  if (aucCI) {
    say(`| AUC | [${aucCI.lo.toFixed(4)}, ${aucCI.hi.toFixed(4)}] | ${aucCI.clusters} | ${aucCI.distinct} |`);
  }
  if (skillCI) {
    say(`| Brier skill | [${skillCI.lo.toFixed(4)}, ${skillCI.hi.toFixed(4)}] | ${skillCI.clusters} | ${skillCI.distinct} |`);
  }
  say();
  say(
    `Resolution: a ${nClusters}-cluster bootstrap can reach a very large number of ` +
      `distinct multisets, so unlike the 3-cluster development-set intervals these ` +
      `are genuinely estimated rather than a percentile of a handful of values.`
  );
  say();

  // --- reliability ---------------------------------------------------------
  say("## Reliability (10 equal-width bins)");
  say();
  say("| bin | n | mean forecast | observed rate |");
  say("|---|---|---|---|");
  for (const b of reliability(rows, f)) {
    if (b.n === 0) continue;
    say(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${b.mean.toFixed(4)} | ${b.observed.toFixed(4)} |`);
  }
  say();

  // --- verdict against the PRE-DECLARED criterion ---------------------------
  const aucPass = !!aucCI && aucCI.lo > 0.5;
  const skillPass = !!skillCI && skillCI.lo > 0;

  say("## Verdict against the criterion declared before execution");
  say();
  say("Protocol §9 required BOTH of:");
  say();
  say(`1. AUC 95% CI entirely above 0.5 — **${aucPass ? "MET" : "NOT MET"}**`);
  say(`2. Brier skill 95% CI entirely above 0 — **${skillPass ? "MET" : "NOT MET"}**`);
  say();
  if (aucPass && skillPass) {
    say("**RESULT: the shipped chain demonstrates positive external skill on this sample.**");
  } else {
    say(
      "**RESULT: the shipped chain does NOT demonstrate positive external skill on " +
        "this sample.** Per protocol §9, no parameter is adjusted and re-run on this " +
        "data. The model stays presented as a scenario generator, not a forecast."
    );
  }
  say();
  if (aucCI && aucCI.hi < 0.5) {
    say(
      "The AUC interval lies entirely BELOW 0.5, so the ranking is significantly " +
        "inverted on an untouched, many-cluster sample — the development-set finding " +
        "replicates externally."
    );
    say();
  }

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

// Guarded: importing this module (the diagnostics do) must NOT execute the
// evaluation. Only a direct invocation runs anything.
const invokedDirectly = (process.argv[1] ?? "").split("\\").join("/").endsWith("holdout-evaluate.ts");
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
