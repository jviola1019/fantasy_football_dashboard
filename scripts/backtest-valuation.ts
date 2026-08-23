/**
 * Out-of-sample backtest of the SHIPPED valuation chain, plus the
 * points-above-replacement candidate that replaces it.
 *
 * This exists because of a gap recorded in docs/model-validation-plan.md: the
 * simulator that was validated was not the simulator the product uses.
 *
 *   runSeasonSimulation  real weekly scores in — backtested, NOT on the dashboard
 *   runNexusSimulation   trueValue in — DRIVES the dashboard, never validated
 *
 * Two forecasters are scored through the identical production simulation, so
 * the only thing that differs between them is the valuation transform:
 *
 *   RANK   draft ADP -> positionReplacementRank -> ecrToTrueValue      (shipped)
 *   PAR    draft ADP -> expected points by rank -> points above replacement
 *
 * LEAKAGE CONTROLS (asserted in code, not merely promised):
 *   1. The only per-player input is `pick_no` from the completed draft. A draft
 *      happens before week 1, so it cannot contain in-season information. A
 *      historical FantasyPros ECR snapshot is NOT retrievable — rankings prune
 *      after 7 days — and draft ADP is the same quantity ECR approximates,
 *      measured on the day it mattered.
 *   2. Rosters are the DRAFTED roster only. No waiver adds, no trades.
 *   3. Actual scores are the outcome label, never an input, with ONE carefully
 *      bounded exception: the PAR curve is fitted on points from STRICTLY
 *      EARLIER seasons. A 2025 forecast may use 2022-2024 results, never 2025.
 *      The harness asserts this per league and prints the fitting seasons.
 *   4. `weeklyProjections` is null, so the offseason trueValue path — the one a
 *      pre-draft user actually sees — is the path under test.
 *   5. League format comes from the platform, not from the outcome.
 *
 * WHY THE STATISTICS ARE CLUSTERED. Within one league exactly `playoff_teams`
 * of `num_teams` qualify, so the rows in a league are strongly dependent — one
 * team making it forces another out. Treating 50 team-seasons as 50 independent
 * trials would badly overstate precision, so every interval comes from a
 * CLUSTER bootstrap that resamples whole leagues.
 *
 * Run:  npm run backtest:valuation
 * Env:  RAE_VALUATION_LEAGUES  comma-separated Sleeper league ids (optional)
 */
import { writeFileSync } from "node:fs";
import { parseSleeperFormat, type LeagueFormat } from "../src/lib/trade/format";
import { positionReplacementRank, ecrToTrueValue } from "../src/lib/fantasypros/enrich";
import { startingSlotCount, type DemandPosition } from "../src/lib/league/lineupDemand";
import {
  averageStartablePar,
  buildPointsCurve,
  curveSampleDiagnostics,
  expectedPointsAt,
  parToTrueValue,
  pointsAboveReplacement,
  type PointsCurve,
  type PointsObservation
} from "../src/lib/models/pointsCurve";
import { runNexusSimulation } from "../src/lib/simulation";
import type { PlayerMarketRecord } from "../src/lib/governance";

/**
 * Completed leagues reachable from the operator's Sleeper account that actually
 * have draft picks stored. Three further 2023-2025 league shells exist with
 * zero picks; they are excluded because no roster can be reconstructed.
 */
const DEFAULT_LEAGUES = [
  "861777048362942464", // 2022 Joe V
  "862838748457574400", // 2022 Creamy Les Coot
  "997999286245744640", // 2023 Creamy Les Coot
  "1124852606087213056", // 2024 Creamy Les Coot
  "1265735061127311360" // 2025 Creamy Les Coot 4.0
];

/**
 * Dependence treatment for the curve fit (audit 2026-08-20 SS5). Overridable
 * ONLY so the effect of the choice can be reported side by side; the default is
 * the a-priori statistical choice and is not selected by score.
 */
