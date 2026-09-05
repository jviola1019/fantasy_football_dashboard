/**
 * OUT-OF-HOLDOUT WEEKLY START/SIT — do usage features predict, on seasons no
 * model ever saw?
 *
 * WHAT THIS ANSWERS THAT NOTHING ELSE HERE DOES.
 *
 * `docs/model-gauntlet.md` evaluated leave-one-week-out on 2025. That is out of
 * FOLD but not out of HOLDOUT: every fold shares a season, a rule set, and a
 * projection source with every other, and the shipped coefficients were fitted
 * on that same season. Leave-one-week-out cannot detect a model that has
 * absorbed something season-specific, because there is no unseen season to
 * expose it.
 *
 * It also could not test usage at all. I previously wrote that target share and
 * WOPR "cannot be joined" onto the weekly rows — true, and beside the point.
 * They do not need joining: nflverse's weekly table carries the usage columns
 * AND its own `fantasy_points_ppr` outcome, so it supports a weekly start/sit
 * model in its own right, across **eight seasons**. Conflating "cannot test the
 * shipped model's projection feature" with "cannot test usage" was my error and
 * this script exists because of it.
 *
 * ── THE HOLDOUT DISCIPLINE, WHICH IS THE WHOLE VALUE ───────────────────────
 *
 *   TRAIN     2017–2022 (six seasons)
 *   HOLDOUT   2023–2024 (two seasons) — touched EXACTLY ONCE, at the end
 *
 * Every hyperparameter is fixed a priori (copied from `model-gauntlet.ts`, which
 * never saw these rows). Model comparison and selection happen inside TRAIN by
 * leave-one-SEASON-out, so the selection statistic itself is out-of-sample
 * across seasons. The holdout is then scored once and reported. Nothing is tuned
 * against it, and if a later change re-scores it, that number stops being a
 * holdout result and the report says so rather than pretending otherwise.
 *
 * ── WHAT IS BEING PREDICTED, AND AGAINST WHAT ─────────────────────────────
 *
 * Outcome: did this player clear their position's shipped PPR threshold in this
 * week. Same thresholds as production, so the question is the product's own.
 *
 * The baseline is NOT climatology. It is a logistic on the player's own prior
 * mean PPR — the strongest thing obtainable without usage data, and the honest
 * stand-in for "a projection" in a dataset that has none. Beating climatology
 * would be trivial and would prove nothing; beating prior-mean-points is the
 * real bar, and it is deliberately a hard one.
 *
 * Climatology is still reported, because Brier skill needs a reference and
 * `docs/weekly-prob-baselines.md` established that quoting skill against a
 * constant flatters a model by an order of magnitude.
 *
 *   npm run holdout:weekly
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCsvRows } from "../src/lib/stats/csv";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import { brierScore, expectedCalibrationError } from "../src/lib/stats/distribution";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { pairedBootstrap } from "../src/lib/stats/pairedBootstrap";
import { rocAuc } from "../src/lib/stats/auc";
import {
  fitGradientBoosting,
  predictBoostedProba,
  fitRandomForest,
  predictForestProba
} from "../src/lib/models/trees";
import { WEEKLY_PROB_MODELS, type WeeklyPosition } from "../src/lib/models/weeklyProbability";

const NFLVERSE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "docs/holdout-weekly.md";
const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];
const TRAIN_SEASONS = [2017, 2018, 2019, 2020, 2021, 2022];
const HOLDOUT_SEASONS = [2023, 2024];
const L2 = 1e-4;
const ALPHA = 0.05;
/** Minimum prior weeks before a row is usable. Below this the history is noise. */
const MIN_HISTORY = 3;

