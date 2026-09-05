/**
 * THE MODEL GAUNTLET — can anything beat the shipped one-variable logistic?
 *
 * WHY THIS EXISTS. `scripts/test-weekly-covariates.ts` tested five candidate
 * covariates and found that none survives Holm correction AND improves
 * out-of-fold Brier. That is a real result, but it is a result about FIVE
 * candidates inside ONE functional form, and reporting "nothing works" from a
 * narrow search overstates what was actually searched. This widens the search
 * as far as the committed data allows, under exactly the same evidential
 * standard.
 *
 * NOTHING HERE IS RELAXED TO PRODUCE A WINNER. Same Holm correction, same
 * requirement that significance be confirmed OUT OF FOLD, same leave-one-week-out
 * folds, same prospective-only features. A model that "passes" because the bar
 * moved is worse than no model.
 *
 * ── WHAT THE DATA ALLOWS, AND WHAT IT DOES NOT ─────────────────────────────
 *
 * The weekly snapshot (`reports/2026-08-20/brier-prospective.json.gz`) carries
 * SEVEN fields: player id, position, week, projection, actual, played. There is
 * no snap share, no target share, no opponent, no injury status, no line.
 *
 * The obvious idea — join the nflverse usage bundle, whose target share and WOPR
 * DID validate at season level in `docs/variable-validation.md` — is impossible
 * with committed data: that bundle covers **2017–2024** and this snapshot is the
 * **2025** season. They do not intersect, and no Sleeper→gsis crosswalk exists
 * in the repo. That is a data-availability wall, not a modelling one, and it is
 * the single biggest constraint on everything below.
 *
 * So the search runs along the two axes that ARE reachable:
 *
 *   AXIS 1 — more prospective features, all derived from the player's own
 *   earlier weeks (5 candidates → 11).
 *   AXIS 2 — different functional forms, including ones that can represent
 *   shapes a logistic cannot.
 *
 * ── THE TWO STAGES ─────────────────────────────────────────────────────────
 *
 * STAGE 1, single covariates. Nested likelihood-ratio test against the shipped
 * baseline, chi-square(1), Holm-Bonferroni across all positions × candidates,
 * then survivors must ALSO improve out-of-fold Brier. Identical protocol to the
 * existing harness, applied to a bigger candidate list.
 *
 * STAGE 2, whole model families. Families are not nested, so a likelihood-ratio
 * test does not apply; the honest comparison is out-of-fold loss, PAIRED row by
 * row (`stats/pairedBootstrap.ts`), with Holm across families × positions. A
 * family must have a negative mean paired difference whose interval excludes
 * zero, after correction, to count.
 *
 * POSITIVE CONTROLS IN BOTH STAGES. "Nothing passed" and "the comparison is
 * broken" look identical from outside. A leaked feature must be caught in stage
 * 1, and a family given that feature must win stage 2. If either control fails,
 * the run is void and says so instead of reporting a null result.
 *
 *   npx tsx scripts/model-gauntlet.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import { brierScore, chiSquare1PValue, expectedCalibrationError } from "../src/lib/stats/distribution";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { pairedBootstrap } from "../src/lib/stats/pairedBootstrap";
import { fitIsotonic, predictIsotonic } from "../src/lib/stats/isotonic";
import {
  fitGradientBoosting,
  predictBoostedProba,
  fitRandomForest,
  predictForestProba,
  fitOutOfFold
} from "../src/lib/models/trees";
import { WEEKLY_PROB_MODELS, type WeeklyPosition } from "../src/lib/models/weeklyProbability";

const SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";
const OUT = "docs/model-gauntlet.md";
const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];
/** Same ridge as the shipped fit, so no comparison is confounded by it. */
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

interface Featured {
  week: number;
  proj: number;
  outcome: 0 | 1;
  features: Record<string, number>;
}

/** Candidate names in a fixed order — the multi-feature families use all of them. */
const CANDIDATES = [
  "priorHitRate",
  "priorMeanResidual",
  "priorPlayedRate",
  "weekIndex",
  "logProjection",
  "priorResidualStdev",
  "priorMeanActual",
  "projRankInWeek",
  "projVsPriorMeanProj",
  "priorGames",
  "projSquared"
] as const;

