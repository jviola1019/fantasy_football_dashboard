// REAL season-sim backtest against completed public Sleeper leagues.
//
// For each league: take every team's REAL weekly scores, build the same
// TeamStrength/FieldModel the dashboard uses, run the season Monte Carlo to get
// each team's predicted playoff probability, and score those predictions against
// who ACTUALLY made the playoffs (the winners bracket). Reuses the exact
// production sim (src/lib/seasonSim.ts) and Brier/reliability machinery.
//
// HONESTY: this is low-power, and the previous version of this comment
// understated how low. It called a 10-team league "~10 independent outcomes".
// They are not independent: exactly `playoff_teams` of `num_teams` rosters
// qualify, by construction. Knowing nine outcomes in a 10-team league determines
// the tenth, so a league contributes ONE independent observation, not ten.
//
// That is the same clustering error every frozen holdout protocol in this repo
// was written to avoid — committed here, in the script those protocols were
// meant to discipline. Audit 2026-08-26.
//
// The strength estimate also uses the same season's scores that drove the real
// standings, so this is a calibration/consistency check on real data, NOT
// out-of-sample forecasting.
//
// Consequently this script reports (a) the CLIMATOLOGY baseline the model must
// beat before a Brier score means anything at all, and (b) a cluster bootstrap
// over LEAGUES. With a single league that bootstrap is degenerate, and it says
// so rather than printing an interval it cannot support.
//
// Default league: "Creamy Les Coot 4.0" (1265735061127311360) — a real completed
// 2025 league (10 teams, 150-pick draft). Override with RAE_BACKTEST_LEAGUES
// (comma-separated public Sleeper league ids). Public data, no credentials.
import { writeFileSync } from "node:fs";
import { runSeasonSimulation } from "../src/lib/seasonSim";
import { buildLeagueModels, scoreForecasts } from "../src/lib/stats/seasonCalibration";
import type { BrierForecast } from "../src/lib/stats/distribution";
import { clusterBootstrap } from "../src/lib/stats/multipleComparisons";
import { mulberry32 } from "../src/lib/rng";

const DEFAULT_LEAGUES = ["1265735061127311360"];
const leagueIds = (process.env.RAE_BACKTEST_LEAGUES ?? DEFAULT_LEAGUES.join(","))
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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const body: unknown = await res.json().catch(() => null);
  if (!isJsonPayload(body)) throw new Error(`${path} → response was not a JSON object/array`);
  return body as T;
}

interface League { name: string; settings: { playoff_week_start: number; playoff_teams: number; num_teams: number }; draft_id?: string }
interface Roster { roster_id: number; settings?: { wins?: number; losses?: number } }
interface Matchup { roster_id: number; points: number | null }
type BracketNode = { t1?: number | { w?: number; l?: number }; t2?: number | { w?: number; l?: number } };

function playoffRosterIds(bracket: BracketNode[]): Set<number> {
  const ids = new Set<number>();
  for (const node of bracket) {
    for (const t of [node.t1, node.t2]) if (typeof t === "number") ids.add(t);
  }
  return ids;
}

interface LeagueBacktest {
  name: string;
  forecasts: BrierForecast[];
  rows: string[];
  /** playoffTeams / numTeams — the structural rate a forecast has to beat. */
  baseRate: number;
  numTeams: number;
  playoffTeams: number;
}