const num = (v: string | undefined): number => {
  if (v === undefined || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Weekly {
  playerId: string;
  position: string;
  season: number;
  week: number;
  ppr: number;
  targets: number;
  receptions: number;
  carries: number;
  targetShare: number;
  airYardsShare: number;
  wopr: number;
}

interface Sample {
  season: number;
  outcome: 0 | 1;
  x: number[];
}

/**
 * Feature names in a fixed order. `priorMeanPpr` is index 0 and is the ONLY
 * feature the baseline gets, so the two models differ by exactly the usage
 * block — which is what makes the comparison a test of usage rather than of
 * two unrelated models.
 */
const FEATURES = [
  "priorMeanPpr",
  "priorHitRate",
  "priorTargetShare",
  "priorWopr",
  "priorAirYardsShare",
  "priorTargetsPerGame",
  "priorReceptionsPerGame",
  "priorCarriesPerGame",
  "priorPprStdev",
  "priorGames"
] as const;

function loadWeekly(): Weekly[] {
  const bundle = JSON.parse(gunzipSync(readFileSync(NFLVERSE)).toString("utf8")) as Record<string, string>;
  const out: Weekly[] = [];
  for (const key of Object.keys(bundle).filter((k) => k.startsWith("player_stats_"))) {
    const season = Number(key.replace("player_stats_", ""));
    const parsed = parseCsvRows(bundle[key]!);
    // Parsing is audited by `npm run audit:model-data`; refuse rather than
    // quietly model on a subset if that ever changes.
    if (parsed.malformed > 0) {
      throw new Error(`${key}: ${parsed.malformed} malformed rows — run npm run audit:model-data`);
    }
    for (const r of parsed.rows) {
      if (r.season_type !== "REG") continue;
      if (!POSITIONS.includes(r.position as WeeklyPosition)) continue;
      out.push({
        playerId: r.player_id!,
        position: r.position!,
        season,
        week: Number(r.week),
        ppr: num(r.fantasy_points_ppr),
        targets: num(r.targets),
        receptions: num(r.receptions),
        carries: num(r.carries),
        // Empty for a player with no receiving involvement that week. That is a
        // real zero, not a gap — see the missingness section of the data audit.
        targetShare: num(r.target_share),
        airYardsShare: num(r.air_yards_share),
        wopr: num(r.wopr)
      });
    }
  }
  return out;
}

/**
 * Build samples for one position, with features from EARLIER WEEKS OF THE SAME
 * SEASON only.
 *
 * History does not cross the season boundary: carrying a player's 2022 usage
 * into 2023 week 1 would leak nothing about the outcome, but it would model a
 * different question ("what do we know before the season") and would quietly
 * hand the holdout information from the training seasons. Resetting per season
 * keeps every row's features derivable from that season alone.
 */
function buildSamples(rows: Weekly[], pos: WeeklyPosition): Sample[] {
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;
  const mine = rows.filter((r) => r.position === pos);
  const out: Sample[] = [];

  const seasons = [...new Set(mine.map((r) => r.season))].sort((a, b) => a - b);
  for (const season of seasons) {
    const inSeason = mine.filter((r) => r.season === season).sort((a, b) => a.week - b.week);
    const hist = new Map<
      string,
      {
        n: number;
        ppr: number;
        ppr2: number;
        hits: number;
        targets: number;
        receptions: number;
        carries: number;
        targetShare: number;
        airYardsShare: number;
        wopr: number;
      }
    >();

    for (const r of inSeason) {
      const h = hist.get(r.playerId);
      if (h && h.n >= MIN_HISTORY) {
        const meanPpr = h.ppr / h.n;
        const varPpr = Math.max(0, h.ppr2 / h.n - meanPpr * meanPpr);
        out.push({
          season,
          outcome: r.ppr >= threshold ? 1 : 0,
          x: [
            meanPpr,
            h.hits / h.n,
            h.targetShare / h.n,
            h.wopr / h.n,
            h.airYardsShare / h.n,
            h.targets / h.n,
            h.receptions / h.n,
            h.carries / h.n,
            Math.sqrt(varPpr),
            h.n
          ]
        });
      }
      const p = hist.get(r.playerId) ?? {
        n: 0,
        ppr: 0,
        ppr2: 0,
        hits: 0,
        targets: 0,
        receptions: 0,
        carries: 0,
        targetShare: 0,
        airYardsShare: 0,
        wopr: 0
      };
      hist.set(r.playerId, {
        n: p.n + 1,
        ppr: p.ppr + r.ppr,
        ppr2: p.ppr2 + r.ppr * r.ppr,
        hits: p.hits + (r.ppr >= threshold ? 1 : 0),
        targets: p.targets + r.targets,
        receptions: p.receptions + r.receptions,
        carries: p.carries + r.carries,
        targetShare: p.targetShare + r.targetShare,
        airYardsShare: p.airYardsShare + r.airYardsShare,
        wopr: p.wopr + r.wopr
      });
    }
  }
  return out;
}

/** Column means/sds from TRAIN only, applied to both — never refitted on holdout. */
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
  /** Feature indices this family sees. */
  cols: number[];
  fit: (X: number[][], y: (0 | 1)[]) => Fitted;
}

const BASELINE_COLS = [0];
const ALL_COLS = FEATURES.map((_, i) => i);

const FAMILIES: Family[] = [
  {
    name: "logistic on prior mean PPR (baseline)",
    cols: BASELINE_COLS,
    fit: (X, y) => {
      const f = fitLogistic(X, y, { l2: L2 });
      return (x) => predictLogisticProba(f, x);
    }
  },
  {
    name: "logistic + usage",
    cols: ALL_COLS,
    fit: (X, y) => {
      const f = fitLogistic(X, y, { l2: L2 });
      return (x) => predictLogisticProba(f, x);
    }
  },
  {
    name: "gradient boosting + usage",
    cols: ALL_COLS,
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
    name: "random forest + usage",
    cols: ALL_COLS,
    fit: (X, y) => {
      const m = fitRandomForest(X, y, {
        trees: 200,
        maxDepth: 8,
        minSamplesLeaf: 10,
        lambda: 1,
        maxFeatures: 4,
        seed: 20260903
      });
      return (x) => predictForestProba(m, x);
    }
  }
];

const project = (s: Sample, cols: number[]) => cols.map((c) => s.x[c]!);
const losses = (p: number[], y: (0 | 1)[]) => p.map((pi, i) => (pi - y[i]!) ** 2);

interface Scored {
  brier: number;
  ece: number;
  auc: number;
  bss: number;
  preds: number[];
}

function score(preds: number[], y: (0 | 1)[], climatology: number): Scored {
  const forecasts = preds.map((p, i) => ({ prob: p, outcome: y[i]! }));
  const brier = brierScore(forecasts).score;
  const climBrier =
    brierScore(y.map((o) => ({ prob: climatology, outcome: o }))).score;
  return {
    brier,
    ece: expectedCalibrationError(forecasts).ece,
    auc: rocAuc(preds, y),
    bss: climBrier > 0 ? 1 - brier / climBrier : Number.NaN,
    preds
  };
}

function main(): void {
  const rows = loadWeekly();
  const lines: string[] = [];

  lines.push("# Out-of-holdout weekly start/sit\n");
  lines.push(`**Executed** ${new Date().toISOString()}  \n`);
  lines.push(
    `\n**Train** ${TRAIN_SEASONS[0]}–${TRAIN_SEASONS[TRAIN_SEASONS.length - 1]} · ` +
      `**Holdout** ${HOLDOUT_SEASONS.join("–")} — scored once, never tuned against.\n`
  );
  lines.push(
    "\n> Generated by `npm run holdout:weekly`. Features come from EARLIER WEEKS OF THE " +
      "SAME SEASON only; history never crosses a season boundary. Standardisation is " +
      "fitted on train and applied to holdout. Hyperparameters are fixed a priori. " +
      "Selection uses leave-one-SEASON-out inside train; the holdout is touched once.\n"
  );
  lines.push(
    "\nThe baseline is deliberately hard: a logistic on the player's own **prior mean " +
      "PPR**, the strongest predictor obtainable without usage data. Beating climatology " +
      "would prove nothing. Every other family sees the same feature plus the usage " +
      "block, so a difference is attributable to usage rather than to two unrelated " +
      "models.\n"
  );

  const holdoutTests: Array<{ pos: string; family: string; delta: number; lower: number; upper: number; p: number }> = [];
  const cvRows: string[] = [];
  const cvBrier: Array<{ pos: string; family: string; brier: number }> = [];
  const holdBrier: Array<{ pos: string; family: string; brier: number }> = [];
  const holdoutRows: string[] = [];
  const summary: Array<{ pos: string; n: number; nHold: number; base: number; best: string; bestBrier: number }> = [];

  for (const pos of POSITIONS) {
    const all = buildSamples(rows, pos);
    const train = all.filter((s) => TRAIN_SEASONS.includes(s.season));
    const holdout = all.filter((s) => HOLDOUT_SEASONS.includes(s.season));
    if (train.length < 500 || holdout.length < 200) continue;

    const std = standardiser(train);
    const trainStd = train.map((s) => ({ ...s, x: std(s.x) }));
    const holdStd = holdout.map((s) => ({ ...s, x: std(s.x) }));
    const yTrain = trainStd.map((s) => s.outcome);
    const yHold = holdStd.map((s) => s.outcome);
    const climatology = yTrain.reduce<number>((a, b) => a + b, 0) / yTrain.length;

    // ── Selection: leave-one-SEASON-out INSIDE train ─────────────────────
    for (const fam of FAMILIES) {
      const oof = new Array<number>(trainStd.length).fill(climatology);
      for (const heldSeason of TRAIN_SEASONS) {
        const trIdx: number[] = [];
        const teIdx: number[] = [];
        trainStd.forEach((s, i) => (s.season === heldSeason ? teIdx : trIdx).push(i));
        if (trIdx.length < 200 || teIdx.length === 0) continue;
        const fitted = fam.fit(
          trIdx.map((i) => project(trainStd[i]!, fam.cols)),
          trIdx.map((i) => yTrain[i]!)
        );
        for (const i of teIdx) oof[i] = fitted(project(trainStd[i]!, fam.cols));
      }
      const s = score(oof, yTrain, climatology);
      cvBrier.push({ pos, family: fam.name, brier: s.brier });
      cvRows.push(
        `| ${pos} | ${fam.name} | ${s.brier.toFixed(4)} | ${(100 * s.bss).toFixed(1)}% | ` +
          `${s.ece.toFixed(4)} | ${s.auc.toFixed(4)} |`
      );
    }

    // ── The holdout. Fitted on ALL of train, scored once. ────────────────
    const fittedFamilies = FAMILIES.map((fam) => {
      const fitted = fam.fit(
        trainStd.map((s) => project(s, fam.cols)),
        yTrain
      );
      const preds = holdStd.map((s) => fitted(project(s, fam.cols)));
      return { fam, scored: score(preds, yHold, climatology) };
    });

    const base = fittedFamilies[0]!;
    for (const { fam, scored } of fittedFamilies) {
      holdoutRows.push(
        `| ${pos} | ${fam.name} | ${scored.brier.toFixed(4)} | ${(100 * scored.bss).toFixed(1)}% | ` +
          `${scored.ece.toFixed(4)} | ${scored.auc.toFixed(4)} |`
      );
      holdBrier.push({ pos, family: fam.name, brier: scored.brier });
      if (fam.name === base.fam.name) continue;
      const cmp = pairedBootstrap(
        losses(base.scored.preds, yHold),
        losses(scored.preds, yHold)
      );
      holdoutTests.push({
        pos,
        family: fam.name,
        delta: cmp.meanDifference,
        lower: cmp.lower,
        upper: cmp.upper,
        p: cmp.pValue
      });
    }

    const best = [...fittedFamilies].sort((a, b) => a.scored.brier - b.scored.brier)[0]!;
    summary.push({
      pos,
      n: train.length,
      nHold: holdout.length,
      base: base.scored.brier,
      best: best.fam.name,
      bestBrier: best.scored.brier
    });
  }

  const holm = holmBonferroni(holdoutTests.map((t) => ({ id: `${t.pos}:${t.family}`, p: t.p })), ALPHA);
  const reject = new Set(holm.filter((r) => r.reject).map((r) => r.id));
  const winners = holdoutTests.filter((t) => reject.has(`${t.pos}:${t.family}`) && t.upper < 0);
  const worse = holdoutTests.filter((t) => reject.has(`${t.pos}:${t.family}`) && t.lower > 0);

  lines.push("\n## Sample sizes\n");
  lines.push("\n| position | train rows | holdout rows |");
  lines.push("|---|---|---|");
  for (const s of summary) lines.push(`| ${s.pos} | ${s.n} | ${s.nHold} |`);

  lines.push("\n## Selection inside train — leave-one-season-out\n");
  lines.push("\n| position | family | Brier | skill vs climatology | ECE | AUC |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(...cvRows);

  lines.push(`\n## THE HOLDOUT — ${HOLDOUT_SEASONS.join(" and ")}, scored once\n`);
  lines.push("\n| position | family | Brier | skill vs climatology | ECE | AUC |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(...holdoutRows);

  lines.push("\n### Paired comparison against the baseline, on the holdout\n");
  lines.push("\nNegative ΔBrier means the family beats prior-mean-PPR.\n");
  lines.push("\n| position | family | mean paired ΔBrier | 95% CI | p | Holm |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of [...holdoutTests].sort((a, b) => a.p - b.p)) {
    lines.push(
      `| ${t.pos} | ${t.family} | ${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(4)} | ` +
        `[${t.lower.toFixed(4)}, ${t.upper.toFixed(4)}] | ${t.p.toExponential(2)} | ` +
        `${reject.has(`${t.pos}:${t.family}`) ? "**reject H0**" : "retain"} |`
    );
  }

  // ── Did selection on TRAIN generalise? ──────────────────────────────────
  //
  // The single most informative thing a holdout can tell you, and it is not the
  // headline Brier. If the family that leave-one-season-out CV would have PICKED
  // is also the best on unseen seasons, the selection procedure itself
  // generalises — which is what licenses using it again. If they disagree, every
  // number here is a coin flip dressed as a result.
  lines.push("\n## Did selection on train generalise?\n");
  lines.push(
    "\nFor each position: the family leave-one-season-out CV would have chosen, " +
      "against the family that actually won the holdout.\n"
  );
  lines.push("\n| position | CV would pick | holdout winner | agree |");
  lines.push("|---|---|---|---|");
  let agreements = 0;
  const positionsSeen = [...new Set(cvBrier.map((c) => c.pos))];
  for (const pos of positionsSeen) {
    const cvPick = [...cvBrier.filter((c) => c.pos === pos)].sort((a, b) => a.brier - b.brier)[0]!;
    const holdPick = [...holdBrier.filter((c) => c.pos === pos)].sort((a, b) => a.brier - b.brier)[0]!;
    const agree = cvPick.family === holdPick.family;
    if (agree) agreements += 1;
    lines.push(`| ${pos} | ${cvPick.family} | ${holdPick.family} | ${agree ? "**yes**" : "no"} |`);
  }
  lines.push(
    `\n**${agreements} of ${positionsSeen.length} positions agree.** ` +
      (agreements === positionsSeen.length
        ? "The selection procedure picked the same family on six training seasons that " +
          "won on two unseen ones, at every position. That is the result that licenses " +
          "trusting the procedure — more than any single Brier score does.\n"
        : "Where they disagree, the CV estimate did not generalise and the holdout is " +
          "the number to believe.\n")
  );

  lines.push("\n## Verdict\n");
  lines.push(
    `\n**${winners.length} of ${holdoutTests.length} family-position combinations beat the ` +
      `prior-mean-PPR baseline on two entirely unseen seasons, after Holm correction. ` +
      `${worse.length} are significantly worse.**\n`
  );
  if (winners.length > 0) {
    lines.push("\n| position | family | ΔBrier | 95% CI |");
    lines.push("|---|---|---|---|");
    for (const w of winners.sort((a, b) => a.delta - b.delta)) {
      lines.push(`| ${w.pos} | ${w.family} | ${w.delta.toFixed(4)} | [${w.lower.toFixed(4)}, ${w.upper.toFixed(4)}] |`);
    }
    lines.push(
      "\n**This is a positive out-of-holdout result, and it is the first one in this " +
        "repository for a weekly model.** What it does NOT license is shipping: these " +
        "models predict from nflverse usage that the production envelope does not " +
        "currently carry per-week, and a model may not be presented as production-safe " +
        "until its calibration is measured on the data the product actually has. What it " +
        "does establish is that the ceiling found in `docs/model-gauntlet.md` was a " +
        "property of the 2025 snapshot's seven columns, not of the problem.\n"
    );
  } else {
    lines.push(
      "\nUsage does not beat a player's own prior scoring average on unseen seasons. " +
        "That is a stronger negative than `docs/model-gauntlet.md` could produce, because " +
        "it is measured across a season boundary with the usage features actually present " +
        "rather than absent.\n"
    );
  }

  lines.push(
    "\n### What this does not claim\n\n" +
      "It does not test the SHIPPED model. Production predicts from a FantasyPros " +
      "consensus projection, which nflverse does not carry; the baseline here is a " +
      "player's own prior mean PPR, which is a weaker predictor. A usage feature that " +
      "beats prior-mean-points may still add nothing on top of a real projection, because " +
      "the projection has already absorbed usage. Testing that needs 2025+ weekly usage " +
      "alongside the projections — the acquisition named in `docs/model-gauntlet.md`.\n"
  );

  writeFileSync(OUT, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
}

main();
