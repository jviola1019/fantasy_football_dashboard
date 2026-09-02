/**
 * Does anything else belong in the weekly start/sit model?
 *
 * `src/lib/models/weeklyProbability.ts` ships one predictor per position: the
 * player's pre-game PPR projection. That is a deliberate floor, not a finished
 * search — nobody had tested whether a second variable earns its place.
 *
 * This harness tests candidates the way a coefficient has to be earned here:
 *
 *   1. STRICTLY PROSPECTIVE FEATURES. Every candidate is built from weeks
 *      STRICTLY BEFORE the row's own week. A feature computed over the whole
 *      season would score week 3 using week 11's outcome, and the resulting
 *      "improvement" would be leakage measured to four decimal places. The
 *      first week of the season therefore has no history and is dropped from
 *      the comparison — for BOTH models, so the baseline is not handed an
 *      advantage either.
 *
 *   2. A NESTED LIKELIHOOD-RATIO TEST. Baseline (projection only) versus
 *      augmented (projection + candidate), same rows, same ridge penalty. One
 *      extra parameter, so LR ~ chi-square(1) and the p-value is exact via
 *      `chiSquare1PValue`.
 *
 *   3. HOLM-BONFERRONI ACROSS THE WHOLE FAMILY. Four positions times k
 *      candidates is 4k tests. Reporting the smallest of those as "p < 0.05" is
 *      the multiple-comparisons error this repository already has a module for
 *      (`stats/multipleComparisons.ts`), and it is exactly how a spurious
 *      predictor gets shipped.
 *
 *   4. AND THEN OUT-OF-SAMPLE. Significance is necessary and not sufficient. A
 *      coefficient can be significant and still make next week's forecast
 *      worse, because in-sample fit and out-of-fold accuracy are different
 *      questions. Every survivor is re-scored under leave-one-week-out CV and
 *      must improve out-of-fold Brier to be recommended.
 *
 * A candidate that fails is reported with its numbers. A report listing only
 * winners is a selection-biased report, and the negative results are the more
 * useful half: they are the reason the shipped model stays one variable wide.
 *
 *   npx tsx scripts/test-weekly-covariates.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import {
  brierScore,
  expectedCalibrationError,
  chiSquare1PValue,
  stdev
} from "../src/lib/stats/distribution";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { fingerprintRows, prospectiveRowKey } from "../src/lib/stats/fingerprint";
import { WEEKLY_PROB_MODELS, WEEKLY_PROB_PROVENANCE, type WeeklyPosition } from "../src/lib/models/weeklyProbability";

const SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";
const OUT = "docs/weekly-covariates.md";
const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];
/** Same ridge as the shipped fit, so the comparison is not confounded by it. */
const L2 = 1e-4;
const ALPHA = 0.05;

interface Row {
  kind: string;
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
  played: boolean;
}

/** One candidate predictor: a name, why it might matter, and how to compute it. */
interface Candidate {
  key: string;
  label: string;
  rationale: string;
}

const CANDIDATES: Candidate[] = [
  {
    key: "priorHitRate",
    label: "prior hit rate",
    rationale:
      "share of this player's PREVIOUS weeks in which they cleared the line, shrunk " +
      "toward the position base rate by 3 pseudo-weeks. Tests whether some players " +
      "clear their line more reliably than their projection alone implies."
  },
  {
    key: "priorMeanResidual",
    label: "prior mean residual",
    rationale:
      "mean of (actual − projection) over this player's previous weeks. Tests " +
      "whether the projection source is biased for particular players — if it is, " +
      "the bias is knowable before kickoff and the model should use it."
  },
  {
    key: "priorPlayedRate",
    label: "prior availability",
    rationale:
      "share of this player's previous weeks in which they actually played. The fit " +
      "scores a did-not-play as a failure, so a player who misses games should clear " +
      "the line less often at the same projection."
  },
  {
    key: "weekIndex",
    label: "week number",
    rationale:
      "the week itself, centred. Tests whether the projection → outcome mapping " +
      "drifts across a season (early-season projections being less informed)."
  },
  {
    key: "logProjection",
    label: "log projection",
    rationale:
      "log(1 + projection) alongside the linear term. Not a new input — a " +
      "functional-form test of whether the log-odds are really linear in points."
  }
];