async function backtestLeague(id: string): Promise<LeagueBacktest> {
  const lg = await getJson<League>(`/league/${id}`);
  const regWeeks = Math.max(1, (lg.settings.playoff_week_start ?? 15) - 1);
  const playoffTeams = lg.settings.playoff_teams ?? 6;
  const numTeams = lg.settings.num_teams ?? 10;
  const rosters = await getJson<Roster[]>(`/league/${id}/rosters`);
  const bracket = await getJson<BracketNode[]>(`/league/${id}/winners_bracket`);
  const playoffSet = playoffRosterIds(bracket);

  // Real weekly scores per roster.
  const weekly = new Map<number, number[]>();
  for (const r of rosters) weekly.set(r.roster_id, []);
  for (let w = 1; w <= regWeeks; w++) {
    const ms = await getJson<Matchup[]>(`/league/${id}/matchups/${w}`);
    for (const m of ms) {
      if (typeof m.points === "number" && m.points > 0) weekly.get(m.roster_id)?.push(m.points);
    }
  }

  const orderedRosters = rosters.map((r) => r.roster_id);
  const weeklyByTeam = orderedRosters.map((rid) => weekly.get(rid) ?? []);
  const { field, teams } = buildLeagueModels(weeklyByTeam);

  const forecasts: BrierForecast[] = [];
  const rows: string[] = [];
  orderedRosters.forEach((rid, i) => {
    const sim = runSeasonSimulation(teams[i]!, field, {
      seed: 20260610 + i,
      iterations: 20000,
      numTeams,
      regularSeasonWeeks: regWeeks,
      playoffTeams,
    });
    const made = playoffSet.has(rid) ? 1 : 0;
    forecasts.push({ prob: sim.playoffProbability, outcome: made as 0 | 1 });
    const wins = rosters.find((r) => r.roster_id === rid)?.settings?.wins ?? "?";
    rows.push(
      `roster ${String(rid).padStart(2)} | ${teams[i]!.meanWeekly.toFixed(1)} ppg | predicted P(playoff)=${(sim.playoffProbability * 100).toFixed(1)}% | wins=${wins} | actual=${made ? "PLAYOFFS" : "missed"}`
    );
  });
  return { name: lg.name, forecasts, rows, baseRate: playoffTeams / numTeams, numTeams, playoffTeams };
}

interface Scored {
  league: string;
  prob: number;
  outcome: 0 | 1;
  /** The climatology forecast for this row: its own league's structural base rate. */
  baseRate: number;
}

/** Mean squared error of a probability forecast against a 0/1 outcome. */
function brierOf(rows: readonly Scored[], forecast: (r: Scored) => number): number {
  if (rows.length === 0) return Number.NaN;
  return rows.reduce((sum, r) => sum + (forecast(r) - r.outcome) ** 2, 0) / rows.length;
}

