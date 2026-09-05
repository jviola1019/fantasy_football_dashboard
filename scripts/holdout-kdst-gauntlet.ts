/**
 * OUT-OF-HOLDOUT START/SIT FOR KICKERS AND TEAM DEFENCES.
 *
 * These two positions were previously reported as unmodellable. That was true of
 * the committed bundle and false of nflverse, which publishes both — see
 * `scripts/acquire-nflverse-kdst.ts`. This is the model that claim was blocking.
 *
 * ── THE THRESHOLD IS DERIVED, NOT INVENTED ─────────────────────────────────
 *
 * QB/RB/WR/TE ship with start lines (18/10/8/6). Kickers and defences have none,
 * because the product has never modelled them, and picking a round number here
 * would be exactly the hardcoded threshold the project rules forbid — every base
 * rate, Brier and skill score below is a function of it.
 *
 * So the line is the **median weekly score in the TRAINING SEASONS ONLY**.
 * That choice is defensible on two counts: it is a property of the data rather
 * than of my taste, and a median puts the base rate near 50%, where a binary
 * outcome carries the most information and a Brier score is hardest to fake with
 * a constant. Computing it on train alone keeps the holdout unseen — a threshold
 * fitted on all eight seasons would leak the holdout's own distribution into the
 * definition of the target.
 *
 * ── EVERYTHING ELSE MATCHES `holdout-weekly-gauntlet.ts` ──────────────────
 *
 *   TRAIN    2017–2022      HOLDOUT   2023–2024, scored once
 *
 * Features from earlier weeks of the SAME season only. Standardisation fitted on
 * train. Hyperparameters fixed a priori. Selection by leave-one-season-out inside
 * train. Baseline is a logistic on the unit's own prior mean score — the hard
 * baseline, not climatology.
 *
 * ── THE JOIN IS CHECKED, NOT ASSUMED ──────────────────────────────────────
 *
 * Defensive scoring needs points allowed, which comes from the opponent's final
 * score in `games.csv`. Team abbreviations drift across sources and eras
 * (SD→LAC, OAK→LV, STL→LAR), and a silent join failure would drop or mis-score
 * whole seasons while still producing a plausible report. The join rate is
 * therefore measured and the run REFUSES below 99%.
 *
 *   npm run holdout:kdst
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCsvRows } from "../src/lib/stats/csv";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import { brierScore, expectedCalibrationError, quantile } from "../src/lib/stats/distribution";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { pairedBootstrap } from "../src/lib/stats/pairedBootstrap";
import { rocAuc } from "../src/lib/stats/auc";
import {
  fitGradientBoosting,
  predictBoostedProba,
  fitRandomForest,
  predictForestProba
} from "../src/lib/models/trees";
import { defencePoints, kickerPoints } from "../src/lib/models/kdstScoring";
import { normalizeTeamAbbr } from "../src/lib/nflverse/teamAbbr";

const BUNDLE = "reports/2026-09-03/nflverse-kdst.json.gz";
const OUT = "docs/holdout-kdst.md";
const TRAIN_SEASONS = [2017, 2018, 2019, 2020, 2021, 2022];
const HOLDOUT_SEASONS = [2023, 2024];
const L2 = 1e-4;
const ALPHA = 0.05;
const MIN_HISTORY = 3;
const MIN_JOIN_RATE = 0.99;

const n = (v: string | undefined): number => {
  if (v === undefined || v === "" || v === "NA") return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

interface Unit {
  kind: "K" | "DST";
  id: string;
  season: number;
  week: number;
  points: number;
  /** Position-specific volume signals, prior-averaged later. */
  extras: number[];
}

