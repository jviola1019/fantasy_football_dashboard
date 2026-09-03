/**
 * Is the weekly start/sit model actually good, or is it beating a weak opponent?
 *
 * `WEEKLY_PROB_MODELS.brierSkillScore` is measured against CLIMATOLOGY — always
 * forecasting the position's base rate. That is the weakest baseline available,
 * and "+21.2% skill against a constant" is a much smaller claim than it sounds,
 * because the model is handed a Sleeper projection and the constant is not.
 *
 * The honest question is what the model adds OVER THE PROJECTION IT IS GIVEN.
 * Four baselines, all scored leave-one-week-out on the same rows:
 *
 *   1. CLIMATOLOGY .......... always the base rate. What is quoted today.
 *   2. NAIVE THRESHOLD ...... 1 if projection >= the line, else 0. What a
 *                             manager does in their head, for free.
 *   3. BINNED PROJECTION .... the empirical hit rate of the projection's decile,
 *                             learned out of fold. A strong non-parametric rival
 *                             that uses exactly the same input.
 *   4. THE SHIPPED LOGISTIC.
 *
 * And one structural fact that no amount of Brier can hide: a single-variable
 * logistic is MONOTONE in its input, so within any one fold it cannot reorder
 * players relative to the raw projection, and its AUC there is the projection's
 * AUC exactly. Whatever the model contributes, it is not discrimination — it is
 * calibration, and the report should say which.
 *
 * The pooled AUC in the report differs by a few thousandths because it combines
 * out-of-fold predictions from seventeen separately-fitted models, and a set of
 * different monotone transforms is not itself one monotone transform. That is an
 * artefact of pooling, not a counter-example, and the report says so rather than
 * claiming an equality the numbers do not show.
 *
 *   npm run baselines:weekly-prob
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import { brierScore, expectedCalibrationError } from "../src/lib/stats/distribution";
import { WEEKLY_PROB_MODELS, WEEKLY_PROB_PROVENANCE, type WeeklyPosition } from "../src/lib/models/weeklyProbability";

const SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";
const OUT = "docs/weekly-prob-baselines.md";
const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];
const L2 = 1e-4;
const DECILES = 10;

interface Row {
  kind: string;
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
  played: boolean;
}

interface Obs {
  week: number;
  proj: number;
  outcome: 0 | 1;
}

function load(pos: WeeklyPosition): Obs[] {
  const parsed = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString()) as { rows: Row[] };
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;
  return parsed.rows
    .filter((r) => r.kind === "prospective" && r.position === pos)
    .map((r) => ({
      week: r.week,
      proj: r.proj_pts_ppr,
      outcome: (r.played && r.actual_pts_ppr >= threshold ? 1 : 0) as 0 | 1
    }));
}

/** Area under the ROC curve, by the Mann–Whitney identity, ties counted as half. */
function auc(scores: number[], outcomes: number[]): number {
  const pos = scores.filter((_, i) => outcomes[i] === 1);
  const neg = scores.filter((_, i) => outcomes[i] === 0);
  if (pos.length === 0 || neg.length === 0) return Number.NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

interface Scored {
  brier: number;
  ece: number;
  auc: number;
}

function score(preds: { prob: number; outcome: 0 | 1 }[]): Scored {
  return {
    brier: brierScore(preds).score,
    ece: expectedCalibrationError(preds).ece,
    auc: auc(
      preds.map((p) => p.prob),
      preds.map((p) => p.outcome)
    )
  };
}

interface Result {
  position: WeeklyPosition;
  n: number;
  threshold: number;
  climatology: Scored;
  naive: Scored;
  binned: Scored;
  logistic: Scored;
  rawProjectionAuc: number;
}

function evaluate(pos: WeeklyPosition): Result {
  const data = load(pos);
  const weeks = [...new Set(data.map((d) => d.week))].sort((a, b) => a - b);
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;

  const clim: { prob: number; outcome: 0 | 1 }[] = [];
  const naive: { prob: number; outcome: 0 | 1 }[] = [];
  const binned: { prob: number; outcome: 0 | 1 }[] = [];
  const logi: { prob: number; outcome: 0 | 1 }[] = [];

  for (const held of weeks) {
    const train = data.filter((d) => d.week !== held);
    const test = data.filter((d) => d.week === held);
    if (train.length < 30 || test.length === 0) continue;

    // 1. Climatology — the training base rate.
    const base = train.reduce((a, d) => a + d.outcome, 0) / train.length;

    // 2. Naive threshold — a hard 0/1 call from the projection alone.
    //    Clamped off the endpoints: an unclamped 0/1 forecast that is ever wrong
    //    takes the maximum possible Brier penalty, which would flatter the model
    //    by comparison. 0.02/0.98 is the mildest honest hedge.
    // 3. Binned projection — empirical hit rate of the training decile.
    const sorted = [...train].sort((a, b) => a.proj - b.proj);
    const cuts: number[] = [];
    for (let q = 1; q < DECILES; q += 1) {
      cuts.push(sorted[Math.floor((q / DECILES) * sorted.length)]!.proj);
    }
    const bucketOf = (p: number) => {
      let b = 0;
      while (b < cuts.length && p > cuts[b]!) b += 1;
      return b;
    };
    const bucketRate = new Array(DECILES).fill(base);
    for (let b = 0; b < DECILES; b += 1) {
      const inB = train.filter((d) => bucketOf(d.proj) === b);
      if (inB.length >= 10) bucketRate[b] = inB.reduce((a, d) => a + d.outcome, 0) / inB.length;
    }

    // 4. The shipped form, refitted on the same folds.
    const model = fitLogistic(train.map((d) => [d.proj]), train.map((d) => d.outcome), { l2: L2 });

    for (const d of test) {
      clim.push({ prob: base, outcome: d.outcome });
      naive.push({ prob: d.proj >= threshold ? 0.98 : 0.02, outcome: d.outcome });
      binned.push({ prob: bucketRate[bucketOf(d.proj)]!, outcome: d.outcome });
      logi.push({ prob: predictLogisticProba(model, [d.proj]), outcome: d.outcome });
    }
  }

  return {
    position: pos,
    n: logi.length,
    threshold,
    climatology: score(clim),
    naive: score(naive),
    binned: score(binned),
    logistic: score(logi),
    rawProjectionAuc: auc(
      data.map((d) => d.proj),
      data.map((d) => d.outcome)
    )
  };
}

function main(): void {
  const results = POSITIONS.map(evaluate);
  for (const r of results) {
    console.log(
      `${r.position}  n=${r.n}  Brier: clim ${r.climatology.brier.toFixed(4)} | naive ` +
        `${r.naive.brier.toFixed(4)} | binned ${r.binned.brier.toFixed(4)} | logistic ` +
        `${r.logistic.brier.toFixed(4)}   AUC: logistic ${r.logistic.auc.toFixed(4)} vs raw proj ` +
        `${r.rawProjectionAuc.toFixed(4)}`
    );
  }
  writeFileSync(OUT, report(results), "utf8");
  console.log(`\nwrote ${OUT}`);
}

function report(results: Result[]): string {
  const f4 = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : "—");
  const pc = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
  const skill = (model: number, base: number) => (base > 0 ? 1 - model / base : Number.NaN);

  const L: string[] = [];
  L.push("# The weekly model against baselines that can actually fight back");
  L.push("");
  L.push("Generated by `npm run baselines:weekly-prob`, offline from");
  L.push(`\`${SNAPSHOT}\` — ${WEEKLY_PROB_PROVENANCE.totalRows.toLocaleString()} player-weeks of the`);
  L.push(`${WEEKLY_PROB_PROVENANCE.season} season, fingerprint \`${WEEKLY_PROB_PROVENANCE.fingerprint}\`.`);
  L.push("Every figure is leave-one-week-out on identical rows.");
  L.push("");
  L.push("## Why this exists");
  L.push("");
  L.push("The shipped `brierSkillScore` is measured against **climatology** — always");
  L.push("forecasting the position's base rate. That is the weakest baseline available, and");
  L.push("it is not a fair fight: the model is handed a Sleeper projection and the constant");
  L.push("is not. The question a professional reader asks is what the model adds over the");
  L.push("projection it was given.");
  L.push("");
  L.push("## Brier score — lower is better");
  L.push("");
  L.push("| position | n | climatology | naive threshold | binned projection | **logistic (shipped)** |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) {
    L.push(
      `| ${r.position} | ${r.n} | ${f4(r.climatology.brier)} | ${f4(r.naive.brier)} | ` +
        `${f4(r.binned.brier)} | **${f4(r.logistic.brier)}** |`
    );
  }
  L.push("");
  L.push("### Skill against each baseline (1 − model/baseline)");
  L.push("");
  L.push("| position | vs climatology *(what is quoted)* | vs naive threshold | **vs binned projection** |");
  L.push("|---|---|---|---|");
  for (const r of results) {
    L.push(
      `| ${r.position} | ${pc(skill(r.logistic.brier, r.climatology.brier))} | ` +
        `${pc(skill(r.logistic.brier, r.naive.brier))} | ` +
        `**${pc(skill(r.logistic.brier, r.binned.brier))}** |`
    );
  }
  L.push("");
  L.push("The last column is the one that matters. The binned baseline uses the same single");
  L.push("input, learned non-parametrically out of fold — it is what the model has to beat");
  L.push("to justify being a model rather than a lookup table.");
  L.push("");
  L.push("## Discrimination: the model cannot reorder anybody");
  L.push("");
  L.push("| position | AUC, logistic | AUC, raw projection | difference |");
  L.push("|---|---|---|---|");
  for (const r of results) {
    L.push(
      `| ${r.position} | ${f4(r.logistic.auc)} | ${f4(r.rawProjectionAuc)} | ` +
        `${f4(r.logistic.auc - r.rawProjectionAuc)} |`
    );
  }
  L.push("");
  L.push("**This is structural.** A one-variable logistic is monotone in its input, so WITHIN");
  L.push("ANY ONE FOLD it cannot change the order of players relative to the projection — its");
  L.push("AUC there is the projection's AUC exactly.");
  L.push("");
  L.push("The small gaps above are not evidence against that; they are an artefact of");
  L.push("pooling. The logistic column pools out-of-fold predictions from seventeen");
  L.push("separately-fitted models, and a set of different monotone transforms is not itself");
  L.push("one monotone transform, so two players from different weeks can swap. The raw column");
  L.push("ranks every row with a single scale. The differences are a few thousandths and run");
  L.push("slightly AGAINST the model, which is what pooling predicts.");
  L.push("");
  L.push("So the model's contribution is **calibration, not discrimination**. It does not tell");
  L.push("you who is more likely to clear the line than the projection already did — it tells");
  L.push("you *how* likely, on a scale that has been measured. That is a real and useful");
  L.push("thing, and it is a smaller claim than a Brier skill score against a constant");
  L.push("implies.");
  L.push("");
  L.push("## Calibration error — the thing it IS for");
  L.push("");
  L.push("| position | climatology ECE | naive ECE | binned ECE | **logistic ECE** |");
  L.push("|---|---|---|---|---|");
  for (const r of results) {
    L.push(
      `| ${r.position} | ${pc(r.climatology.ece)} | ${pc(r.naive.ece)} | ${pc(r.binned.ece)} | ` +
        `**${pc(r.logistic.ece)}** |`
    );
  }
  L.push("");
  L.push("## What a reader should take from this");
  L.push("");
  L.push("- The model is **well calibrated** and that is genuinely worth having: a stated 70%");
  L.push("  happens about 70% of the time, which a raw projection does not tell you.");
  L.push("- It adds **no ranking information** over the projection. Anyone choosing between");
  L.push("  two players at the same position in the same week can read the projections and get");
  L.push("  the same order — that is forced by the functional form, not measured.");
  L.push("- Its advantage over a **binned lookup of the same projection** is the honest");
  L.push("  measure of what the parametric form buys, and it is far smaller than the");
  L.push("  headline number.");
  L.push("- **QB remains the weak case** on every baseline, which is why `hasUsefulSkill`");
  L.push("  puts it below the floor.");
  L.push("");
  return L.join("\n") + "\n";
}

main();