function loadRows(): Row[] {
  const parsed = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString()) as {
    season: string;
    rows: Row[];
  };
  return parsed.rows.filter((r) => r.kind === "prospective");
}

interface Featured {
  week: number;
  proj: number;
  outcome: 0 | 1;
  features: Record<string, number>;
}

/**
 * Build every candidate for one position, using only earlier weeks.
 *
 * The shrinkage on the rate features is not decoration. A player with one prior
 * week has a hit rate of 0 or 1, and an unshrunk 1.0 from a single game would
 * dominate a coefficient fitted across 1,400 rows.
 */
function featureRows(rows: Row[], pos: WeeklyPosition): Featured[] {
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;
  const mine = rows.filter((r) => r.position === pos).sort((a, b) => a.week - b.week);
  const baseRate = mine.filter((r) => r.played && r.actual_pts_ppr >= threshold).length / Math.max(1, mine.length);
  const PSEUDO = 3;

  const history = new Map<string, { n: number; hits: number; played: number; residual: number }>();
  const weeks = [...new Set(mine.map((r) => r.week))].sort((a, b) => a - b);
  const midWeek = weeks.length > 0 ? (weeks[0]! + weeks[weeks.length - 1]!) / 2 : 0;

  const out: Featured[] = [];
  for (const week of weeks) {
    for (const r of mine.filter((x) => x.week === week)) {
      const h = history.get(r.player_id);
      // Week 1, and any player's first appearance, has no history. Dropped from
      // the comparison entirely rather than imputed: an imputed value would be
      // the position base rate, which is what the intercept already encodes.
      if (h && h.n > 0) {
        out.push({
          week: r.week,
          proj: r.proj_pts_ppr,
          outcome: r.played && r.actual_pts_ppr >= threshold ? 1 : 0,
          features: {
            priorHitRate: (h.hits + PSEUDO * baseRate) / (h.n + PSEUDO),
            priorMeanResidual: h.residual / h.n,
            priorPlayedRate: (h.played + PSEUDO * 1) / (h.n + PSEUDO),
            weekIndex: r.week - midWeek,
            logProjection: Math.log1p(Math.max(0, r.proj_pts_ppr)),
            // POSITIVE CONTROL. Not a candidate and it can never ship: it is
            // built from this row's OWN outcome, so it is leakage by
            // construction. It exists so a null result means something. Twenty
            // tests returning "not significant" is also exactly what a broken
            // likelihood-ratio computation looks like, and the two are
            // indistinguishable from the outside unless the harness is shown
            // detecting an effect it must detect.
            __control: (r.played && r.actual_pts_ppr >= threshold ? 1 : 0) + (r.week % 3) * 0.05
          }
        });
      }
      const cur = history.get(r.player_id) ?? { n: 0, hits: 0, played: 0, residual: 0 };
      cur.n += 1;
      if (r.played && r.actual_pts_ppr >= threshold) cur.hits += 1;
      if (r.played) cur.played += 1;
      cur.residual += (r.played ? r.actual_pts_ppr : 0) - r.proj_pts_ppr;
      history.set(r.player_id, cur);
    }
  }
  return out;
}

/** Log-likelihood of a fitted model on the rows it was fitted to. */
function logLik(model: { intercept: number; coefficients: number[] }, X: number[][], y: number[]): number {
  let ll = 0;
  for (let i = 0; i < X.length; i += 1) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictLogisticProba(model, X[i]!)));
    ll += y[i] === 1 ? Math.log(p) : Math.log(1 - p);
  }
  return ll;
}

/** Leave-one-week-out out-of-fold predictions — the same protocol the shipped model quotes. */
function outOfFold(data: Featured[], cols: string[]): Array<{ prob: number; outcome: 0 | 1 }> {
  const weeks = [...new Set(data.map((d) => d.week))].sort((a, b) => a - b);
  const preds: Array<{ prob: number; outcome: 0 | 1 }> = [];
  for (const held of weeks) {
    const train = data.filter((d) => d.week !== held);
    const test = data.filter((d) => d.week === held);
    if (train.length < 20 || test.length === 0) continue;
    const design = (d: Featured) => [d.proj, ...cols.map((c) => d.features[c]!)];
    const model = fitLogistic(train.map(design), train.map((d) => d.outcome), { l2: L2 });
    for (const d of test) {
      preds.push({ prob: predictLogisticProba(model, design(d)), outcome: d.outcome });
    }
  }
  return preds;
}