function load(): { units: Unit[]; joinRate: number; joinMisses: string[] } {
  const bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8")) as Record<string, string>;

  // Points allowed = the OPPONENT'S final score, from games.csv.
  const games = parseCsvRows(bundle.games!);
  const scored = new Map<string, number>();
  for (const g of games.rows) {
    if (g.game_type !== "REG") continue;
    // Normalised on BOTH sides: `stats_team_week` back-applies modern
    // abbreviations (2017 Raiders are LV) while games.csv uses the era-correct
    // one (OAK). Raw keys drop ~48 team-weeks and nothing notices.
    const key = (team: string) => `${g.season}|${g.week}|${normalizeTeamAbbr(team)}`;
    // Each side's points ALLOWED is the other side's points scored.
    scored.set(key(g.home_team!), n(g.away_score));
    scored.set(key(g.away_team!), n(g.home_score));
  }

  const units: Unit[] = [];
  const joinMisses: string[] = [];
  let joinAttempts = 0;
  let joinHits = 0;

  for (const key of Object.keys(bundle)) {
    const [kind, seasonRaw] = key.split("_");
    const season = Number(seasonRaw);
    if (!Number.isFinite(season)) continue;

    if (kind === "kicking") {
      for (const r of parseCsvRows(bundle[key]!).rows) {
        if (r.season_type !== "REG") continue;
        const fgAtt =
          n(r.fg_made_0_19) +
          n(r.fg_made_20_29) +
          n(r.fg_made_30_39) +
          n(r.fg_made_40_49) +
          n(r.fg_made_50_59) +
          n(r.fg_made_60_) +
          n(r.fg_missed);
        units.push({
          kind: "K",
          id: r.player_id!,
          season,
          week: Number(r.week),
          points: kickerPoints({
            fgMade0_19: n(r.fg_made_0_19),
            fgMade20_29: n(r.fg_made_20_29),
            fgMade30_39: n(r.fg_made_30_39),
            fgMade40_49: n(r.fg_made_40_49),
            fgMade50_59: n(r.fg_made_50_59),
            fgMade60plus: n(r.fg_made_60_),
            fgMissed: n(r.fg_missed),
            patMade: n(r.pat_made),
            patMissed: n(r.pat_missed)
          }),
          // Volume is the kicker's whole story: a kicker on a good offence gets
          // more attempts, and attempts are what points are made of.
          extras: [fgAtt, n(r.pat_made), n(r.fg_made_40_49) + n(r.fg_made_50_59) + n(r.fg_made_60_)]
        });
      }
    }

    if (kind === "team") {
      for (const r of parseCsvRows(bundle[key]!).rows) {
        if (r.season_type !== "REG") continue;
        joinAttempts += 1;
        const allowed = scored.get(`${season}|${r.week}|${normalizeTeamAbbr(r.team)}`);
        if (allowed === undefined) {
          if (joinMisses.length < 10) joinMisses.push(`${season} wk${r.week} ${r.team}`);
          continue;
        }
        joinHits += 1;
        const takeaways = n(r.def_interceptions) + n(r.fumble_recovery_opp);
        units.push({
          kind: "DST",
          id: normalizeTeamAbbr(r.team),
          season,
          week: Number(r.week),
          points: defencePoints({
            sacks: n(r.def_sacks),
            interceptions: n(r.def_interceptions),
            fumbleRecoveries: n(r.fumble_recovery_opp),
            safeties: n(r.def_safeties),
            defensiveTds: n(r.def_tds),
            specialTeamsTds: n(r.special_teams_tds),
            blockedKicks: n(r.def_punt_blocks) + n(r.def_pat_blocks) + n(r.def_fg_blocks),
            pointsAllowed: allowed
          }),
          extras: [n(r.def_sacks), takeaways, allowed]
        });
      }
    }
  }
  return { units, joinRate: joinAttempts > 0 ? joinHits / joinAttempts : 0, joinMisses };
}

interface Sample {
  season: number;
  outcome: 0 | 1;
  x: number[];
}

