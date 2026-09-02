/**
 * Which first-half variables predict second-half fantasy scoring, and which only
 * look like they do?
 *
 * This is protocol 4's question asked of EVERY variable nflverse publishes,
 * rather than of the one the product happened to ship. It runs offline from the
 * committed bundle `reports/2026-08-20/nflverse-usage.json.gz` — eight seasons
 * (2017–2024) of real weekly player stats and snap counts. No synthetic rows.
 *
 * THE QUESTION, PRECISELY
 *
 * For each player-season: take weeks 1–9 as the observation window and weeks
 * 10–17 as the outcome. Does variable X, measured in the first half, predict
 * second-half PPR points per game BEYOND what first-half points per game already
 * predicts?
 *
 * The "beyond" is the whole point. Targets correlate with next-half scoring at
 * r ≈ 0.6, and almost all of that is "good players get targets and also score".
 * A correlation reported without the control is a statement about who is good,
 * not about what to do differently, and shipping a variable on that basis adds
 * a column that repeats what the first column already said.
 *
 * FIVE GATES, IN ORDER
 *
 *  1. PARTIAL SPEARMAN controlling for first-half PPG, per position.
 *  2. HOLM–BONFERRONI across the whole family — variables x positions. Quoting
 *     the smallest of forty p-values as "p < 0.05" is the error that ships noise.
 *  3. ANOVA ACROSS QUARTILES of the variable, with CONNECTING LETTERS, so the
 *     shape of the effect is visible: a variable can be "significant" while its
 *     top and bottom quartiles are statistically indistinguishable.
 *  4. A RANDOM FOREST with out-of-bag scoring and permutation importance, which
 *     can see interactions and non-monotone effects that every linear tool in
 *     this repository is blind to by construction.
 *  5. LEAVE-ONE-SEASON-OUT. A variable that helps within a season and not across
 *     them has not been validated; it has been fitted.
 *
 *   npm run validate:variables
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { spearman, partialSpearman, spearmanPValue } from "../src/lib/stats/correlation";
import { oneWayAnova, connectingLetters, quantile } from "../src/lib/stats/distribution";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { randomForestRegress } from "../src/lib/stats/randomForest";
import { parseCsvRows } from "../src/lib/stats/csv";

const BUNDLE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "docs/variable-validation.md";
const SEASONS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
/** Weeks 1–9 observed, 10–17 scored. Week 18 excluded: resting starters. */
const OBS_END = 9;
const OUT_START = 10;
const OUT_END = 17;
const MIN_OBS_GAMES = 6;
const MIN_OUT_GAMES = 4;
const ALPHA = 0.05;
const SEED = 20260902;

type Row = Record<string, string>;

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Every candidate, as a per-game rate from the observation window. */
const FEATURES: { key: string; label: string; from: (rows: Row[], games: number) => number }[] = [
  { key: "ppg", label: "points per game (the control)", from: (r, g) => sum(r, "fantasy_points_ppr") / g },
  { key: "targets", label: "targets per game", from: (r, g) => sum(r, "targets") / g },
  { key: "carries", label: "carries per game", from: (r, g) => sum(r, "carries") / g },
  { key: "touches", label: "touches per game (carries + receptions)", from: (r, g) => (sum(r, "carries") + sum(r, "receptions")) / g },
  { key: "receptions", label: "receptions per game", from: (r, g) => sum(r, "receptions") / g },
  { key: "recYards", label: "receiving yards per game", from: (r, g) => sum(r, "receiving_yards") / g },
  { key: "rushYards", label: "rushing yards per game", from: (r, g) => sum(r, "rushing_yards") / g },
  { key: "airYards", label: "receiving air yards per game", from: (r, g) => sum(r, "receiving_air_yards") / g },
  { key: "targetShare", label: "target share (mean)", from: (r) => avg(r, "target_share") },
  { key: "airYardsShare", label: "air-yards share (mean)", from: (r) => avg(r, "air_yards_share") },
  { key: "wopr", label: "WOPR (mean)", from: (r) => avg(r, "wopr") },
  { key: "racr", label: "RACR (mean)", from: (r) => avg(r, "racr") },
  { key: "recEpa", label: "receiving EPA per game", from: (r, g) => sum(r, "receiving_epa") / g },
  { key: "rushEpa", label: "rushing EPA per game", from: (r, g) => sum(r, "rushing_epa") / g },
  { key: "firstDowns", label: "first downs per game", from: (r, g) => (sum(r, "receiving_first_downs") + sum(r, "rushing_first_downs")) / g },
  { key: "tds", label: "touchdowns per game", from: (r, g) => (sum(r, "receiving_tds") + sum(r, "rushing_tds")) / g },
  { key: "gamesPlayed", label: "games played in the window", from: (_r, g) => g },
  { key: "ppgVariance", label: "week-to-week variance of points", from: (r) => variance(r.map((x) => num(x.fantasy_points_ppr))) }
];