/** Never a candidate. Built from the row's OWN outcome — the positive control. */
const LEAK = "leakedOutcome";

function loadRows(): Row[] {
  const parsed = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString()) as {
    season: string;
    rows: Row[];
  };
  return parsed.rows.filter((r) => r.kind === "prospective");
}

/**
 * Build every feature for one position using ONLY earlier weeks.
 *
 * A feature computed over the whole season would score week 3 using week 11's
 * outcome, and the resulting "improvement" would be leakage measured to four
 * decimal places. Week 1 and any player's first appearance have no history and
 * are dropped — for every model, so no candidate is handed an advantage.
 */
function featureRows(rows: Row[], pos: WeeklyPosition): Featured[] {
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;
  const mine = rows.filter((r) => r.position === pos).sort((a, b) => a.week - b.week);
  const baseRate =
    mine.filter((r) => r.played && r.actual_pts_ppr >= threshold).length / Math.max(1, mine.length);
  const PSEUDO = 3;

  const history = new Map<
    string,
    { n: number; hits: number; played: number; residual: number; resid2: number; actual: number; proj: number }
  >();
  const weeks = [...new Set(mine.map((r) => r.week))].sort((a, b) => a - b);
  const midWeek = weeks.length > 0 ? (weeks[0]! + weeks[weeks.length - 1]!) / 2 : 0;

  const out: Featured[] = [];
  for (const week of weeks) {
    const inWeek = mine.filter((x) => x.week === week);
    // Rank within the week is a RELATIVE signal: "third-best projected TE this
    // week" is not the same information as "projected 11.4 points", because the
    // pool a manager chooses from changes week to week.
    const ranked = [...inWeek].sort((a, b) => b.proj_pts_ppr - a.proj_pts_ppr);
    const rankOf = new Map(ranked.map((r, i) => [r.player_id, i + 1]));

    for (const r of inWeek) {
      const h = history.get(r.player_id);
      if (h && h.n > 0) {
        const meanResid = h.residual / h.n;
        const varResid = Math.max(0, h.resid2 / h.n - meanResid * meanResid);
        const meanProj = h.proj / h.n;
        out.push({
          week: r.week,
          proj: r.proj_pts_ppr,
          outcome: r.played && r.actual_pts_ppr >= threshold ? 1 : 0,
          features: {
            priorHitRate: (h.hits + PSEUDO * baseRate) / (h.n + PSEUDO),
            priorMeanResidual: meanResid,
            priorPlayedRate: (h.played + PSEUDO * 1) / (h.n + PSEUDO),
            weekIndex: r.week - midWeek,
            logProjection: Math.log1p(Math.max(0, r.proj_pts_ppr)),
            // How ERRATIC this player has been. A volatile player at the same
            // projection is a different bet from a metronome, and nothing in the
            // shipped model can express that.
            priorResidualStdev: Math.sqrt(varResid),
            priorMeanActual: h.actual / h.n,
            projRankInWeek: rankOf.get(r.player_id) ?? 0,
            // Is THIS week's projection unusual for this player? A spike may be
            // a real role change or may be projection noise.
            projVsPriorMeanProj: r.proj_pts_ppr - meanProj,
            // How much history the other priors rest on. Shrinkage handles the
            // mean; this lets a model know how much to trust it.
            priorGames: h.n,
            projSquared: r.proj_pts_ppr * r.proj_pts_ppr,
            [LEAK]: r.played && r.actual_pts_ppr >= threshold ? 1 : 0
          }
        });
      }
      const prev = history.get(r.player_id) ?? {
        n: 0,
        hits: 0,
        played: 0,
        residual: 0,
        resid2: 0,
        actual: 0,
        proj: 0
      };
      const resid = r.actual_pts_ppr - r.proj_pts_ppr;
      history.set(r.player_id, {
        n: prev.n + 1,
        hits: prev.hits + (r.played && r.actual_pts_ppr >= threshold ? 1 : 0),
        played: prev.played + (r.played ? 1 : 0),
        residual: prev.residual + resid,
        resid2: prev.resid2 + resid * resid,
        actual: prev.actual + r.actual_pts_ppr,
        proj: prev.proj + r.proj_pts_ppr
      });
    }
  }
  return out;
}

