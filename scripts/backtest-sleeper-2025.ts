// REAL season-sim backtest against completed public Sleeper leagues.
//
// For each league: take every team's REAL weekly scores, build the same
// TeamStrength/FieldModel the dashboard uses, run the season Monte Carlo to get
// each team's predicted playoff probability, and score those predictions against
// who ACTUALLY made the playoffs (the winners bracket). Reuses the exact
// production sim (src/lib/seasonSim.ts) and Brier/reliability machinery.
//
// HONESTY: this is low-power — a 10-team league is ~10 independent outcomes, and
// the strength estimate uses the same season's scores that also drove the real
// standings, so it is a calibration/consistency check on real data, NOT
// out-of-sample forecasting. Results are reported with that caveat.
//
// Default league: "Creamy Les Coot 4.0" (1265735061127311360) — a real completed
// 2025 league (10 teams, 150-pick draft). Override with RAE_BACKTEST_LEAGUES
// (comma-separated public Sleeper league ids). Public data, no credentials.
import { writeFileSync } from "node:fs";
import { runSeasonSimulation } from "../src/lib/seasonSim";
import { buildLeagueModels, scoreForecasts } from "../src/lib/stats/seasonCalibration";
import type { BrierForecast } from "../src/lib/stats/distribution";

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

async function backtestLeague(id: string): Promise<{ name: string; forecasts: BrierForecast[]; rows: string[] }> {
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
  return { name: lg.name, forecasts, rows };
}

async function main(): Promise<void> {
  console.log(`Real Sleeper backtest — leagues: ${leagueIds.join(", ")}\n`);
  const all: BrierForecast[] = [];
  const sections: string[] = [];
  for (const id of leagueIds) {
    const { name, forecasts, rows } = await backtestLeague(id);
    console.log(`=== ${name} (${id}) ===`);
    rows.forEach((r) => console.log("  " + r));
    const s = scoreForecasts(forecasts);
    console.log(`  → ${forecasts.length} teams · Brier ${s.brier.toFixed(4)} · ECE ${s.ece.toFixed(4)}\n`);
    all.push(...forecasts);
    sections.push(`### ${name} (\`${id}\`)\n\n${rows.map((r) => "- " + r).join("\n")}\n\nBrier **${s.brier.toFixed(4)}**, ECE **${s.ece.toFixed(4)}**, n=${forecasts.length}.\n`);
  }
  const agg = scoreForecasts(all);
  console.log(`POOLED (${all.length} team-seasons): Brier ${agg.brier.toFixed(4)} · ECE ${agg.ece.toFixed(4)}`);
  console.log("Reliability (forecast → observed):");
  for (const b of agg.reliabilityBins) {
    console.log(`  bin ${b.binCenter.toFixed(2)} fc=${b.meanForecast.toFixed(3)} obs=${b.observedFreq.toFixed(3)} n=${b.n}`);
  }

  const doc = `# Real Season-Sim Backtest — Completed Sleeper Leagues

_Generated by \`scripts/backtest-sleeper-2025.ts\` from PUBLIC Sleeper data (no credentials)._

**Method:** each team's real weekly scores → \`TeamStrength\`/\`FieldModel\` (the same
the dashboard uses) → season Monte Carlo → predicted P(playoff), scored against the
team's actual playoff qualification (winners bracket).

**Low power / caveat:** ~10 independent outcomes per league, and team strength is
estimated from the same season that produced the standings — a calibration/consistency
check on real data, **not** out-of-sample forecasting.

## Pooled result (${all.length} team-seasons)

Brier **${agg.brier.toFixed(4)}**, ECE **${agg.ece.toFixed(4)}** (playoff target ≤ 0.20).

Reliability (forecast → observed):

${agg.reliabilityBins.map((b) => `- bin ${b.binCenter.toFixed(2)}: forecast ${b.meanForecast.toFixed(3)}, observed ${b.observedFreq.toFixed(3)} (n=${b.n})`).join("\n")}

## Per league

${sections.join("\n")}
`;
  writeFileSync("docs/season-backtest-2025.md", doc);
  console.log("\nWrote docs/season-backtest-2025.md");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