function sum(rows: Row[], col: string): number {
  let s = 0;
  for (const r of rows) s += num(r[col]);
  return s;
}
function avg(rows: Row[], col: string): number {
  if (rows.length === 0) return 0;
  return sum(rows, col) / rows.length;
}
function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

interface PlayerSeason {
  season: number;
  playerId: string;
  position: string;
  features: Record<string, number>;
  outcome: number; // second-half PPR points per game
}

function build(): PlayerSeason[] {
  const bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8")) as Record<string, string>;
  const out: PlayerSeason[] = [];
  for (const season of SEASONS) {
    const raw = bundle[`player_stats_${season}`];
    if (!raw) continue;
    const parsed = parseCsvRows(raw);
    // A misaligned row is not partially usable data, and a parser that loses
    // most of its input looks exactly like one reading a clean file. The first
    // version of this script split on commas, lost every row whose player name
    // contains one to a one-column shift, built ZERO player-seasons out of eight
    // seasons of real data — and still wrote a report concluding that no
    // variable was significant.
    if (parsed.malformed > 0) {
      throw new Error(
        `player_stats_${season}: ${parsed.malformed} rows disagree with the header. ` +
          `Refusing to analyse a partially-read file.`
      );
    }
    const rows = parsed.rows.filter((r) => r.season_type === "REG");
    const byPlayer = new Map<string, Row[]>();
    for (const r of rows) {
      const id = r.player_id ?? "";
      if (!id) continue;
      const list = byPlayer.get(id);
      if (list) list.push(r);
      else byPlayer.set(id, [r]);
    }
    for (const [id, all] of byPlayer) {
      const pos = all[0]!.position ?? "";
      if (!["RB", "WR", "TE", "QB"].includes(pos)) continue;
      const obs = all.filter((r) => num(r.week) >= 1 && num(r.week) <= OBS_END);
      const post = all.filter((r) => num(r.week) >= OUT_START && num(r.week) <= OUT_END);
      if (obs.length < MIN_OBS_GAMES || post.length < MIN_OUT_GAMES) continue;
      const features: Record<string, number> = {};
      for (const f of FEATURES) features[f.key] = f.from(obs, obs.length);
      out.push({
        season,
        playerId: id,
        position: pos,
        features,
        outcome: sum(post, "fantasy_points_ppr") / post.length
      });
    }
  }
  return out;
}

interface VarResult {
  position: string;
  key: string;
  label: string;
  n: number;
  raw: number;
  partial: number;
  p: number;
  holmThreshold: number;
  significant: boolean;
  letters: string[];
  quartileMeans: number[];
  anovaP: number;
  loso: number; // leave-one-season-out partial Spearman, averaged
}

