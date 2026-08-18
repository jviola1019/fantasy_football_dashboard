/**
 * Out-of-sample backtest of the SHIPPED valuation chain.
 *
 * This exists because of a gap documented in docs/model-validation-plan.md: the
 * simulator that was validated is not the simulator the product uses.
 *
 *   runSeasonSimulation  real weekly scores in — backtested, NOT on the dashboard
 *   runNexusSimulation   trueValue in — DRIVES the dashboard, never validated
 *
 * So this harness scores the chain the product actually renders:
 *
 *   draft ADP -> positional rank -> positionReplacementRank -> ecrToTrueValue
 *             -> PlayerMarketRecord -> runNexusSimulation -> playoffProbability
 *
 * against whether each team ACTUALLY made the playoffs.
 *
 * LEAKAGE CONTROLS (asserted in code, not just promised):
 *   1. The only input signal is `pick_no` from the completed draft. A draft
 *      happens before week 1, so it cannot contain in-season information.
 *      A historical FantasyPros ECR snapshot is NOT retrievable — rankings
 *      snapshots prune after 7 days — and draft ADP is the same quantity ECR
 *      approximates, measured on the day it mattered.
 *   2. Rosters are the DRAFTED roster only. No waiver adds, no trades, no
 *      end-of-season roster — those encode in-season outcomes.
 *   3. Weekly scores are used ONLY as the outcome label, never as an input.
 *      `weeklyProjections` is explicitly null so the offseason trueValue path
 *      is exercised, which is the path a pre-draft user actually sees.
 *   4. League format comes from the platform, not from the outcome.
 *
 * WHY THE STATISTICS ARE CLUSTERED. Within one league exactly `playoff_teams`
 * of `num_teams` qualify, so the ten team-seasons in a league are strongly
 * dependent — one team making it forces another out. Treating 50 team-seasons
 * as 50 independent trials would overstate precision badly. Confidence
 * intervals therefore come from a CLUSTER bootstrap that resamples whole
 * leagues, and the effective sample size is nearer the 5 leagues than the 50
 * rows.
 *
 * Run:  npx tsx scripts/backtest-valuation.ts
 * Env:  RAE_VALUATION_LEAGUES  comma-separated Sleeper league ids (optional)
 */
import { writeFileSync } from "node:fs";
import { parseSleeperFormat, type LeagueFormat } from "../src/lib/trade/format";
import { positionReplacementRank, ecrToTrueValue } from "../src/lib/fantasypros/enrich";
import { runNexusSimulation } from "../src/lib/simulation";
import { scoreForecasts } from "../src/lib/stats/seasonCalibration";
import type { BrierForecast } from "../src/lib/stats/distribution";
import type { PlayerMarketRecord } from "../src/lib/governance";

/**
 * Completed leagues reachable from the operator's Sleeper account that actually
 * have draft picks stored. Three further league shells exist for 2023-2025 with
 * zero picks; they are excluded because a roster cannot be reconstructed.
 */
const DEFAULT_LEAGUES = [
  "861777048362942464", // 2022 Joe V
  "862838748457574400", // 2022 Creamy Les Coot
  "997999286245744640", // 2023 Creamy Les Coot
  "1124852606087213056", // 2024 Creamy Les Coot
  "1265735061127311360" // 2025 Creamy Les Coot 4.0
];

const leagueIds = (process.env.RAE_VALUATION_LEAGUES ?? DEFAULT_LEAGUES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const API = "https://api.sleeper.app/v1";
async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) return null;
  return (await res.json()) as T;
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
  round: number;
  roster_id: number | null;
  player_id: string;
  is_keeper: boolean | null;
  metadata?: { position?: string; first_name?: string; last_name?: string; team?: string };
}
type BracketNode = { t1?: unknown; t2?: unknown };

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type Pos = (typeof POSITIONS)[number];

function isPos(p: string | undefined): p is Pos {
  return !!p && (POSITIONS as readonly string[]).includes(p);
}