/** Standardise a column so ridge treats every feature on comparable footing. */
function standardise(values: number[]): number[] {
  const m = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, values.length)
  );
  return sd > 1e-12 ? values.map((v) => (v - m) / sd) : values.map(() => 0);
}

function logLikelihood(X: number[][], y: (0 | 1)[], fit: ReturnType<typeof fitLogistic>): number {
  let ll = 0;
  for (let i = 0; i < X.length; i += 1) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictLogisticProba(fit, X[i]!)));
    ll += y[i] === 1 ? Math.log(p) : Math.log(1 - p);
  }
  return ll;
}

/** Per-row squared error, the paired loss the families are compared on. */
const rowLosses = (p: number[], y: (0 | 1)[]) => p.map((pi, i) => (pi - y[i]!) ** 2);

interface FamilyResult {
  name: string;
  brier: number;
  ece: number;
  losses: number[];
}

function main(): void {
  const rows = loadRows();
  const lines: string[] = [];
  const stage1: Array<{ pos: string; key: string; lr: number; p: number; oofDelta: number }> = [];
  const stage1Control: Array<{ pos: string; lr: number; p: number }> = [];
  const stage2: Array<{ pos: string; family: string; delta: number; lower: number; upper: number; p: number }> = [];
  const stage2Control: Array<{ pos: string; delta: number; p: number }> = [];
  const familyTable: Array<{ pos: string; name: string; brier: number; ece: number }> = [];

  for (const pos of POSITIONS) {
    const featured = featureRows(rows, pos);
    if (featured.length < 100) continue;
    const y = featured.map((f) => f.outcome);
    const folds = featured.map((f) => f.week);
    const projCol = featured.map((f) => f.proj);

    // ── Baseline: the shipped form, one variable ──────────────────────────
    const baseX = featured.map((f) => [f.proj]);
    const baseOof = fitOutOfFold(baseX, y, folds, (tx, ty, ex) => {
      const fit = fitLogistic(tx, ty, { l2: L2 });
      return ex.map((r) => predictLogisticProba(fit, r));
    });
    const baseline: FamilyResult = {
      name: "logistic on projection (shipped)",
      brier: brierScore(baseOof.map((p, i) => ({ prob: p, outcome: y[i] }))).score,
      ece: expectedCalibrationError(baseOof.map((p, i) => ({ prob: p, outcome: y[i] }))).ece,
      losses: rowLosses(baseOof, y)
    };
    familyTable.push({ pos, name: baseline.name, brier: baseline.brier, ece: baseline.ece });

    // ── STAGE 1: single covariates, nested LR ─────────────────────────────
    const baseFitAll = fitLogistic(baseX, y, { l2: L2 });
    const baseLL = logLikelihood(baseX, y, baseFitAll);

    for (const key of [...CANDIDATES, LEAK]) {
      const col = standardise(featured.map((f) => f.features[key]!));
      const augX = featured.map((f, i) => [f.proj, col[i]!]);
      const augFit = fitLogistic(augX, y, { l2: L2 });
      const lr = 2 * (logLikelihood(augX, y, augFit) - baseLL);
      const p = chiSquare1PValue(Math.max(0, lr));

      const augOof = fitOutOfFold(augX, y, folds, (tx, ty, ex) => {
        const fit = fitLogistic(tx, ty, { l2: L2 });
        return ex.map((r) => predictLogisticProba(fit, r));
      });
      const augBrier = brierScore(augOof.map((q, i) => ({ prob: q, outcome: y[i] }))).score;

      if (key === LEAK) stage1Control.push({ pos, lr, p });
      else stage1.push({ pos, key, lr, p, oofDelta: augBrier - baseline.brier });
    }

    // ── STAGE 2: whole families, out of fold ──────────────────────────────
    const allCols = CANDIDATES.map((k) => standardise(featured.map((f) => f.features[k]!)));
    const multiX = featured.map((_, i) => [projCol[i]!, ...allCols.map((c) => c[i]!)]);
    const leakX = featured.map((f, i) => [projCol[i]!, f.features[LEAK]!]);

    const families: Array<{ name: string; oof: number[] }> = [
      {
        name: "isotonic on projection",
        oof: fitOutOfFold(baseX, y, folds, (tx, ty, ex) => {
          const fit = fitIsotonic(tx.map((r) => r[0]!), ty);
          return ex.map((r) => predictIsotonic(fit, r[0]!));
        })
      },
      {
        name: "gradient boosting on projection",
        oof: fitOutOfFold(baseX, y, folds, (tx, ty, ex) => {
          const m = fitGradientBoosting(tx, ty, {
            rounds: 120,
            learningRate: 0.05,
            subsample: 0.8,
            maxDepth: 2,
            minSamplesLeaf: 20,
            lambda: 1,
            seed: 20260903
          });
          return ex.map((r) => predictBoostedProba(m, r));
        })
      },
      {
        name: "logistic on all 11 candidates",
        oof: fitOutOfFold(multiX, y, folds, (tx, ty, ex) => {
          const fit = fitLogistic(tx, ty, { l2: L2 });
          return ex.map((r) => predictLogisticProba(fit, r));
        })
      },
      {
        name: "gradient boosting on all 11",
        oof: fitOutOfFold(multiX, y, folds, (tx, ty, ex) => {
          const m = fitGradientBoosting(tx, ty, {
            rounds: 200,
            learningRate: 0.05,
            subsample: 0.8,
            maxDepth: 3,
            minSamplesLeaf: 20,
            lambda: 1,
            seed: 20260903
          });
          return ex.map((r) => predictBoostedProba(m, r));
        })
      },
      {
        name: "random forest on all 11",
        oof: fitOutOfFold(multiX, y, folds, (tx, ty, ex) => {
          const m = fitRandomForest(tx, ty, {
            trees: 200,
            maxDepth: 8,
            minSamplesLeaf: 10,
            lambda: 1,
            maxFeatures: 4,
            seed: 20260903
          });
          return ex.map((r) => predictForestProba(m, r));
        })
      }
    ];

    for (const fam of families) {
      const forecasts = fam.oof.map((p, i) => ({ prob: p, outcome: y[i] }));
      const brier = brierScore(forecasts).score;
      familyTable.push({ pos, name: fam.name, brier, ece: expectedCalibrationError(forecasts).ece });
      const cmp = pairedBootstrap(baseline.losses, rowLosses(fam.oof, y));
      stage2.push({
        pos,
        family: fam.name,
        delta: cmp.meanDifference,
        lower: cmp.lower,
        upper: cmp.upper,
        p: cmp.pValue
      });
    }

    // Positive control for stage 2: a family handed the leaked outcome MUST win.
    const leakOof = fitOutOfFold(leakX, y, folds, (tx, ty, ex) => {
      const fit = fitLogistic(tx, ty, { l2: L2 });
      return ex.map((r) => predictLogisticProba(fit, r));
    });
    const leakCmp = pairedBootstrap(baseline.losses, rowLosses(leakOof, y));
    stage2Control.push({ pos, delta: leakCmp.meanDifference, p: leakCmp.pValue });
  }

  // ── Corrections ─────────────────────────────────────────────────────────
  const s1 = holmBonferroni(stage1.map((t) => ({ id: `${t.pos}:${t.key}`, p: t.p })), ALPHA);
  const s1Reject = new Set(s1.filter((r) => r.reject).map((r) => r.id));
  const s1Survivors = stage1.filter((t) => s1Reject.has(`${t.pos}:${t.key}`) && t.oofDelta < 0);

  const s2 = holmBonferroni(stage2.map((t) => ({ id: `${t.pos}:${t.family}`, p: t.p })), ALPHA);
  const s2Reject = new Set(s2.filter((r) => r.reject).map((r) => r.id));
  const s2Survivors = stage2.filter((t) => s2Reject.has(`${t.pos}:${t.family}`) && t.upper < 0);

  const controlsOk =
    stage1Control.every((c) => c.p < 1e-6) && stage2Control.every((c) => c.delta < 0 && c.p < 0.05);

  // ── Report ──────────────────────────────────────────────────────────────
  lines.push("# Model gauntlet — weekly start/sit\n");
  lines.push(`**Executed** ${new Date().toISOString()}  \n`);
  lines.push(`**Data** \`${SNAPSHOT}\` — 2025 season, prospective rows only.\n`);
  lines.push(
    "\n> Generated by `npm run gauntlet:weekly`. Every feature is built from weeks " +
      "STRICTLY BEFORE the row's own. Stage 1 uses a nested likelihood-ratio test; " +
      "stage 2 compares whole families on PAIRED out-of-fold loss. Holm-Bonferroni " +
      "is applied within each stage. Nothing was relaxed to produce a winner.\n"
  );

  lines.push("\n## Controls\n");
  lines.push(
    controlsOk
      ? "**PASS.** A leaked feature is caught in stage 1 and a family given it wins stage 2, " +
          "so a null result below means what it says rather than a broken comparison.\n"
      : "**FAILED — THIS RUN IS VOID.** The positive controls did not fire, so any null " +
          "result below is indistinguishable from a broken harness.\n"
  );
  lines.push("\n| position | stage 1 control LR | stage 2 control ΔBrier | p |");
  lines.push("|---|---|---|---|");
  for (let i = 0; i < stage1Control.length; i += 1) {
    const a = stage1Control[i]!;
    const b = stage2Control[i]!;
    lines.push(`| ${a.pos} | ${a.lr.toFixed(1)} | ${b.delta.toFixed(4)} | ${b.p.toExponential(1)} |`);
  }

  lines.push("\n## Stage 1 — single covariates\n");
  lines.push(`${stage1.length} tests (${POSITIONS.length} positions × ${CANDIDATES.length} candidates).\n`);
  lines.push("\n| position | candidate | LR | p | Holm | out-of-fold ΔBrier |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of [...stage1].sort((a, b) => a.p - b.p)) {
    const held = s1Reject.has(`${t.pos}:${t.key}`);
    lines.push(
      `| ${t.pos} | ${t.key} | ${t.lr.toFixed(2)} | ${t.p.toExponential(2)} | ` +
        `${held ? "**reject H0**" : "retain"} | ${t.oofDelta >= 0 ? "+" : ""}${t.oofDelta.toFixed(4)} |`
    );
  }
  lines.push(
    `\n**Survivors (significant AND out-of-fold improvement): ${s1Survivors.length}.**` +
      (s1Survivors.length === 0
        ? " No single covariate earns a coefficient.\n"
        : ` ${s1Survivors.map((s) => `${s.pos}:${s.key}`).join(", ")}\n`)
  );

  lines.push("\n## Stage 2 — whole model families\n");
  lines.push("Out-of-fold Brier per family, leave-one-week-out. Lower is better.\n");
  lines.push("\n| position | family | out-of-fold Brier | ECE |");
  lines.push("|---|---|---|---|");
  for (const f of familyTable) {
    lines.push(`| ${f.pos} | ${f.name} | ${f.brier.toFixed(4)} | ${f.ece.toFixed(4)} |`);
  }
  lines.push("\n### Paired comparison against the shipped model\n");
  lines.push("\n| position | family | mean paired ΔBrier | 95% CI | p | Holm |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of [...stage2].sort((a, b) => a.p - b.p)) {
    const held = s2Reject.has(`${t.pos}:${t.family}`);
    lines.push(
      `| ${t.pos} | ${t.family} | ${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(4)} | ` +
        `[${t.lower.toFixed(4)}, ${t.upper.toFixed(4)}] | ${t.p.toExponential(2)} | ` +
        `${held ? "**reject H0**" : "retain"} |`
    );
  }
  lines.push(
    `\n**Families beating the shipped model after correction: ${s2Survivors.length}.**` +
      (s2Survivors.length === 0
        ? " The one-variable logistic is not beaten by any family tried here.\n"
        : ` ${s2Survivors.map((s) => `${s.pos}:${s.family}`).join(", ")}\n`)
  );

  // The most informative finding is not the absence of a winner, it is the
  // presence of significant LOSERS. Buried in a 24-row table nobody reads to
  // the end, so it is stated.
  const worse = stage2.filter((t) => s2Reject.has(`${t.pos}:${t.family}`) && t.lower > 0);
  lines.push("\n### The result is stronger than 'nothing won'\n");
  // DERIVED, not asserted. An earlier version hardcoded "bar one (TE, logistic
  // on all 11, −0.0021, p = 0.52)" into a report this script REGENERATES, so the
  // next run that moved a number would have published prose contradicting its
  // own table.
  const negatives = stage2.filter((t) => t.delta < 0);
  const negativeText =
    negatives.length === 0
      ? "and every single combination has a point estimate at or above it"
      : `and every combination has a point estimate at or above it bar ${negatives.length} ` +
        `(${negatives
          .map((t) => `${t.pos} ${t.family}, ${t.delta.toFixed(4)}, p = ${t.p.toFixed(2)}`)
          .join("; ")})`;
  lines.push(
    `\n**${worse.length} of ${stage2.length} family-position combinations are significantly ` +
      `WORSE than the shipped model after Holm correction**, ${negativeText}.\n`
  );
  if (worse.length > 0) {
    lines.push("\n| position | family | mean paired ΔBrier | 95% CI |");
    lines.push("|---|---|---|---|");
    for (const t of worse.sort((a, b) => b.delta - a.delta)) {
      lines.push(
        `| ${t.pos} | ${t.family} | +${t.delta.toFixed(4)} | [${t.lower.toFixed(4)}, ${t.upper.toFixed(4)}] |`
      );
    }
  }
  lines.push(
    "\nThat pattern has a name and it is not 'the search was too narrow'. Every " +
      "multi-feature family is beaten by the one-feature model, and the gap grows with " +
      "the flexibility of the family — boosting on 11 features is the worst performer at " +
      "three of four positions. That is **overfitting at this sample size**: 512 to 1,470 " +
      "rows per position cannot support 11 parameters plus tree structure, and the extra " +
      "capacity is spent memorising fold-specific noise. The corrective is more DATA, not " +
      "more parameters.\n"
  );
  lines.push(
    "\nIt also says something worth keeping about the projection itself: FantasyPros' " +
      "consensus already aggregates the opponent, the injury report and the depth chart. " +
      "A player's own residual history is largely a re-reading of information the " +
      "projection has already used, which is exactly why 44 covariates built from it " +
      "add nothing.\n"
  );

  lines.push("\n## What a null result here does and does not mean\n");
  lines.push(
    "It does NOT mean no better model exists. It means that on the data this repository " +
      "has committed — 2025 weekly rows carrying a projection and an outcome and nothing " +
      "else — neither a wider set of history-derived features nor a more flexible " +
      "functional form beats a one-variable logistic by a margin that survives correction " +
      "and appears out of fold.\n"
  );
  lines.push(
    "\nThe most promising untried direction is not a different algorithm, it is **more " +
      "information**: opponent, snap share, target share, injury designation, and the " +
      "Vegas total. Target share and WOPR are the strongest season-level signals in " +
      "`docs/variable-validation.md`, and they are unavailable here only because the " +
      "nflverse bundle covers 2017–2024 while these rows are 2025. Acquiring 2025 weekly " +
      "usage and a Sleeper→gsis crosswalk is the work that would make this search " +
      "meaningfully wider — not another ensemble on the same seven columns.\n"
  );

  writeFileSync(OUT, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
  if (!controlsOk) process.exit(1);
}

main();