async function main(): Promise<void> {
  console.log(`Real Sleeper backtest — leagues: ${leagueIds.join(", ")}`);
  const all: BrierForecast[] = [];
  const scored: Scored[] = [];
  const sections: string[] = [];
  for (const id of leagueIds) {
    const { name, forecasts, rows, baseRate, numTeams, playoffTeams } = await backtestLeague(id);
    console.log(`=== ${name} (${id}) ===`);
    rows.forEach((r) => console.log("  " + r));
    const s = scoreForecasts(forecasts);
    console.log(`  → ${forecasts.length} teams · Brier ${s.brier.toFixed(4)} · ECE ${s.ece.toFixed(4)}`);
    all.push(...forecasts);
    for (const f of forecasts) scored.push({ league: id, prob: f.prob, outcome: f.outcome, baseRate });
    sections.push(
      `### ${name} (\`${id}\`)\n\n${rows.map((r) => "- " + r).join("\n")}\n\n` +
        `Brier **${s.brier.toFixed(4)}**, ECE **${s.ece.toFixed(4)}**, n=${forecasts.length} ` +
        `(${playoffTeams} of ${numTeams} qualify → base rate ${baseRate.toFixed(3)}).\n`
    );
  }
  const agg = scoreForecasts(all);

  // The comparison that decides whether the Brier means anything. A constant
  // forecast at each league's own structural base rate uses no model at all.
  const brierModel = brierOf(scored, (r) => r.prob);
  const brierClim = brierOf(scored, (r) => r.baseRate);
  const bss = 1 - brierModel / brierClim;

  // Resample LEAGUES, not team-seasons. Within a league the outcomes are
  // deterministic complements of one another, so the row count overstates the
  // evidence by roughly a factor of numTeams.
  const leagueOf = scored.map((r) => r.league);
  const distinctLeagues = new Set(leagueOf).size;
  const degenerate = distinctLeagues < 2;
  const delta = clusterBootstrap(
    leagueOf,
    (idx) => {
      const rows = idx.map((i) => scored[i]!);
      return brierOf(rows, (r) => r.baseRate) - brierOf(rows, (r) => r.prob);
    },
    { resamples: 2000, rand: mulberry32(20260826) }
  );

  console.log(
    `POOLED (${all.length} team-seasons, ${distinctLeagues} league(s)): Brier ${agg.brier.toFixed(4)} · ECE ${agg.ece.toFixed(4)}`
  );
  console.log(`Climatology Brier ${brierClim.toFixed(4)} · Brier skill ${(bss * 100).toFixed(1)}%`);
  console.log(
    degenerate
      ? "Cluster bootstrap: DEGENERATE — 1 league is 1 cluster, so no interval exists."
      : `ΔBrier (clim − model) ${delta.point.toFixed(4)} · 95% CI [${delta.lower.toFixed(4)}, ${delta.upper.toFixed(4)}] · p=${delta.p.toFixed(4)}`
  );
  console.log("Reliability (forecast → observed):");
  for (const b of agg.reliabilityBins) {
    console.log(`  bin ${b.binCenter.toFixed(2)} fc=${b.meanForecast.toFixed(3)} obs=${b.observedFreq.toFixed(3)} n=${b.n}`);
  }

  const significance = degenerate
    ? [
        "**No significance can be claimed.** One league is one independent cluster, and a",
        "cluster bootstrap over a single cluster resamples the identical data every time —",
        "it returns a zero-width interval, which is an absence of evidence rather than a",
        "precise one. The skill figure above is a point estimate with no error bar around it.",
        "",
        "To make this test say anything, pass more completed leagues:",
        "`RAE_BACKTEST_LEAGUES=id1,id2,... npm run backtest:sleeper`."
      ].join("\n")
    : [
        `Cluster bootstrap over ${distinctLeagues} leagues, 2,000 resamples:`,
        `ΔBrier (climatology − model) = **${delta.point.toFixed(4)}**, 95% CI`,
        `[${delta.lower.toFixed(4)}, ${delta.upper.toFixed(4)}], p = ${delta.p.toFixed(4)}.`,
        "",
        delta.lower > 0
          ? "The interval excludes zero: the model beats climatology on this sample."
          : "The interval spans zero: the model is not distinguishable from climatology here."
      ].join("\n");

  const doc = `# Real Season-Sim Backtest — Completed Sleeper Leagues

_Generated by \`scripts/backtest-sleeper-2025.ts\` from PUBLIC Sleeper data (no credentials)._

**Method:** each team's real weekly scores → \`TeamStrength\`/\`FieldModel\` (the same
the dashboard uses) → season Monte Carlo → predicted P(playoff), scored against the
team's actual playoff qualification (winners bracket).

## How much evidence this is

**${all.length} team-seasons, but ${distinctLeagues} independent observation${distinctLeagues === 1 ? "" : "s"}.**

Exactly \`playoff_teams\` of \`num_teams\` rosters qualify in every league, so the
outcomes inside one league are deterministic complements — knowing nine of ten
determines the tenth. The unit of independence is the LEAGUE, not the team-season.
An earlier version of this report called these "~10 independent outcomes per
league", which overstated the evidence by roughly a factor of ten.

Team strength is also estimated from the same season that produced the standings,
so this is a calibration/consistency check on real data, **not** out-of-sample
forecasting.

## Pooled result

| quantity | value |
|---|---|
| Model Brier | **${brierModel.toFixed(4)}** |
| Climatology Brier (constant forecast at each league's base rate) | ${brierClim.toFixed(4)} |
| Brier Skill Score vs climatology | **${(bss * 100).toFixed(1)}%** |
| ECE | ${agg.ece.toFixed(4)} |
| Team-seasons | ${all.length} |
| Independent clusters (leagues) | ${distinctLeagues} |

${significance}

Reliability (forecast → observed):

${agg.reliabilityBins.map((b) => `- bin ${b.binCenter.toFixed(2)}: forecast ${b.meanForecast.toFixed(3)}, observed ${b.observedFreq.toFixed(3)} (n=${b.n})`).join("\n")}

## Per league

${sections.join("\n")}
`;
  writeFileSync("docs/season-backtest-2025.md", doc);
  console.log("Wrote docs/season-backtest-2025.md");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