interface Result extends Candidate {
  position: WeeklyPosition;
  n: number;
  /** Standard deviation of the feature over the rows it was tested on. */
  sd: number;
  coefficient: number;
  lr: number;
  p: number;
  pHolm: number;
  significant: boolean;
  baseBrier: number;
  augBrier: number;
  brierDelta: number;
  baseEce: number;
  augEce: number;
}

function main(): void {
  const rows = loadRows();
  const fp = fingerprintRows(rows.map(prospectiveRowKey));
  console.log(`rows: ${rows.length}  fingerprint: ${fp}`);
  if (fp !== WEEKLY_PROB_PROVENANCE.fingerprint) {
    console.error(
      `\nFINGERPRINT MISMATCH: snapshot is ${fp}, the shipped model was fitted on ` +
        `${WEEKLY_PROB_PROVENANCE.fingerprint}. Refusing to compare a candidate ` +
        `against a baseline fitted on different rows.`
    );
    process.exit(1);
  }

  const results: Result[] = [];
  const controls: Array<{ position: WeeklyPosition; lr: number; p: number }> = [];
  for (const pos of POSITIONS) {
    const data = featureRows(rows, pos);
    if (data.length < 50) {
      console.log(`${pos}: only ${data.length} rows with history — skipped`);
      continue;
    }
    const y = data.map((d) => d.outcome);
    const baseX = data.map((d) => [d.proj]);
    const baseModel = fitLogistic(baseX, y, { l2: L2 });
    const baseLl = logLik(baseModel, baseX, y);
    const basePreds = outOfFold(data, []);
    const baseBrier = brierScore(basePreds).score;
    const baseEce = expectedCalibrationError(basePreds).ece;

    // POSITIVE CONTROL, run first. A harness that cannot detect an effect
    // reports "nothing is significant" in exactly the same words as a harness
    // that has correctly found nothing. This one is leakage by construction, so
    // if it does not come back overwhelming, the machinery is broken and no
    // null result below can be trusted.
    const ctrlX = data.map((d) => [d.proj, d.features.__control!]);
    const ctrlLr = 2 * (logLik(fitLogistic(ctrlX, y, { l2: L2 }), ctrlX, y) - baseLl);
    controls.push({ position: pos, lr: ctrlLr, p: chiSquare1PValue(ctrlLr) });

    for (const cand of CANDIDATES) {
      const values = data.map((d) => d.features[cand.key]!);
      const sd = stdev(values);
      const augX = data.map((d) => [d.proj, d.features[cand.key]!]);
      const augModel = fitLogistic(augX, y, { l2: L2 });
      const lr = 2 * (logLik(augModel, augX, y) - baseLl);
      const augPreds = outOfFold(data, [cand.key]);
      const augBrier = brierScore(augPreds).score;
      results.push({
        ...cand,
        position: pos,
        n: data.length,
        sd,
        coefficient: augModel.coefficients[1]!,
        lr,
        p: chiSquare1PValue(lr),
        pHolm: Number.NaN,
        significant: false,
        baseBrier,
        augBrier,
        brierDelta: augBrier - baseBrier,
        baseEce,
        augEce: expectedCalibrationError(augPreds).ece
      });
    }
  }

  // Holm–Bonferroni across the whole family of 4 positions x 5 candidates.
  const holm = holmBonferroni(
    results.map((r) => ({ id: `${r.position}:${r.key}`, p: r.p })),
    ALPHA
  );
  for (const h of holm) {
    const target = results.find((r) => `${r.position}:${r.key}` === h.id)!;
    // Holm reports the threshold this test had to clear given its rank; that is
    // the honest thing to print beside a raw p, because there is no single
    // "adjusted p" in a step-down procedure that also carries the stop rule.
    target.pHolm = h.threshold;
    target.significant = h.reject;
  }

  const survivors = results.filter((r) => r.significant && r.brierDelta < 0);
  const significantButWorse = results.filter((r) => r.significant && r.brierDelta >= 0);

  // The control must be overwhelming at EVERY position before any null result
  // here is publishable.
  const CONTROL_FLOOR = 20;
  console.log("\npositive control (leakage by construction — never ships):");
  for (const c of controls) {
    console.log(`  ${c.position}: LR=${c.lr.toFixed(1)}  p=${c.p.toExponential(2)}`);
  }
  const weakControl = controls.filter((c) => !(c.lr > CONTROL_FLOOR));
  if (weakControl.length > 0 || controls.length === 0) {
    console.error(
      `\nCONTROL FAILED at ${weakControl.map((c) => c.position).join(", ") || "(no positions ran)"}. ` +
        `A likelihood-ratio test that cannot detect a feature built from the outcome ` +
        `itself cannot be believed when it detects nothing. Not writing a report.`
    );
    process.exit(1);
  }

  console.log(`\ntests: ${results.length}  significant after Holm: ${results.filter((r) => r.significant).length}`);
  console.log(`significant AND improves out-of-fold Brier: ${survivors.length}`);
  for (const r of survivors) {
    console.log(`  ${r.position} ${r.label}: beta=${r.coefficient.toFixed(4)} p=${r.pHolm.toExponential(2)} Brier ${r.baseBrier.toFixed(5)} -> ${r.augBrier.toFixed(5)}`);
  }
  for (const r of significantButWorse) {
    console.log(`  (rejected) ${r.position} ${r.label}: significant (p=${r.pHolm.toExponential(2)}) but out-of-fold Brier ${r.baseBrier.toFixed(5)} -> ${r.augBrier.toFixed(5)}`);
  }

  writeFileSync(OUT, report(rows.length, fp, results, survivors, significantButWorse, controls), "utf8");
  console.log(`\nwrote ${OUT}`);
}