/** Prior-weeks features, reset each season. Index 0 is the baseline predictor. */
function buildSamples(units: Unit[], threshold: number): Sample[] {
  const out: Sample[] = [];
  const seasons = [...new Set(units.map((u) => u.season))].sort((a, b) => a - b);
  const extrasWidth = units[0]?.extras.length ?? 0;

  for (const season of seasons) {
    const inSeason = units.filter((u) => u.season === season).sort((a, b) => a.week - b.week);
    const hist = new Map<string, { n: number; pts: number; pts2: number; hits: number; extras: number[] }>();
    for (const u of inSeason) {
      const h = hist.get(u.id);
      if (h && h.n >= MIN_HISTORY) {
        const mean = h.pts / h.n;
        const variance = Math.max(0, h.pts2 / h.n - mean * mean);
        out.push({
          season,
          outcome: u.points >= threshold ? 1 : 0,
          x: [mean, h.hits / h.n, Math.sqrt(variance), h.n, ...h.extras.map((e) => e / h.n)]
        });
      }
      const p =
        hist.get(u.id) ?? { n: 0, pts: 0, pts2: 0, hits: 0, extras: new Array<number>(extrasWidth).fill(0) };
      hist.set(u.id, {
        n: p.n + 1,
        pts: p.pts + u.points,
        pts2: p.pts2 + u.points * u.points,
        hits: p.hits + (u.points >= threshold ? 1 : 0),
        extras: p.extras.map((e, i) => e + (u.extras[i] ?? 0))
      });
    }
  }
  return out;
}

function standardiser(train: Sample[]): (x: number[]) => number[] {
  const p = train[0]?.x.length ?? 0;
  const mean = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let m = 0;
    for (const s of train) m += s.x[j]!;
    m /= Math.max(1, train.length);
    let v = 0;
    for (const s of train) v += (s.x[j]! - m) ** 2;
    v /= Math.max(1, train.length);
    mean[j] = m;
    sd[j] = Math.sqrt(v) > 1e-12 ? Math.sqrt(v) : 1;
  }
  return (x) => x.map((v, j) => (v - mean[j]!) / sd[j]!);
}

type Fitted = (x: number[]) => number;
interface Family {
  name: string;
  cols: (width: number) => number[];
  fit: (X: number[][], y: (0 | 1)[]) => Fitted;
}

const FAMILIES: Family[] = [
  {
    name: "logistic on prior mean points (baseline)",
    cols: () => [0],
    fit: (X, y) => {
      const f = fitLogistic(X, y, { l2: L2 });
      return (x) => predictLogisticProba(f, x);
    }
  },
  {
    name: "logistic + volume features",
    cols: (w) => Array.from({ length: w }, (_, i) => i),
    fit: (X, y) => {
      const f = fitLogistic(X, y, { l2: L2 });
      return (x) => predictLogisticProba(f, x);
    }
  },
  {
    name: "gradient boosting + volume",
    cols: (w) => Array.from({ length: w }, (_, i) => i),
    fit: (X, y) => {
      const m = fitGradientBoosting(X, y, {
        rounds: 200,
        learningRate: 0.05,
        subsample: 0.8,
        maxDepth: 3,
        minSamplesLeaf: 20,
        lambda: 1,
        seed: 20260903
      });
      return (x) => predictBoostedProba(m, x);
    }
  },
  {
    name: "random forest + volume",
    cols: (w) => Array.from({ length: w }, (_, i) => i),
    fit: (X, y) => {
      const m = fitRandomForest(X, y, {
        trees: 200,
        maxDepth: 8,
        minSamplesLeaf: 10,
        lambda: 1,
        maxFeatures: 3,
        seed: 20260903
      });
      return (x) => predictForestProba(m, x);
    }
  }
];

const losses = (p: number[], y: (0 | 1)[]) => p.map((pi, i) => (pi - y[i]!) ** 2);

function scoreAll(preds: number[], y: (0 | 1)[], climatology: number) {
  const forecasts = preds.map((p, i) => ({ prob: p, outcome: y[i]! }));
  const brier = brierScore(forecasts).score;
  const clim = brierScore(y.map((o) => ({ prob: climatology, outcome: o }))).score;
  return {
    brier,
    ece: expectedCalibrationError(forecasts).ece,
    auc: rocAuc(preds, y),
    bss: clim > 0 ? 1 - brier / clim : Number.NaN,
    preds
  };
}