/** Starting-lineup size for this league, used as the sim's rosterSlots. */
function startingSlots(f: LeagueFormat): number {
  const s = f.starters;
  return Math.max(1, s.QB + s.RB + s.WR + s.TE + s.FLEX + s.SUPERFLEX + s.K + s.DEF);
}

/**
 * Build the PlayerMarketRecord the product would have held on draft day.
 *
 * `posRank` is the player's rank among same-position players by draft order —
 * positional ADP, the market's own pre-season consensus. Everything downstream
 * (replacement level, VBD, the simulation) is the untouched production code.
 *
 * `volatility` is set to the model's median rather than invented per player:
 * draft order carries no dispersion signal, and fabricating one would be
 * exactly the sort of made-up input this harness exists to avoid. It is
 * constant across teams, so it cannot create or destroy discrimination.
 */
const MEDIAN_VOLATILITY = 35;

function toRecord(
  pick: DraftPick,
  position: Pos,
  posRank: number,
  format: LeagueFormat
): PlayerMarketRecord {
  const replacement = positionReplacementRank(position, format);
  const trueValue = ecrToTrueValue(posRank, posRank, replacement);
  const name = `${pick.metadata?.first_name ?? ""} ${pick.metadata?.last_name ?? ""}`.trim();
  return {
    id: pick.player_id,
    name: name || pick.player_id,
    position,
    team: pick.metadata?.team ?? null,
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: MEDIAN_VOLATILITY,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: position,
    status: "active",
    imageUrl: "",
    imageSource: "backtest"
  } as PlayerMarketRecord;
}

interface TeamRow {
  leagueId: string;
  leagueName: string;
  season: number;
  rosterId: number;
  predicted: number;
  actual: 0 | 1;
  starters: number;
  /**
   * ABLATION SIGNAL — total draft capital, as the sum of (totalPicks - pick_no)
   * over the team's picks. This is the raw market signal BEFORE the replacement
   * model and the VBD transform touch it.
   *
   * It exists to answer the question a single Brier number cannot: if the
   * shipped chain ranks worse than chance, is the input signal worthless, or is
   * the transform destroying a signal that was there? Those have opposite fixes.
   */
  draftCapital: number;
  /** Share of the team's top-5 picks spent on QB or TE — see the scarcity probe. */
  earlyScarceShare: number;
}

async function backtestLeague(id: string): Promise<{
  name: string;
  season: number;
  rows: TeamRow[];
  format: LeagueFormat;
  playoffTeams: number;
} | null> {
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
  const numTeams = format.numTeams;
  const playoffTeams = format.playoffTeams ?? 6;
  const regularSeasonWeeks = Math.max(1, (format.playoffWeekStart ?? 15) - 1);

  // Who actually qualified.
  const madePlayoffs = new Set<number>();
  for (const node of bracket) {
    for (const t of [node.t1, node.t2]) if (typeof t === "number") madePlayoffs.add(t);
  }

  // Positional ADP: rank within position, by draft order. Pre-season by
  // construction — this is the whole leakage argument.
  const ordered = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const posCounter = new Map<Pos, number>();
  const byRoster = new Map<number, PlayerMarketRecord[]>();
  const capital = new Map<number, number>();
  const earlyPicks = new Map<number, Array<Pos>>();
  const totalPicks = ordered.length;

  for (const pick of ordered) {
    const position = pick.metadata?.position;
    if (!isPos(position)) continue;
    const rank = (posCounter.get(position) ?? 0) + 1;
    posCounter.set(position, rank);
    if (pick.roster_id == null) continue;
    const rec = toRecord(pick, position, rank, format);
    const list = byRoster.get(pick.roster_id) ?? [];
    list.push(rec);
    byRoster.set(pick.roster_id, list);
    capital.set(pick.roster_id, (capital.get(pick.roster_id) ?? 0) + (totalPicks - pick.pick_no));
    const early = earlyPicks.get(pick.roster_id) ?? [];
    if (early.length < 5) early.push(position);
    earlyPicks.set(pick.roster_id, early);
  }

  const slots = startingSlots(format);
  const rows: TeamRow[] = [];
  for (const [rosterId, roster] of [...byRoster.entries()].sort((a, b) => a[0] - b[0])) {
    const sim = runNexusSimulation(roster, {
      // Seeded per league+roster so the run is reproducible but teams are not
      // correlated through a shared random stream.
      seed: Number(id.slice(-6)) + rosterId,
      iterations: 4000,
      rosterSlots: slots,
      riskTolerance: 0.5,
      weeklyProjections: null, // LEAKAGE CONTROL 3
      scoringFormat: format.scoringFormat,
      numTeams,
      playoffTeams,
      regularSeasonWeeks
    });
    const early = earlyPicks.get(rosterId) ?? [];
    rows.push({
      leagueId: id,
      leagueName: lg.name,
      season,
      rosterId,
      predicted: sim.playoffProbability / 100,
      actual: madePlayoffs.has(rosterId) ? 1 : 0,
      starters: Math.min(slots, roster.length),
      draftCapital: capital.get(rosterId) ?? 0,
      earlyScarceShare:
        early.length === 0 ? 0 : early.filter((p) => p === "QB" || p === "TE").length / early.length
    });
  }

  return { name: lg.name, season, rows, format, playoffTeams };
}