function report(
  nRows: number,
  fp: string,
  results: Result[],
  survivors: Result[],
  sigButWorse: Result[],
  controls: Array<{ position: WeeklyPosition; lr: number; p: number }>
): string {
  const L: string[] = [];
  L.push("# Weekly start/sit model — candidate covariates");
  L.push("");
  L.push(
    "Generated by `npm run test:covariates` (`scripts/test-weekly-covariates.ts`) — " +
      "offline, from the committed snapshot `reports/2026-08-20/brier-prospective.json.gz`."
  );
  L.push("");
  L.push(`Rows: **${nRows}** prospective player-weeks, 2025 season, input fingerprint \`${fp}\`.`);
  L.push("");
  L.push("## What had to be true for a variable to ship");
  L.push("");
  L.push("1. **Built only from earlier weeks.** A feature computed over the whole season");
  L.push("   would score week 3 using week 11's outcome. Rows without history (week 1, and");
  L.push("   any player's first appearance) are dropped from BOTH models, so the baseline is");
  L.push("   not handed an easier problem either.");
  L.push("2. **A nested likelihood-ratio test** against the shipped one-variable model, on");
  L.push("   the same rows with the same ridge penalty. One extra parameter, so");
  L.push("   LR ~ chi-square(1).");
  L.push(`3. **Holm–Bonferroni across all ${results.length} tests.** Four positions times five`);
  L.push("   candidates. Quoting the smallest raw p-value here would be the multiple-");
  L.push("   comparisons error, and it is exactly how a spurious predictor gets shipped.");
  L.push("4. **And then out-of-sample.** Leave-one-week-out Brier must IMPROVE. A");
  L.push("   coefficient can be significant and still make next week's forecast worse:");
  L.push("   in-sample fit and out-of-fold accuracy are different questions.");
  L.push("");
  L.push("## Can this harness detect anything at all?");
  L.push("");
  L.push("Twenty tests coming back \"not significant\" is also exactly what a broken");
  L.push("likelihood-ratio computation looks like from the outside. So a positive control");
  L.push("runs first at every position: a feature built from the row's own outcome, which");
  L.push("is leakage by construction and can never ship. It must come back overwhelming or");
  L.push("the harness refuses to write this file.");
  L.push("");
  L.push("| position | control LR | control p |");
  L.push("|---|---|---|");
  for (const c of controls) L.push(`| ${c.position} | ${c.lr.toFixed(1)} | ${c.p.toExponential(2)} |`);
  L.push("");
  L.push("## Result");
  L.push("");
  if (survivors.length === 0) {
    L.push("**Nothing ships.** No candidate cleared both gates, so the model stays one");
    L.push("variable wide. That is the finding, not a failure to find one — and it is worth");
    L.push("more than a marginal second coefficient would have been, because it says the");
    L.push("projection is already carrying the information these candidates encode.");
  } else {
    L.push(`**${survivors.length} of ${results.length} candidates clear both gates:**`);
    L.push("");
    for (const r of survivors) {
      L.push(
        `- **${r.position} — ${r.label}**: β = ${r.coefficient.toFixed(6)}, ` +
          `Holm α = ${r.pHolm.toExponential(2)}, out-of-fold Brier ` +
          `${r.baseBrier.toFixed(5)} → ${r.augBrier.toFixed(5)} ` +
          `(${(r.brierDelta * 100).toFixed(3)}pp)`
      );
    }
  }
  if (sigButWorse.length > 0) {
    L.push("");
    L.push(`### Significant and REJECTED (${sigButWorse.length})`);
    L.push("");
    L.push("These have a real association and still do not improve an unseen week. Shipping");
    L.push("them on the p-value alone would have made the forecast worse.");
    L.push("");
    for (const r of sigButWorse) {
      L.push(
        `- ${r.position} — ${r.label}: Holm α = ${r.pHolm.toExponential(2)}, ` +
          `out-of-fold Brier ${r.baseBrier.toFixed(5)} → ${r.augBrier.toFixed(5)} (worse)`
      );
    }
  }
  L.push("");
  L.push("## Every test, including the ones that failed");
  L.push("");
  L.push("A table of winners only is a selection-biased table.");
  L.push("");
  L.push("| position | candidate | n | feature SD | β | LR | raw p | Holm α | verdict | OOF Brier base → aug | Δ | OOF ECE base → aug |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    // A feature with no variation was not "tested and found not significant" —
    // there was nothing to test, and calling that a null result would be a
    // false negative dressed as evidence.
    const verdict = r.sd < 1e-9 ? "**no variation**" : r.significant ? "**significant**" : "not significant";
    L.push(
      `| ${r.position} | ${r.label} | ${r.n} | ${r.sd.toFixed(4)} | ${r.coefficient.toFixed(4)} | ${r.lr.toFixed(2)} | ` +
        `${r.p.toExponential(2)} | ${r.pHolm.toExponential(2)} | ${verdict} | ` +
        `${r.baseBrier.toFixed(5)} → ${r.augBrier.toFixed(5)} | ${(r.brierDelta * 100).toFixed(3)}pp | ` +
        `${r.baseEce.toFixed(4)} → ${r.augEce.toFixed(4)} |`
    );
  }
  L.push("");
  L.push("## What each candidate was, and why it was worth testing");
  L.push("");
  for (const c of CANDIDATES) {
    L.push(`- **${c.label}** (\`${c.key}\`) — ${c.rationale}`);
  }
  L.push("");
  L.push("## Limits of this analysis");
  L.push("");
  L.push("- **One season.** Everything here is 2025. A candidate that survives on one");
  L.push("  season of one scoring format is not established; it is un-refuted.");
  L.push("- **The baseline is re-fitted on the history-only subset**, so the Brier figures");
  L.push("  in this table are not directly comparable to the numbers in");
  L.push("  `docs/brier-results.md`, which use every row. Comparisons WITHIN this table are");
  L.push("  valid because both arms see identical rows.");
  L.push("- **Leave-one-week-out is not a true holdout.** It reuses the same season, and");
  L.push("  protocol 6 in `docs/` already measured that it is mildly optimistic.");
  L.push("- **No IDP, no kickers.** The shipped model covers QB/RB/WR/TE only, and so does");
  L.push("  this.");
  L.push("");
  return L.join("\n") + "\n";
}

main();