function main(): void {
  const data = build();
  console.log(`player-seasons: ${data.length} across ${SEASONS.length} seasons`);
  // REFUSE TO PUBLISH A CONCLUSION DRAWN FROM NOTHING.
  // "No variable is significant" and "the loader returned no rows" produce
  // identical reports, and the first run of this script wrote the former from
  // the latter — a clean-looking negative result over zero observations.
  if (data.length < 500) {
    console.error(
      `\nOnly ${data.length} player-seasons were built. Eight seasons of nflverse data ` +
        `should yield well over a thousand, so this is a loader fault, not a finding. ` +
        `Not writing a report.`
    );
    process.exit(1);
  }
  const positions = ["RB", "WR", "TE", "QB"];
  const results: VarResult[] = [];

  for (const pos of positions) {
    const rows = data.filter((d) => d.position === pos);
    if (rows.length < 60) {
      console.log(`${pos}: only ${rows.length} player-seasons — skipped`);
      continue;
    }
    const y = rows.map((r) => r.outcome);
    const control = rows.map((r) => r.features.ppg!);

    for (const f of FEATURES) {
      if (f.key === "ppg") continue; // it IS the control
      const x = rows.map((r) => r.features[f.key]!);
      // A column that never varies has nothing to test, and reporting it as
      // "not significant" would be a false negative dressed as evidence.
      if (new Set(x).size < 4) continue;

      const partial = partialSpearman(x, y, control);
      const raw = spearman(x, y);

      // Quartiles of the variable, with the outcome in each. Connecting letters
      // show WHICH quartiles actually differ — a variable can clear a p-value
      // while its extremes are indistinguishable.
      const cuts = [0.25, 0.5, 0.75].map((q) => quantile(x, q));
      const groups: number[][] = [[], [], [], []];
      rows.forEach((r, i) => {
        const v = x[i]!;
        const g = v <= cuts[0]! ? 0 : v <= cuts[1]! ? 1 : v <= cuts[2]! ? 2 : 3;
        groups[g]!.push(y[i]!);
      });
      const usable = groups.filter((g) => g.length >= 5);
      const anova = usable.length >= 2 ? oneWayAnova(usable) : null;

      // Leave one season out: the partial computed on each held-out season,
      // averaged. A variable that only works in-sample shows up here.
      const losoVals: number[] = [];
      for (const s of SEASONS) {
        const held = rows.filter((r) => r.season === s);
        if (held.length < 30) continue;
        losoVals.push(
          partialSpearman(
            held.map((r) => r.features[f.key]!),
            held.map((r) => r.outcome),
            held.map((r) => r.features.ppg!)
          )
        );
      }

      results.push({
        position: pos,
        key: f.key,
        label: f.label,
        n: rows.length,
        raw,
        partial,
        p: spearmanPValue(partial, rows.length),
        holmThreshold: Number.NaN,
        significant: false,
        letters: usable.length >= 2 ? connectingLetters(usable, ALPHA) : [],
        quartileMeans: groups.map((g) => (g.length ? g.reduce((a, b) => a + b, 0) / g.length : Number.NaN)),
        anovaP: anova ? anova.pValue : Number.NaN,
        loso: losoVals.length ? losoVals.reduce((a, b) => a + b, 0) / losoVals.length : Number.NaN
      });
    }
  }

  const holm = holmBonferroni(results.map((r) => ({ id: `${r.position}:${r.key}`, p: r.p })), ALPHA);
  for (const h of holm) {
    const t = results.find((r) => `${r.position}:${r.key}` === h.id)!;
    t.holmThreshold = h.threshold;
    t.significant = h.reject;
  }

  // ── The forest, per position ────────────────────────────────────────────────
  const forests: Record<string, { oobR2: number; baselineR2: number; n: number; importance: [string, number][] }> = {};
  const featureKeys = FEATURES.filter((f) => f.key !== "ppg").map((f) => f.key);
  for (const pos of positions) {
    const rows = data.filter((d) => d.position === pos);
    if (rows.length < 100) continue;
    const y = rows.map((r) => r.outcome);
    const baseline = randomForestRegress(rows.map((r) => [r.features.ppg!]), y, { nTrees: 200, seed: SEED });
    const full = randomForestRegress(
      rows.map((r) => [r.features.ppg!, ...featureKeys.map((k) => r.features[k]!)]),
      y,
      { nTrees: 200, seed: SEED }
    );
    forests[pos] = {
      oobR2: full.oobR2,
      baselineR2: baseline.oobR2,
      n: rows.length,
      importance: ["ppg", ...featureKeys]
        .map((k, i) => [k, full.importance[i]!] as [string, number])
        .sort((a, b) => b[1] - a[1])
    };
    console.log(
      `${pos}: forest OOB R2 ${full.oobR2.toFixed(4)} vs points-only baseline ${baseline.oobR2.toFixed(4)} ` +
        `(n=${rows.length})`
    );
  }

  const survivors = results.filter((r) => r.significant && Math.sign(r.loso) === Math.sign(r.partial) && Math.abs(r.loso) > 0.02);
  console.log(`\ntests: ${results.length}  significant after Holm: ${results.filter((r) => r.significant).length}`);
  console.log(`significant AND replicating leave-one-season-out: ${survivors.length}`);
  for (const s of survivors) {
    console.log(`  ${s.position} ${s.label}: partial ${s.partial.toFixed(4)}, LOSO ${s.loso.toFixed(4)}, letters ${s.letters.join("")}`);
  }

  writeFileSync(OUT, report(data, results, survivors, forests), "utf8");
  console.log(`\nwrote ${OUT}`);
}