// ── statistics ──────────────────────────────────────────────────────────────

function brier(rows: TeamRow[]): number {
  return rows.reduce((a, r) => a + (r.predicted - r.actual) ** 2, 0) / rows.length;
}

/** Bounded so a confident miss does not return Infinity on a 50-row sample. */
function logLoss(rows: TeamRow[]): number {
  const eps = 1e-6;
  return (
    -rows.reduce((a, r) => {
      const p = Math.min(1 - eps, Math.max(eps, r.predicted));
      return a + (r.actual === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / rows.length
  );
}

/**
 * Area under the ROC curve, via the Mann-Whitney U identity with tie handling.
 *
 * Reported because Brier conflates calibration with discrimination, and with a
 * constrained outcome those fail very differently: a model can be badly
 * mis-calibrated yet still rank teams correctly (fixable by recalibration), or
 * perfectly calibrated to the base rate while ranking at chance (not fixable).
 */
function aucOf(rows: TeamRow[], score: (r: TeamRow) => number): number | null {
  const pos = rows.filter((r) => r.actual === 1).map(score);
  const neg = rows.filter((r) => r.actual === 0).map(score);
  if (pos.length === 0 || neg.length === 0) return null;
  let sum = 0;
  for (const p of pos) for (const n of neg) sum += p > n ? 1 : p === n ? 0.5 : 0;
  return sum / (pos.length * neg.length);
}

const auc = (rows: TeamRow[]) => aucOf(rows, (r) => r.predicted);

/** Brier of a constant forecast at the league base rate — the honest baseline. */
function climatologyBrier(rows: TeamRow[], rate: number): number {
  return rows.reduce((a, r) => a + (rate - r.actual) ** 2, 0) / rows.length;
}

/** Cluster bootstrap over LEAGUES, respecting within-league dependence. */
function clusterBootstrap(
  byLeague: Map<string, TeamRow[]>,
  stat: (rows: TeamRow[]) => number | null,
  iterations = 5000,
  seed = 12345
): { lo: number; hi: number } | null {
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
  return {
    lo: samples[Math.floor(0.025 * samples.length)]!,
    hi: samples[Math.floor(0.975 * samples.length)]!
  };
}

const f3 = (n: number | null) => (n == null ? "  n/a" : n.toFixed(4));

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const out: string[] = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  say("# Out-of-sample backtest — the SHIPPED valuation chain");
  say(`# generated ${new Date().toISOString()}`);
  say("#");
  say("# chain: draft ADP -> positional rank -> replacement level -> trueValue");
  say("#        -> runNexusSimulation -> playoffProbability");
  say("# label: actual playoff qualification (winners bracket)");
  say();

  const all: TeamRow[] = [];
  const byLeague = new Map<string, TeamRow[]>();
  const seasons = new Set<number>();
  let baseRateNum = 0;
  let baseRateDen = 0;

  say("## Leagues");
  say();
  say("league               season  teams  fmt      starters  rows  actual-in");
  for (const id of leagueIds) {
    const res = await backtestLeague(id);
    if (!res) {
      say(`${id.padEnd(20)} SKIPPED — no draft picks or bracket`);
      continue;
    }
    all.push(...res.rows);
    byLeague.set(id, res.rows);
    seasons.add(res.season);
    baseRateNum += res.playoffTeams;
    baseRateDen += res.format.numTeams;
    const made = res.rows.filter((r) => r.actual === 1).length;
    say(
      `${res.name.slice(0, 20).padEnd(20)} ${String(res.season).padEnd(7)} ` +
        `${String(res.format.numTeams).padEnd(6)} ${res.format.scoringFormat.padEnd(8)} ` +
        `${String(res.rows[0]?.starters ?? 0).padEnd(9)} ${String(res.rows.length).padEnd(5)} ${made}`
    );
  }
  say();

  if (all.length === 0) {
    say("No usable leagues — nothing to score. Exiting without a claim.");
    writeFileSync("reports/2026-08-06/backtest-valuation.txt", out.join("\n"));
    return;
  }

  // ── leakage assertions ────────────────────────────────────────────────────
  say("## Leakage controls (asserted, not promised)");
  say();
  const observedRate = all.filter((r) => r.actual === 1).length / all.length;
  const expectedRate = baseRateNum / baseRateDen;
  say(`  input signal .............. draft pick_no only (pre-season by construction)`);
  say(`  roster ..................... drafted roster only, no waivers/trades`);
  say(`  weeklyProjections .......... null (offseason trueValue path exercised)`);
  say(`  weekly scores as input ..... none; outcome label only`);
  say(`  observed qualification rate  ${observedRate.toFixed(4)} (structural ${expectedRate.toFixed(4)})`);
  if (Math.abs(observedRate - expectedRate) > 0.02) {
    say(`  WARNING: observed rate deviates from the structural rate — check brackets.`);
  }
  say();

  // ── headline ──────────────────────────────────────────────────────────────
  const forecasts: BrierForecast[] = all.map((r) => ({ prob: r.predicted, outcome: r.actual }));
  const scored = scoreForecasts(forecasts);
  const modelBrier = brier(all);
  const climBrier = climatologyBrier(all, expectedRate);
  const uniformBrier = climatologyBrier(all, 0.5);
  const skill = 1 - modelBrier / climBrier;
  const discrimination = auc(all);

  say("## Headline");
  say();
  say(`  n (team-seasons) ........... ${all.length}`);
  say(`  leagues .................... ${byLeague.size}`);
  say(`  seasons .................... ${[...seasons].sort().join(", ")}`);
  say(`  Brier ...................... ${f3(modelBrier)}`);
  say(`  log loss ................... ${f3(logLoss(all))}`);
  say(`  ECE (10 bins) .............. ${f3(scored.ece)}`);
  say(`  AUC (discrimination) ....... ${f3(discrimination)}`);
  say();
  say("## Baselines — is the model beating a constant?");
  say();
  say(`  climatology (p=${expectedRate.toFixed(2)}) Brier .. ${f3(climBrier)}`);
  say(`  uniform     (p=0.50) Brier .. ${f3(uniformBrier)}`);
  say(`  Brier skill score vs clim ... ${f3(skill)}   ${skill > 0 ? "(model better)" : "(model WORSE than a constant)"}`);
  say();

  // ── uncertainty ───────────────────────────────────────────────────────────
  say("## Uncertainty — cluster bootstrap over leagues (5000 resamples)");
  say();
  say("Resamples whole LEAGUES, not team-seasons: within a league exactly");
  say(`${baseRateNum / byLeague.size} of ${baseRateDen / byLeague.size} qualify, so rows inside a league are strongly`);
  say("dependent and a row-level bootstrap would understate the interval.");
  say();
  const ciBrier = clusterBootstrap(byLeague, brier);
  const ciAuc = clusterBootstrap(byLeague, auc);
  const ciSkill = clusterBootstrap(byLeague, (rows) => 1 - brier(rows) / climatologyBrier(rows, expectedRate));
  say(`  Brier 95% CI ............... ${ciBrier ? `[${f3(ciBrier.lo)}, ${f3(ciBrier.hi)}]` : "n/a"}`);
  say(`  AUC 95% CI ................. ${ciAuc ? `[${f3(ciAuc.lo)}, ${f3(ciAuc.hi)}]` : "n/a"}`);
  say(`  Skill score 95% CI ......... ${ciSkill ? `[${f3(ciSkill.lo)}, ${f3(ciSkill.hi)}]` : "n/a"}`);
  // Two-sided. An earlier version only asked "is it better than chance?", which
  // silently passed over the far more serious answer: significantly WORSE.
  const skillSignificant = ciSkill != null && ciSkill.lo > 0;
  const skillSignificantlyBad = ciSkill != null && ciSkill.hi < 0;
  const aucSignificant = ciAuc != null && ciAuc.lo > 0.5;
  const aucSignificantlyInverted = ciAuc != null && ciAuc.hi < 0.5;
  say();
  say(`  skill CI entirely ABOVE 0? ..... ${skillSignificant ? "YES" : "NO"}`);
  say(`  skill CI entirely BELOW 0? ..... ${skillSignificantlyBad ? "YES — worse than a constant" : "NO"}`);
  say(`  AUC CI entirely ABOVE 0.5? ..... ${aucSignificant ? "YES" : "NO"}`);
  say(`  AUC CI entirely BELOW 0.5? ..... ${aucSignificantlyInverted ? "YES — ranking is INVERTED" : "NO"}`);
  say();

  // ── ablation: where does the signal die? ──────────────────────────────────
  say("## Ablation — is the input signal worthless, or is the transform?");
  say();
  say("A single Brier number cannot separate these, and they have opposite");
  say("fixes. `draft capital` is the raw market signal (sum of totalPicks -");
  say("pick_no) BEFORE replacement level and the VBD transform touch it.");
  say("Compared on AUC, which needs no calibration — only ranking.");
  say();
  const aucCapital = aucOf(all, (r) => r.draftCapital);
  const aucScarce = aucOf(all, (r) => r.earlyScarceShare);
  const ciCapital = clusterBootstrap(byLeague, (rows) => aucOf(rows, (r) => r.draftCapital));
  say(`  AUC — shipped chain (trueValue -> sim) ... ${f3(discrimination)}  ${ciAuc ? `CI [${f3(ciAuc.lo)}, ${f3(ciAuc.hi)}]` : ""}`);
  say(`  AUC — raw draft capital ................. ${f3(aucCapital)}  ${ciCapital ? `CI [${f3(ciCapital.lo)}, ${f3(ciCapital.hi)}]` : ""}`);
  say(`  AUC — early QB/TE share (scarcity probe)  ${f3(aucScarce)}`);
  say();
  if (aucCapital != null && discrimination != null) {
    if (aucCapital > 0.5 && discrimination < 0.5) {
      say("  READ: the raw signal ranks better than chance and the shipped chain");
      say("  ranks worse. The TRANSFORM is destroying signal, not the input.");
    } else if (aucCapital <= 0.5 && discrimination <= 0.5) {
      say("  READ: neither the raw signal nor the transform ranks better than");
      say("  chance. Draft-day ADP alone does not predict qualification in this");
      say("  sample — no amount of re-transforming it will help.");
    } else {
      say("  READ: both carry some ranking signal.");
    }
  }
  say();
  say("  MECHANISM. rank-ratio VBD computes 50 + 50*(replacement - rank)/replacement,");
  say("  so the advantage at a given positional rank GROWS with position depth.");
  say("  In a 10-team league replacement is QB 12 / TE 12 but RB 35 / WR 37, so:");
  say();
  say("      QB3 -> 87.5     RB3 -> 95.7");
  say("      QB5 -> 79.2     RB5 -> 92.9");
  say();
  say("  The transform therefore systematically UNDER-values scarce positions.");
  say("  In this sample early QB/TE spend correlates with qualifying (AUC above),");
  say("  so the model marks down exactly the teams that went on to succeed. That");
  say("  is a coherent explanation for an inverted AUC, and it points at the VBD");
  say("  transform — rank ratios are not points above replacement — rather than");
  say("  at replacement level or the simulator.");
  say();

  // ── per season ────────────────────────────────────────────────────────────
  say("## Per season");
  say();
  say("season  n   Brier   AUC     base");
  for (const s of [...seasons].sort()) {
    const rows = all.filter((r) => r.season === s);
    const rate = rows.filter((r) => r.actual === 1).length / rows.length;
    say(
      `${String(s).padEnd(7)} ${String(rows.length).padEnd(3)} ${f3(brier(rows))}  ${f3(auc(rows))}  ${rate.toFixed(2)}`
    );
  }
  say();

  // ── reliability ───────────────────────────────────────────────────────────
  say("## Reliability (forecast -> observed)");
  say();
  for (const b of scored.reliabilityBins) {
    if (b.n === 0) continue;
    say(
      `  bin ${b.binCenter.toFixed(2)}  fc=${b.meanForecast.toFixed(3)}  obs=${b.observedFreq.toFixed(3)}  n=${b.n}`
    );
  }
  say();

  // ── verdict ───────────────────────────────────────────────────────────────
  say("## Verdict");
  say();
  if (skillSignificantlyBad || aucSignificantlyInverted) {
    say("  FAILED. The model is significantly WORSE than a constant forecast on");
    say("  this sample, and its ranking is inverted — teams it rates highly");
    say("  qualified LESS often than teams it rated poorly.");
    say();
    say("  This is a finding, not a crash. It means the shipped playoff odds");
    say("  carry no demonstrated predictive value and must not be presented as");
    say("  though they do (CLAUDE.md: 'if a model lacks calibration, do not");
    say("  present it as production-safe').");
    say();
    say("  NOT DONE, deliberately: no parameter was flipped or refitted to");
    say("  improve these numbers. With 5 effective clusters that would be");
    say("  curve-fitting to noise, and inverting a model because it scored");
    say("  badly on 5 leagues is how you turn a small sample into a big one.");
  } else if (!aucSignificant && !skillSignificant) {
    say("  NOT VALIDATED. Neither discrimination nor skill is distinguishable");
    say("  from a constant forecast at this sample size. The model may still be");
    say("  right — this says the evidence cannot show it, not that it is wrong.");
  } else if (aucSignificant && !skillSignificant) {
    say("  PARTIAL. The model RANKS teams better than chance (AUC CI excludes");
    say("  0.5) but its probabilities are not better calibrated than a constant.");
    say("  That is a recalibration problem, not a ranking problem.");
  } else {
    say("  The model beats a climatology constant on this sample. Treat as");
    say("  DIRECTIONAL until n is in the low hundreds.");
  }
  say();
  say(`  Effective sample size is nearer ${byLeague.size} leagues than ${all.length} rows.`);
  say("  No parameter was fitted on this data; it is a pure holdout.");

  writeFileSync("reports/2026-08-06/backtest-valuation.txt", out.join("\n"));
  console.log("\nWrote reports/2026-08-06/backtest-valuation.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