const CURVE_AGGREGATION = (process.env.RAE_CURVE_AGGREGATION ?? "cluster-weighted") as
  | "league-level"
  | "player-season"
  | "cluster-weighted";

const leagueIds = (process.env.RAE_VALUATION_LEAGUES ?? DEFAULT_LEAGUES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const API = "https://api.sleeper.app/v1";
/**
 * Constrain what a Sleeper response may be before it is used, and ultimately
 * written into a report on disk (CodeQL js/http-to-file-access).
 *
 * The path is a literal and the written content is derived numbers, so the
 * traversal risk the rule guards is absent — but the check is still worth
 * having on its own merits: an HTML error page or a redirect body parsed as
 * JSON would otherwise flow silently into a backtest report as if it were data,
 * which is exactly the class of failure this audit exists to catch.
 *
 * Sleeper always returns an object or an array for the endpoints used here;
 * anything else is a malformed response, not data.
 */
function isJsonPayload(v: unknown): boolean {
  return v !== null && (typeof v === "object");
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  if (!isJsonPayload(body)) return null;
  return body as T;
}

interface SleeperLeague {
  name: string;
  season: string;
  settings: Record<string, unknown>;
  scoring_settings: Record<string, unknown>;
  roster_positions: string[];
}
interface DraftPick {
  pick_no: number;
  roster_id: number | null;
  player_id: string;
  metadata?: { position?: string; first_name?: string; last_name?: string; team?: string };
}
type BracketNode = { t1?: unknown; t2?: unknown };
interface Matchup {
  players_points?: Record<string, number>;
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type Pos = (typeof POSITIONS)[number];
const isPos = (p: string | undefined): p is Pos =>
  !!p && (POSITIONS as readonly string[]).includes(p);

/** Median volatility — draft order carries no dispersion signal, so inventing
 *  one per player would be fabricating an input. Constant across teams, so it
 *  can neither create nor destroy discrimination. */
const MEDIAN_VOLATILITY = 35;

interface DraftedPlayer {
  playerId: string;
  name: string;
  team: string | null;
  position: Pos;
  /** 1-based rank within position by draft order — the pre-season signal. */
  adpRank: number;
  rosterId: number;
  pickNo: number;
}

interface LeagueData {
  id: string;
  name: string;
  season: number;
  format: LeagueFormat;
  playoffTeams: number;
  regWeeks: number;
  players: DraftedPlayer[];
  madePlayoffs: Set<number>;
  /** Actual regular-season points per player — OUTCOME data. */
  seasonPoints: Map<string, number>;
}

async function loadLeague(id: string): Promise<LeagueData | null> {
  const lg = await getJson<SleeperLeague>(`/league/${id}`);
  if (!lg) return null;
  const drafts = await getJson<Array<{ draft_id: string }>>(`/league/${id}/drafts`);
  const draftId = drafts?.[0]?.draft_id;
  if (!draftId) return null;
  const picks = await getJson<DraftPick[]>(`/draft/${draftId}/picks`);
  if (!picks || picks.length === 0) return null;
  const bracket = await getJson<BracketNode[]>(`/league/${id}/winners_bracket`);
  if (!bracket) return null;

  const format = parseSleeperFormat(lg);
  const season = Number(lg.season);
  const regWeeks = Math.max(1, (format.playoffWeekStart ?? 15) - 1);

  const madePlayoffs = new Set<number>();
  for (const node of bracket) {
    for (const t of [node.t1, node.t2]) if (typeof t === "number") madePlayoffs.add(t);
  }

  const players: DraftedPlayer[] = [];
  const posCounter = new Map<Pos, number>();
  for (const pick of [...picks].sort((a, b) => a.pick_no - b.pick_no)) {
    const position = pick.metadata?.position;
    if (!isPos(position) || pick.roster_id == null) continue;
    const adpRank = (posCounter.get(position) ?? 0) + 1;
    posCounter.set(position, adpRank);
    players.push({
      playerId: pick.player_id,
      name: `${pick.metadata?.first_name ?? ""} ${pick.metadata?.last_name ?? ""}`.trim() || pick.player_id,
      team: pick.metadata?.team ?? null,
      position,
      adpRank,
      rosterId: pick.roster_id,
      pickNo: pick.pick_no
    });
  }

  // Outcome data: actual regular-season points per player.
  const seasonPoints = new Map<string, number>();
  for (let w = 1; w <= regWeeks; w += 1) {
    const ms = await getJson<Matchup[]>(`/league/${id}/matchups/${w}`);
    if (!ms) continue;
    for (const m of ms) {
      for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
        if (typeof pts === "number") seasonPoints.set(pid, (seasonPoints.get(pid) ?? 0) + pts);
      }
    }
  }

  return {
    id,
    name: lg.name,
    season,
    format,
    playoffTeams: format.playoffTeams ?? 6,
    regWeeks,
    players,
    madePlayoffs,
    seasonPoints
  };
}

/** Observations for the PAR curve: (position, ADP rank) -> points actually scored. */
function toObservations(lg: LeagueData): PointsObservation[] {
  const out: PointsObservation[] = [];
  for (const p of lg.players) {
    const pts = lg.seasonPoints.get(p.playerId);
    if (pts == null) continue;
    out.push({
      season: lg.season,
      position: p.position as DemandPosition,
      adpRank: p.adpRank,
      // Audit 2026-08-20 SS5. Identity is what makes pseudo-replication
      // measurable: the same NFL player-season appears once per league that
      // drafted them, with a different ADP rank but the SAME outcome.
      playerId: p.playerId,
      leagueId: lg.id,
      // Audit 2026-08-22, P2-3. Season points are not comparable across scoring
      // formats: a PPR WR1 and a STANDARD WR1 differ by the receptions they
      // caught, so pooling them lifts the WR/TE curves relative to RB/QB. That
      // is the same positionally-asymmetric distortion this curve exists to
      // remove from rank-ratio VBD. Recording it makes any mixing visible in
      // `curve.mixedScoringFormats` instead of averaging it away.
      scoringFormat: lg.format.scoringFormat,
      // Normalised to a 14-week regular season so leagues of different length
      // are comparable. Without this a 14-week league would look systematically
      // weaker than a 13-week one purely from schedule length.
      seasonPoints: (pts * 14) / lg.regWeeks
    });
  }
  return out;
}

function baseRecord(p: DraftedPlayer, trueValue: number): PlayerMarketRecord {
  return {
    id: p.playerId,
    name: p.name,
    position: p.position,
    team: p.team,
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
    imageSource: "backtest"
  } as PlayerMarketRecord;
}

/** SHIPPED transform: rank-ratio VBD. */
function rankRatioRoster(lg: LeagueData, rosterId: number): PlayerMarketRecord[] {
  return lg.players
    .filter((p) => p.rosterId === rosterId)
    .map((p) =>
      baseRecord(p, ecrToTrueValue(p.adpRank, p.adpRank, positionReplacementRank(p.position, lg.format)))
    );
}

/** CANDIDATE transform: points above replacement, from a prior-seasons curve. */
function parRoster(
  lg: LeagueData,
  rosterId: number,
  curve: PointsCurve,
  parAnchor: number
): PlayerMarketRecord[] {
  return lg.players
    .filter((p) => p.rosterId === rosterId)
    .map((p) => {
      const par = pointsAboveReplacement(
        curve,
        p.position as DemandPosition,
        p.adpRank,
        positionReplacementRank(p.position, lg.format)
      );
      return baseRecord(p, par == null ? 50 : parToTrueValue(par, parAnchor));
    });
}

interface TeamRow {
  leagueId: string;
  season: number;
  rosterId: number;
  /** Shipped rank-ratio forecast. */
  rank: number;
  /** Points-above-replacement forecast; null when no prior season exists. */
  par: number | null;
  actual: 0 | 1;
  /** Raw market signal, before any transform — the ablation control. */
  draftCapital: number;
}

function simulate(lg: LeagueData, roster: PlayerMarketRecord[], rosterId: number): number {
  return (
    runNexusSimulation(roster, {
      seed: Number(lg.id.slice(-6)) + rosterId,
      iterations: 4000,
      rosterSlots: startingSlotCount(lg.format),
      riskTolerance: 0.5,
      weeklyProjections: null, // LEAKAGE CONTROL 4
      scoringFormat: lg.format.scoringFormat,
      numTeams: lg.format.numTeams,
      playoffTeams: lg.playoffTeams,
      regularSeasonWeeks: lg.regWeeks
    }).playoffProbability / 100
  );
}

// ── statistics ──────────────────────────────────────────────────────────────

const pick = (rows: TeamRow[], f: "rank" | "par") =>
  rows.filter((r) => r[f] != null) as Array<TeamRow & { rank: number; par: number }>;

function brierOf(rows: TeamRow[], f: "rank" | "par"): number | null {
  const rs = pick(rows, f);
  if (rs.length === 0) return null;
  return rs.reduce((a, r) => a + ((r[f] as number) - r.actual) ** 2, 0) / rs.length;
}

function logLossOf(rows: TeamRow[], f: "rank" | "par"): number | null {
  const rs = pick(rows, f);
  if (rs.length === 0) return null;
  const eps = 1e-6;
  return (
    -rs.reduce((a, r) => {
      const p = Math.min(1 - eps, Math.max(eps, r[f] as number));
      return a + (r.actual === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / rs.length
  );
}

/**
 * AUC via the Mann-Whitney U identity, with ties at 0.5.
 *
 * Reported alongside Brier because the two fail differently: a model can be
 * badly mis-calibrated yet rank correctly (fixable by recalibration), or be
 * perfectly calibrated to the base rate while ranking at chance (not fixable).
 */
function aucBy(rows: TeamRow[], score: (r: TeamRow) => number | null): number | null {
  const pos = rows.map(score).filter((v, i) => v != null && rows[i]!.actual === 1) as number[];
  const neg = rows.map(score).filter((v, i) => v != null && rows[i]!.actual === 0) as number[];
  if (pos.length === 0 || neg.length === 0) return null;
  let sum = 0;
  for (const p of pos) for (const n of neg) sum += p > n ? 1 : p === n ? 0.5 : 0;
  return sum / (pos.length * neg.length);
}

const climatologyBrier = (rows: TeamRow[], rate: number) =>
  rows.reduce((a, r) => a + (rate - r.actual) ** 2, 0) / rows.length;

/**
 * Cluster bootstrap over LEAGUES, respecting within-league dependence.
 *
 * RESOLUTION WARNING (audit 2026-08-20 SS5). With `k` clusters, resampling `k`
 * with replacement can only produce C(2k-1, k) distinct multisets - 10 for k=3,
 * 126 for k=5. Raising `iterations` to 5000 does NOT add resolution; it only
 * samples those few multisets more times. A 95% percentile interval from ~10
 * distinct values is effectively a min/max, and small differences between such
 * intervals - including whether one straddles 0.5 - are not evidence.
 * `distinctResamples` is returned so this can be stated rather than assumed.
 */
function clusterBootstrap(
  byLeague: Map<string, TeamRow[]>,
  stat: (rows: TeamRow[]) => number | null,
  iterations = 5000,
  seed = 12345
): { lo: number; hi: number; distinctValues: number; clusters: number } | null {
  const keys = [...byLeague.keys()];
  if (keys.length < 2) return null;
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const rows: TeamRow[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      rows.push(...byLeague.get(keys[Math.floor(rand() * keys.length)]!)!);
    }
    const v = stat(rows);
    if (v != null && Number.isFinite(v)) samples.push(v);
  }
  if (samples.length < 100) return null;
  samples.sort((a, b) => a - b);
  // How many DISTINCT values the resampling could actually reach. This is the
  // real resolution of the interval below, and it is a function of cluster
  // count, not of `iterations`.
  const distinctValues = new Set(samples.map((v) => v.toFixed(6))).size;
  return {
    lo: samples[Math.floor(0.025 * samples.length)]!,
    hi: samples[Math.floor(0.975 * samples.length)]!,
    distinctValues,
    clusters: keys.length
  };
}

const f4 = (n: number | null) => (n == null ? "   n/a" : n.toFixed(4));
const ci = (c: { lo: number; hi: number; distinctValues?: number; clusters?: number } | null) =>
  c
    ? `[${f4(c.lo)}, ${f4(c.hi)}]` +
      (c.distinctValues != null ? `  (${c.clusters} clusters, ${c.distinctValues} distinct resample values)` : "")
    : "n/a";

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const out: string[] = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  say("# Out-of-sample backtest — shipped rank-ratio VBD vs points-above-replacement");
  say(`# generated ${new Date().toISOString()}`);
  say("#");
  say("# Both forecasters run through the IDENTICAL production simulation.");
  say("# The only difference is the valuation transform.");
  say();

  const loaded: LeagueData[] = [];
  say("## Leagues");
  say();
  say("league               season  teams  fmt   wks  drafted  scored  made");
  for (const id of leagueIds) {
    const lg = await loadLeague(id);
    if (!lg) {
      say(`${id.padEnd(20)} SKIPPED — no draft picks or bracket`);
      continue;
    }
    loaded.push(lg);
    const scored = lg.players.filter((p) => lg.seasonPoints.has(p.playerId)).length;
    say(
      `${lg.name.slice(0, 20).padEnd(20)} ${String(lg.season).padEnd(7)} ` +
        `${String(lg.format.numTeams).padEnd(6)} ${lg.format.scoringFormat.padEnd(5)} ` +
        `${String(lg.regWeeks).padEnd(4)} ${String(lg.players.length).padEnd(8)} ` +
        `${String(scored).padEnd(7)} ${lg.madePlayoffs.size}`
    );
  }
  say();

  if (loaded.length === 0) {
    say("No usable leagues — nothing to score. Exiting without a claim.");
    writeFileSync("reports/2026-08-06/backtest-valuation.txt", out.join("\n"));
    return;
  }

  // ── temporal split ────────────────────────────────────────────────────────
  say("## Temporal split for the PAR curve (leakage control 3)");
  say();
  say("Each league's curve is fitted ONLY on strictly earlier seasons. A league");
  say("with no prior season gets no PAR forecast at all rather than a curve that");
  say("has seen its own outcomes.");
  say();
  say("league               season  curve fitted on      obs   PAR?");

  const obsBySeason = new Map<number, PointsObservation[]>();
  for (const lg of loaded) {
    const list = obsBySeason.get(lg.season) ?? [];
    list.push(...toObservations(lg));
    obsBySeason.set(lg.season, list);
  }

  const curves = new Map<string, PointsCurve>();
  const priorBySchedule = new Map<string, PointsObservation[]>();
  for (const lg of loaded) {
    const prior: PointsObservation[] = [];
    for (const [season, obs] of obsBySeason) if (season < lg.season) prior.push(...obs);
    if (prior.length === 0) {
      say(`${lg.name.slice(0, 20).padEnd(20)} ${String(lg.season).padEnd(7)} ${"(none)".padEnd(20)} ${String(0).padEnd(5)} no`);
      continue;
    }
    const curve = buildPointsCurve(prior, { aggregation: CURVE_AGGREGATION });
    // Hard assertion: the curve must not contain this league's own season.
    if (curve.seasons.includes(lg.season)) {
      throw new Error(`LEAKAGE: curve for ${lg.season} contains season ${lg.season}`);
    }
    curves.set(lg.id, curve);
    priorBySchedule.set(lg.id, prior);
    const total = Object.values(curve.counts).reduce((a, b) => a + (b ?? 0), 0);
    say(
      `${lg.name.slice(0, 20).padEnd(20)} ${String(lg.season).padEnd(7)} ` +
        `${curve.seasons.join(",").padEnd(20)} ${total.toFixed(1).padEnd(5)} yes` +
        `  [${curve.scoringFormats.join("+")}]`
    );
    // Audit 2026-08-22, P2-3. Said once per curve, loudly, because a mixed pool
    // does not fail — it produces a plausible curve whose POSITIONAL SHAPE is
    // wrong, and nothing downstream can detect that from the numbers.
    if (curve.mixedScoringFormats) {
      say(
        `  WARNING: this curve pools ${curve.scoringFormats.join(" + ")} leagues. Season points are ` +
          `not comparable across scoring formats, so the WR and TE curves are lifted relative to ` +
          `RB and QB and every PAR figure derived from it is positionally distorted.`
      );
    }
    if (curve.scoringFormats.length === 1 && curve.scoringFormats[0] !== lg.format.scoringFormat) {
      say(
        `  WARNING: curve fitted on ${curve.scoringFormats[0]} leagues but applied to a ` +
          `${lg.format.scoringFormat} league.`
      );
    }
  }
  say();

  // ── dependence audit (audit 2026-08-20 SS5) ───────────────────────────────
  say("## Dependence and pseudo-replication in the curve training data");
  say();
  say("The backtest pools observations from every earlier league, so ONE NFL");
  say("player-season appears once per league that drafted them - a different ADP");
  say("rank each time, but literally the same outcome. That is not automatically");
  say("wrong (ADP is league-specific), but the rows are correlated and must not");
  say("be counted as independent evidence.");
  say();
  say("fit for            raw   unique  dup   multi-lg  leagues  seasons  design effect");
  for (const lg of loaded) {
    const prior = priorBySchedule.get(lg.id);
    if (!prior) continue;
    const d = curveSampleDiagnostics(prior);
    say(
      `${`${lg.name.slice(0, 12)} ${lg.season}`.padEnd(18)} ` +
        `${String(d.rawObservations).padStart(4)}  ${String(d.uniquePlayerSeasons).padStart(6)}  ` +
        `${String(d.duplicatedPlayerSeasons).padStart(3)}  ${String(d.playerSeasonsInMultipleLeagues).padStart(8)}  ` +
        `${String(d.leagues).padStart(7)}  ${d.seasons.join("/").padEnd(14)} ${d.designEffect.toFixed(2)}`
    );
  }
  say();
  say("Per-position effective sample for the LARGEST fit:");
  say();
  {
    let biggest: PointsObservation[] = [];
    for (const prior of priorBySchedule.values()) if (prior.length > biggest.length) biggest = prior;
    if (biggest.length > 0) {
      const d = curveSampleDiagnostics(biggest);
      say("position  raw   effective  distinct ranks  design effect");
      for (const [position, stats] of Object.entries(d.perPosition)) {
        say(
          `${position.padEnd(9)} ${String(stats.rawObservations).padStart(4)}  ` +
            `${String(stats.effectiveObservations).padStart(9)}  ${String(stats.distinctRanks).padStart(14)}  ` +
            `${stats.designEffect.toFixed(2)}`
        );
      }
      say();
      say("Aggregation comparison on the same fit (A/B/C from audit SS5).");
      say("Reported side by side; the DEFAULT is chosen on statistical grounds");
      say("(cluster-weighted), NOT by whichever scores best here.");
      say();
      say("mode              effective obs  QB1 expected pts  RB1 expected pts");
      for (const aggregation of ["league-level", "player-season", "cluster-weighted"] as const) {
        const c = buildPointsCurve(biggest, { aggregation });
        const eff = Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0);
        const qb1 = expectedPointsAt(c, "QB", 1);
        const rb1 = expectedPointsAt(c, "RB", 1);
        say(
          `${aggregation.padEnd(17)} ${eff.toFixed(1).padStart(13)}  ` +
            `${(qb1 == null ? "-" : qb1.toFixed(1)).padStart(15)}  ` +
            `${(rb1 == null ? "-" : rb1.toFixed(1)).padStart(15)}`
        );
      }
    }
  }
  say();

  // ── score ─────────────────────────────────────────────────────────────────
  const all: TeamRow[] = [];
  const byLeague = new Map<string, TeamRow[]>();
  let baseNum = 0;
  let baseDen = 0;

  for (const lg of loaded) {
    const curve = curves.get(lg.id) ?? null;
    const anchor = curve ? averageStartablePar(curve, lg.format) : 0;
    const rosterIds = [...new Set(lg.players.map((p) => p.rosterId))].sort((a, b) => a - b);
    const rows: TeamRow[] = [];
    for (const rosterId of rosterIds) {
      const capital = lg.players
        .filter((p) => p.rosterId === rosterId)
        .reduce((a, p) => a + (lg.players.length - p.pickNo), 0);
      rows.push({
        leagueId: lg.id,
        season: lg.season,
        rosterId,
        rank: simulate(lg, rankRatioRoster(lg, rosterId), rosterId),
        par: curve && anchor > 0 ? simulate(lg, parRoster(lg, rosterId, curve, anchor), rosterId) : null,
        actual: lg.madePlayoffs.has(rosterId) ? 1 : 0,
        draftCapital: capital
      });
    }
    all.push(...rows);
    byLeague.set(lg.id, rows);
    baseNum += lg.playoffTeams;
    baseDen += lg.format.numTeams;
  }

  const rate = baseNum / baseDen;
  const parRows = all.filter((r) => r.par != null);
  const parByLeague = new Map([...byLeague].filter(([, rows]) => rows.some((r) => r.par != null)));

  say("## Headline");
  say();
  say(`  base rate (structural) ..... ${rate.toFixed(4)}`);
  say(`  observed qualification ..... ${(all.filter((r) => r.actual === 1).length / all.length).toFixed(4)}`);
  say();
  say("                              n    Brier    logloss  AUC      vs climatology");
  const climAll = climatologyBrier(all, rate);
  const climPar = parRows.length ? climatologyBrier(parRows, rate) : null;
  const rankBrier = brierOf(all, "rank")!;
  const parBrier = brierOf(parRows, "par");
  say(
    `  RANK (shipped)             ${String(all.length).padEnd(4)} ${f4(rankBrier)}  ${f4(logLossOf(all, "rank"))}  ` +
      `${f4(aucBy(all, (r) => r.rank))}  ${f4(1 - rankBrier / climAll)}`
  );
  say(
    `  PAR  (candidate)           ${String(parRows.length).padEnd(4)} ${f4(parBrier)}  ${f4(logLossOf(parRows, "par"))}  ` +
      `${f4(aucBy(parRows, (r) => r.par))}  ${parBrier != null && climPar ? f4(1 - parBrier / climPar) : "   n/a"}`
  );
  say(`  climatology (p=${rate.toFixed(2)})       ${String(all.length).padEnd(4)} ${f4(climAll)}`);
  say(`  raw draft capital          ${String(all.length).padEnd(4)}   —        —      ${f4(aucBy(all, (r) => r.draftCapital))}`);
  say();

  // Like-for-like: RANK restricted to the same rows PAR could score.
  if (parRows.length > 0 && parRows.length < all.length) {
    say("## Like-for-like (same rows both forecasters could score)");
    say();
    const rBrier = brierOf(parRows, "rank")!;
    const pBrier = brierOf(parRows, "par")!;
    say(`  n .......................... ${parRows.length}`);
    say(`  RANK Brier ................. ${f4(rBrier)}   AUC ${f4(aucBy(parRows, (r) => r.rank))}`);
    say(`  PAR  Brier ................. ${f4(pBrier)}   AUC ${f4(aucBy(parRows, (r) => r.par))}`);
    say(`  climatology Brier .......... ${f4(climPar)}`);
    say();
  }

  say("## Uncertainty — cluster bootstrap over leagues (5000 resamples)");
  say();
  const ciRankAuc = clusterBootstrap(byLeague, (rows) => aucBy(rows, (r) => r.rank));
  const ciParAuc = clusterBootstrap(parByLeague, (rows) => {
    const rs = rows.filter((r) => r.par != null);
    return rs.length ? aucBy(rs, (r) => r.par) : null;
  });
  const ciRankSkill = clusterBootstrap(byLeague, (rows) => {
    const b = brierOf(rows, "rank");
    return b == null ? null : 1 - b / climatologyBrier(rows, rate);
  });
  const ciParSkill = clusterBootstrap(parByLeague, (rows) => {
    const rs = rows.filter((r) => r.par != null);
    if (!rs.length) return null;
    const b = brierOf(rs, "par");
    return b == null ? null : 1 - b / climatologyBrier(rs, rate);
  });
  say(`  RANK AUC ................... ${ci(ciRankAuc)}`);
  say(`  PAR  AUC ................... ${ci(ciParAuc)}`);
  say(`  RANK skill ................. ${ci(ciRankSkill)}`);
  say(`  PAR  skill ................. ${ci(ciParSkill)}`);
  say();

  /**
   * Two DIFFERENT failures, reported separately.
   *
   * An earlier version collapsed them and reported "ranking inverted" for a
   * forecaster whose AUC interval straddled 0.5 — which was simply untrue. A
   * model can rank acceptably and still be worse calibrated than a constant;
   * that is a recalibration problem, not a broken signal.
   */
  const verdict = (
    label: string,
    aucCi: { lo: number; hi: number } | null,
    skillCi: { lo: number; hi: number } | null
  ): string[] => {
    if (!aucCi || !skillCi) return [`${label}: too few clusters for an interval.`];
    const lines: string[] = [];
    if (aucCi.hi < 0.5) {
      lines.push(`${label}: ranking is significantly INVERTED (AUC CI entirely below 0.5).`);
    } else if (aucCi.lo > 0.5) {
      lines.push(`${label}: ranks significantly better than chance.`);
    } else {
      lines.push(`${label}: ranking is not distinguishable from chance.`);
    }
    if (skillCi.hi < 0) {
      lines.push(`${" ".repeat(label.length)}  and is significantly WORSE calibrated than a constant.`);
    } else if (skillCi.lo > 0) {
      lines.push(`${" ".repeat(label.length)}  and is significantly better calibrated than a constant.`);
    } else {
      lines.push(`${" ".repeat(label.length)}  calibration is not distinguishable from a constant.`);
    }
    return lines;
  };

  say("## Verdict");
  say();
  for (const line of verdict("RANK (shipped)", ciRankAuc, ciRankSkill)) say(`  ${line}`);
  say();
  for (const line of verdict("PAR  (candidate)", ciParAuc, ciParSkill)) say(`  ${line}`);
  say();
  if (ciRankAuc && ciParAuc && ciRankAuc.hi < 0.5 && ciParAuc.hi >= 0.5) {
    say("  DIFFERENCE THAT MATTERS: rank-ratio is significantly inverted; PAR is");
    say("  not. Replacing the transform removes a measurable defect, even though");
    say("  neither forecaster yet beats a constant at this sample size.");
  }
  say();
  say(`  Effective sample size is nearer ${byLeague.size} leagues than ${all.length} rows,`);
  say(`  and PAR is scored on only ${parByLeague.size} of them (the rest have no prior season).`);
  say("  No parameter was fitted on the season being scored.");

  writeFileSync("reports/2026-08-06/backtest-valuation.txt", out.join("\n"));
  console.log("\nWrote reports/2026-08-06/backtest-valuation.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