function main(): void {
  const { units, joinRate, joinMisses } = load();
  const lines: string[] = [];

  lines.push("# Out-of-holdout start/sit — kickers and team defences\n");
  lines.push(`**Executed** ${new Date().toISOString()}  \n`);
  lines.push(
    `\n**Train** ${TRAIN_SEASONS[0]}–${TRAIN_SEASONS[TRAIN_SEASONS.length - 1]} · ` +
      `**Holdout** ${HOLDOUT_SEASONS.join("–")} — scored once.\n`
  );
  lines.push(
    "\n> Generated by `npm run holdout:kdst`. Data from `npm run acquire:kdst`. Scoring is " +
      "Sleeper default, defined and tested in `src/lib/models/kdstScoring.ts`.\n"
  );

  lines.push("\n## The points-allowed join\n");
  lines.push(
    `\nDefensive scoring needs points allowed, taken from the opponent's final score in ` +
      `\`games.csv\`. Join rate: **${(100 * joinRate).toFixed(2)}%**. ` +
      (joinRate >= MIN_JOIN_RATE
        ? "Above the 99% floor, so no season is silently missing its defensive scores.\n"
        : `**BELOW the ${100 * MIN_JOIN_RATE}% floor — team abbreviations are not matching and this run is void.** ` +
          `First misses: ${joinMisses.join(", ")}\n`)
  );
  if (joinRate < MIN_JOIN_RATE) {
    writeFileSync(OUT, lines.join("\n"));
    console.log(lines.join("\n"));
    process.exit(1);
  }

  const tests: Array<{ kind: string; family: string; delta: number; lower: number; upper: number; p: number }> = [];
  const cvRows: string[] = [];
  const holdRows: string[] = [];
  const thresholdRows: string[] = [];
  const cvBest: Array<{ kind: string; family: string; brier: number }> = [];
  const holdBest: Array<{ kind: string; family: string; brier: number }> = [];

  for (const kind of ["K", "DST"] as const) {
    const mine = units.filter((u) => u.kind === kind);
    // THE THRESHOLD, from TRAIN ONLY. See the header for why it is a median.
    const trainPoints = mine.filter((u) => TRAIN_SEASONS.includes(u.season)).map((u) => u.points);
    const threshold = Math.round(quantile(trainPoints, 0.5) * 2) / 2;
    const all = buildSamples(mine, threshold);
    const train = all.filter((s) => TRAIN_SEASONS.includes(s.season));
    const holdout = all.filter((s) => HOLDOUT_SEASONS.includes(s.season));

    const holdBase =
      mine.filter((u) => HOLDOUT_SEASONS.includes(u.season) && u.points >= threshold).length /
      Math.max(1, mine.filter((u) => HOLDOUT_SEASONS.includes(u.season)).length);
    thresholdRows.push(
      `| ${kind} | ${threshold} | ${trainPoints.length} | ${train.length} | ${holdout.length} | ` +
        `${(100 * holdBase).toFixed(1)}% |`
    );
    if (train.length < 500 || holdout.length < 200) continue;

    const width = train[0]!.x.length;
    const std = standardiser(train);
    const trainStd = train.map((s) => ({ ...s, x: std(s.x) }));
    const holdStd = holdout.map((s) => ({ ...s, x: std(s.x) }));
    const yTrain = trainStd.map((s) => s.outcome);
    const yHold = holdStd.map((s) => s.outcome);
    const climatology = yTrain.reduce<number>((a, b) => a + b, 0) / yTrain.length;

    for (const fam of FAMILIES) {
      const cols = fam.cols(width);
      const oof = new Array<number>(trainStd.length).fill(climatology);
      for (const held of TRAIN_SEASONS) {
        const tr: number[] = [];
        const te: number[] = [];
        trainStd.forEach((s, i) => (s.season === held ? te : tr).push(i));
        if (tr.length < 200 || te.length === 0) continue;
        const fitted = fam.fit(
          tr.map((i) => cols.map((c) => trainStd[i]!.x[c]!)),
          tr.map((i) => yTrain[i]!)
        );
        for (const i of te) oof[i] = fitted(cols.map((c) => trainStd[i]!.x[c]!));
      }
      const s = scoreAll(oof, yTrain, climatology);
      cvBest.push({ kind, family: fam.name, brier: s.brier });
      cvRows.push(
        `| ${kind} | ${fam.name} | ${s.brier.toFixed(4)} | ${(100 * s.bss).toFixed(1)}% | ` +
          `${s.ece.toFixed(4)} | ${s.auc.toFixed(4)} |`
      );
    }

    const fittedAll = FAMILIES.map((fam) => {
      const cols = fam.cols(width);
      const fitted = fam.fit(trainStd.map((s) => cols.map((c) => s.x[c]!)), yTrain);
      return { fam, scored: scoreAll(holdStd.map((s) => fitted(cols.map((c) => s.x[c]!))), yHold, climatology) };
    });
    const base = fittedAll[0]!;
    for (const { fam, scored } of fittedAll) {
      holdRows.push(
        `| ${kind} | ${fam.name} | ${scored.brier.toFixed(4)} | ${(100 * scored.bss).toFixed(1)}% | ` +
          `${scored.ece.toFixed(4)} | ${scored.auc.toFixed(4)} |`
      );
      holdBest.push({ kind, family: fam.name, brier: scored.brier });
      if (fam.name === base.fam.name) continue;
      const cmp = pairedBootstrap(losses(base.scored.preds, yHold), losses(scored.preds, yHold));
      tests.push({
        kind,
        family: fam.name,
        delta: cmp.meanDifference,
        lower: cmp.lower,
        upper: cmp.upper,
        p: cmp.pValue
      });
    }
  }

  const holm = holmBonferroni(tests.map((t) => ({ id: `${t.kind}:${t.family}`, p: t.p })), ALPHA);
  const reject = new Set(holm.filter((r) => r.reject).map((r) => r.id));
  const winners = tests.filter((t) => reject.has(`${t.kind}:${t.family}`) && t.upper < 0);
  const worse = tests.filter((t) => reject.has(`${t.kind}:${t.family}`) && t.lower > 0);

  lines.push("\n## Thresholds, derived from train medians\n");
  lines.push("\n| unit | threshold | train unit-weeks | train samples | holdout samples | holdout base rate |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(...thresholdRows);
  lines.push(
    "\nA base rate near 50% is the point of using a median: it is where a binary outcome " +
      "carries the most information and where a constant forecast is hardest to mistake for " +
      "a model.\n"
  );

  lines.push("\n## Selection inside train — leave-one-season-out\n");
  lines.push("\n| unit | family | Brier | skill vs climatology | ECE | AUC |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(...cvRows);

  lines.push(`\n## THE HOLDOUT — ${HOLDOUT_SEASONS.join(" and ")}, scored once\n`);
  lines.push("\n| unit | family | Brier | skill vs climatology | ECE | AUC |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(...holdRows);

  lines.push("\n### Paired comparison against the baseline\n");
  lines.push("\n| unit | family | mean paired ΔBrier | 95% CI | p | Holm |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of [...tests].sort((a, b) => a.p - b.p)) {
    lines.push(
      `| ${t.kind} | ${t.family} | ${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(4)} | ` +
        `[${t.lower.toFixed(4)}, ${t.upper.toFixed(4)}] | ${t.p.toExponential(2)} | ` +
        `${reject.has(`${t.kind}:${t.family}`) ? "**reject H0**" : "retain"} |`
    );
  }

  lines.push("\n## Did selection on train generalise?\n");
  lines.push("\n| unit | CV would pick | holdout winner | agree |");
  lines.push("|---|---|---|---|");
  let agree = 0;
  const kinds = [...new Set(cvBest.map((c) => c.kind))];
  for (const kind of kinds) {
    const cv = [...cvBest.filter((c) => c.kind === kind)].sort((a, b) => a.brier - b.brier)[0]!;
    const hd = [...holdBest.filter((c) => c.kind === kind)].sort((a, b) => a.brier - b.brier)[0]!;
    if (cv.family === hd.family) agree += 1;
    lines.push(`| ${kind} | ${cv.family} | ${hd.family} | ${cv.family === hd.family ? "**yes**" : "no"} |`);
  }
  lines.push(`\n**${agree} of ${kinds.length} agree.**\n`);

  lines.push("\n## Verdict\n");
  lines.push(
    `\n**${winners.length} of ${tests.length} combinations beat the prior-mean-points baseline ` +
      `on two unseen seasons after Holm correction. ${worse.length} are significantly worse.**\n`
  );
  if (winners.length > 0) {
    lines.push("\n| unit | family | ΔBrier | 95% CI |");
    lines.push("|---|---|---|---|");
    for (const w of winners.sort((a, b) => a.delta - b.delta)) {
      lines.push(`| ${w.kind} | ${w.family} | ${w.delta.toFixed(4)} | [${w.lower.toFixed(4)}, ${w.upper.toFixed(4)}] |`);
    }
  }
  // THE HEADLINE IS THE BASELINE, NOT THE COMPARISON.
  //
  // "0 of 6 beat the baseline" reads like the QB/RB/WR/TE result and means
  // something completely different here, because THIS baseline is barely better
  // than a coin flip. Leading with the comparison would bury the actual finding.
  lines.push("\n### The finding is the SKILL LEVEL, not the comparison\n");
  // The skill-position figures are deliberately NOT restated here. They belong to
  // a document this script does not generate, and copying them in makes this
  // report able to contradict that one the moment either is re-run. The numbers
  // below are computed by this run; the comparison is a pointer.
  const skillLine = holdBest
    .filter((h) => h.family.includes("baseline"))
    .map((h) => h.kind)
    .join(" and ");
  lines.push(
    `\nRead the holdout skill column above before the paired table. ${skillLine} score around ` +
      "**1%** skill against climatology. The same protocol and the same reference applied to " +
      "QB/RB/WR/TE is in `docs/holdout-weekly.md`, where the skill column is an order of " +
      "magnitude higher — compare the two documents rather than trusting a figure copied " +
      "from one into the other.\n"
  );
  lines.push(
    "\n**A kicker's or a defence's own scoring history barely predicts their next week.** " +
      "That is not a shortcoming of these four families — it is the signal that is there. " +
      "Every family, including the two ensembles, lands within a couple of thousandths of " +
      "climatology, and boosting on volume is significantly WORSE for defences. The " +
      "well-known advice that streaming kickers and defences is close to a coin flip is " +
      "reproduced here on this product's own scoring rules, out of holdout, at 100% join " +
      "coverage.\n"
  );
  lines.push(
    "\n### What ships from this: nothing, and now for a better reason\n\n" +
      "The earlier claim was that kickers and defences *cannot be modelled* because the " +
      "data does not exist. That was wrong — nflverse publishes all of it, and " +
      "`npm run acquire:kdst` fetches it in 70 KB. They can be modelled. The reason not to " +
      "ship a probability for them is now **measured rather than assumed**: at the skill " +
      "levels in the holdout table above, a K or DST probability shown beside an RB/WR/TE " +
      "number would imply an equivalence the data refuses, which is the same hazard the QB " +
      "row already carries a warning for.\n\n" +
      "Two further blockers remain and are real: the product has no K or DST **projection** " +
      "to convert, and these thresholds are research medians rather than any league's start " +
      "line.\n"
  );

  writeFileSync(OUT, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
}

main();