function report(
  data: PlayerSeason[],
  results: VarResult[],
  survivors: VarResult[],
  forests: Record<string, { oobR2: number; baselineR2: number; n: number; importance: [string, number][] }>
): string {
  const L: string[] = [];
  const f4 = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : "—");
  const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

  L.push("# Variable validation — which first-half signals actually predict the second half");
  L.push("");
  L.push("Generated by `npm run validate:variables` (`scripts/validate-variables.ts`), offline from");
  L.push("the committed bundle `reports/2026-08-20/nflverse-usage.json.gz`: eight seasons");
  L.push("(2017–2024) of real weekly nflverse player stats. **No synthetic rows.**");
  L.push("");
  L.push(`**${data.length} player-seasons** — weeks 1–9 observed, weeks 10–17 scored,`);
  L.push(`minimum ${MIN_OBS_GAMES} games observed and ${MIN_OUT_GAMES} scored. Week 18 is excluded`);
  L.push("because starters rest.");
  L.push("");
  L.push("| position | player-seasons |");
  L.push("|---|---|");
  for (const pos of ["RB", "WR", "TE", "QB"]) {
    L.push(`| ${pos} | ${data.filter((d) => d.position === pos).length} |`);
  }
  L.push("");
  L.push("## The question, and why it is not \"does X correlate with scoring\"");
  L.push("");
  L.push("Targets correlate with next-half scoring strongly, and almost all of that is *good");
  L.push("players get targets and also score*. A correlation reported without controlling for");
  L.push("points-to-date is a statement about who is good, not about what to do differently —");
  L.push("and a variable shipped on that basis adds a column repeating what the first column");
  L.push("already said. Every headline figure below is a **partial** Spearman, controlling for");
  L.push("first-half points per game.");
  L.push("");
  L.push("## Result");
  L.push("");
  if (survivors.length === 0) {
    L.push("**No variable clears every gate.** Nothing here licenses a new column in the");
    L.push("product. That is the finding, and it is consistent with protocols 1–3, which");
    L.push("retired the draft-time models for the same reason.");
  } else {
    L.push(`**${survivors.length} of ${results.length} variable×position tests clear every gate:**`);
    L.push("");
    L.push("| position | variable | partial ρ | Holm α | leave-one-season-out | quartile letters |");
    L.push("|---|---|---|---|---|---|");
    for (const s of survivors) {
      L.push(
        `| ${s.position} | ${s.label} | **${f4(s.partial)}** | ${s.holmThreshold.toExponential(2)} | ` +
          `${f4(s.loso)} | ${s.letters.join(" ")} |`
      );
    }
  }
  L.push("");
  L.push("## The forest: can a non-linear model beat points-to-date?");
  L.push("");
  L.push("Every model in this product is linear. A random forest can represent interactions and");
  L.push("non-monotone effects that a linear fit cannot, so it is the fair test of whether the");
  L.push("linear tools were leaving anything on the table. Both figures are **out-of-bag** — a");
  L.push("forest's training-set R² is near 1 by construction and means nothing.");
  L.push("");
  L.push("| position | n | points-only OOB R² | all variables OOB R² | gain |");
  L.push("|---|---|---|---|---|");
  for (const [pos, f] of Object.entries(forests)) {
    L.push(
      `| ${pos} | ${f.n} | ${f4(f.baselineR2)} | ${f4(f.oobR2)} | ${f4(f.oobR2 - f.baselineR2)} |`
    );
  }
  L.push("");
  L.push("### Permutation importance (drop in OOB R² when the column is shuffled)");
  L.push("");
  L.push("Permutation rather than split-count or impurity gain: those are biased toward");
  L.push("high-cardinality and high-variance columns, which is a known and severe artefact.");
  L.push("");
  for (const [pos, f] of Object.entries(forests)) {
    L.push(`**${pos}** — ` + f.importance.slice(0, 8).map(([k, v]) => `${k} ${f4(v)}`).join(" · "));
    L.push("");
  }
  L.push("## Every test, including the failures");
  L.push("");
  L.push("`ρ` is the raw Spearman; `partial ρ` controls for first-half points per game. The");
  L.push("**connecting letters** show which quartiles of the variable differ in second-half");
  L.push("scoring: quartiles sharing a letter are not distinguishable at α = 0.05 after a");
  L.push("Bonferroni correction over the six pairwise comparisons. A variable whose four");
  L.push("quartiles all share one letter has no visible effect no matter what its p-value says.");
  L.push("");
  L.push("| position | variable | n | ρ | partial ρ | p | Holm α | significant | LOSO | Q1→Q4 mean outcome | letters | ANOVA p |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    L.push(
      `| ${r.position} | ${r.label} | ${r.n} | ${f4(r.raw)} | ${f4(r.partial)} | ${r.p.toExponential(2)} | ` +
        `${r.holmThreshold.toExponential(2)} | ${r.significant ? "**yes**" : "no"} | ${f4(r.loso)} | ` +
        `${r.quartileMeans.map(f2).join(" → ")} | ${r.letters.join(" ")} | ${Number.isFinite(r.anovaP) ? r.anovaP.toExponential(2) : "—"} |`
    );
  }
  L.push("");
  L.push("## What this cannot tell you");
  L.push("");
  L.push("- **A first-half/second-half split is not a draft-time test.** Everything here");
  L.push("  observes nine weeks of the current season. Protocols 1–3 tested the pre-season");
  L.push("  regime and it failed; nothing in this document revives it.");
  L.push("- **Leave-one-season-out is not a frozen holdout.** All eight seasons were visible");
  L.push("  while these variables were chosen. A survivor here is a candidate for a frozen");
  L.push("  protocol, not a validated signal.");
  L.push("- **Survivorship.** Requiring six observed and four scored games conditions on staying");
  L.push("  healthy and rostered, which is itself predictable. The effect is toward");
  L.push("  understating variance, not toward inventing correlation.");
  L.push("- **The forest is a screen, not a product.** An uncalibrated model must not be");
  L.push("  presented as production-safe, and nothing here ships.");
  L.push("");
  return L.join("\n") + "\n";
}

main();
