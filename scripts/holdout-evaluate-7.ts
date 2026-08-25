/**
 * Protocol 7 — do trees and boosting beat the logistic, and is it the model or
 * the features?
 *
 * Executes reports/2026-08-25/holdout-protocol-7.md, which was frozen and
 * committed BEFORE this file existed. Nothing here is re-chosen: the data, the
 * thresholds, the eleven features, the four arms, every hyperparameter, the
 * evaluation and the decision rule are all fixed there.
 *
 *   npx tsx scripts/holdout-evaluate-7.ts --self-test
 *   npx tsx scripts/holdout-evaluate-7.ts
 *
 * The self-test checks this harness's own arithmetic against hand-computed
 * cases before it is pointed at real data — protocol 7 §8. Every other harness
 * in this audit has one, for the reason catalogued a dozen times over: a
 * measurement that silently computes the wrong thing looks exactly like a
 * measurement.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fitLogisticCV } from "../src/lib/stats/logistic";
import { brierScore, expectedCalibrationError } from "../src/lib/stats/distribution";
import type { BrierForecast } from "../src/lib/stats/distribution";
import {
  fitGradientBoosting,
  fitOutOfFold,
  fitRandomForest,
  predictBoostedProba,
  predictForestProba
} from "../src/lib/models/trees";
import { buildFeatures, projectionOnly, FEATURE_NAMES, type WeeklyRow } from "../src/lib/models/weeklyFeatures";
import { clusterBootstrap, holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { mulberry32 } from "../src/lib/rng";

const SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";
const EXPECTED_FINGERPRINT = "bba1d103";
const THRESHOLDS = { QB: 18, RB: 10, WR: 8, TE: 6 } as const;
type Pos = keyof typeof THRESHOLDS;
const POSITIONS = Object.keys(THRESHOLDS) as Pos[];

const SEED = 20260825;
const BOOTSTRAP_RESAMPLES = 2000;
const ALPHA = 0.05;

/** Protocol 7 §4 — fixed a priori, not tuned. */
const FOREST = { trees: 200, maxDepth: 6, minSamplesLeaf: 8, lambda: 1.0, seed: SEED };
const BOOST = {
  rounds: 300,
  learningRate: 0.05,
  maxDepth: 3,
  minSamplesLeaf: 10,
  lambda: 1.0,
  subsample: 0.8,
  seed: SEED
};

/* ------------------------------------------------------------------ */

function fingerprintRows(keys: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const key of [...keys].sort()) {
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

function loadRows(): WeeklyRow[] {
  const snap = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString()) as { rows: WeeklyRow[] };
  const rows = snap.rows;
  // The SAME key construction brier-backtest.ts uses, including the values --
  // player/week alone would not notice a projection or outcome changing under
  // the same row set, which is exactly the kind of drift this guard is for.
  const fp = fingerprintRows(
    rows.map((r) => `${r.player_id}|${r.week}|${r.proj_pts_ppr}|${r.actual_pts_ppr}`)
  );
  if (fp !== EXPECTED_FINGERPRINT) {
    console.error(
      `holdout-7: snapshot fingerprint ${fp} != protocol's ${EXPECTED_FINGERPRINT}. The input changed; ` +
        "the protocol's numbers would not be comparable. Refusing to run."
    );
    process.exit(1);
  }
  return rows;
}

/** AUC by the concordant-pair definition, computed by rank to stay O(n log n). */
function auc(probs: readonly number[], y: readonly (0 | 1)[]): number {
  const order = probs.map((p, i) => ({ p, y: y[i]! })).sort((a, b) => a.p - b.p);
  let rank = 1;
  let sumRanksPos = 0;
  let nPos = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.p === order[i]!.p) j += 1;
    const midRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k += 1) {
      if (order[k]!.y === 1) {
        sumRanksPos += midRank;
        nPos += 1;
      }
    }
    rank += j - i + 1;
    i = j + 1;
  }
  const nNeg = order.length - nPos;
  if (nPos === 0 || nNeg === 0) return Number.NaN;
  return (sumRanksPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

const brierOf = (probs: readonly number[], y: readonly (0 | 1)[], idx: readonly number[]): number => {
  let s = 0;
  for (const i of idx) s += (probs[i]! - y[i]!) ** 2;
  return s / idx.length;
};

interface ArmResult {
  arm: string;
  probs: number[];
  brier: number;
  bss: number;
  ece: number;
  auc: number;
}

function evaluateArm(arm: string, probs: number[], y: (0 | 1)[], clim: number): ArmResult {
  const fc: BrierForecast[] = probs.map((p, i) => ({ prob: p, outcome: y[i]! }));
  const brier = brierScore(fc).score;
  const eceRaw = expectedCalibrationError(fc, 10) as number | { ece: number };
  return {
    arm,
    probs,
    brier,
    bss: (1 - brier / clim) * 100,
    ece: typeof eceRaw === "number" ? eceRaw : eceRaw.ece,
    auc: auc(probs, y)
  };
}

/* ------------------------------------------------------------------ */

function selfTest(): void {
  const fails: string[] = [];
  const ok = (name: string, cond: boolean, detail = "") => {
    if (cond) console.log(`  ok   ${name}`);
    else {
      console.log(`  FAIL ${name} ${detail}`);
      fails.push(name);
    }
  };

  // AUC against hand-computed cases.
  ok("auc perfect separation = 1", Math.abs(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]) - 1) < 1e-12);
  ok("auc inverted = 0", Math.abs(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])) < 1e-12);
  ok("auc all-ties = 0.5", Math.abs(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]) - 0.5) < 1e-12);
  // One positive ranked above one of two negatives → 0.5.
  ok("auc mid case", Math.abs(auc([0.1, 0.5, 0.9], [0, 1, 0]) - 0.5) < 1e-12);

  // Brier on a constant forecast equal to the base rate IS the climatology score.
  const y: (0 | 1)[] = [1, 1, 0, 0, 1, 0, 0, 0];
  const base = y.reduce<number>((a, b) => a + b, 0) / y.length;
  const climProbs = y.map(() => base);
  ok(
    "constant base-rate forecast scores p(1-p)",
    Math.abs(brierOf(climProbs, y, y.map((_, i) => i)) - base * (1 - base)) < 1e-12
  );

  // A perfect forecast scores 0; the worst possible scores 1.
  ok("perfect forecast scores 0", brierOf(y.map((v) => v), y, y.map((_, i) => i)) === 0);
  ok("inverted forecast scores 1", brierOf(y.map((v) => 1 - v), y, y.map((_, i) => i)) === 1);

  // The bootstrap must find a planted effect and not find an absent one.
  const clusters = Array.from({ length: 50 }, (_, i) => `p${i}`);
  const planted = clusterBootstrap(clusters, (idx) => idx.length * 0 + 0.05, {
    resamples: 200,
    rand: mulberry32(1)
  });
  ok("bootstrap finds a constant effect", planted.lower > 0);

  const noise = clusters.map((_, i) => (i % 2 === 0 ? 1 : -1));
  const absent = clusterBootstrap(
    clusters,
    (idx) => idx.reduce((s, i) => s + noise[i]!, 0) / idx.length,
    { resamples: 400, rand: mulberry32(2) }
  );
  ok("bootstrap spans zero when there is no effect", absent.lower < 0 && absent.upper > 0);

  // Holm must stop at the first failure.
  const holm = holmBonferroni([
    { id: "a", p: 0.001 },
    { id: "b", p: 0.9 },
    { id: "c", p: 0.04 }
  ]);
  ok("holm stops at the first failure", holm.find((h) => h.id === "c")!.reject === false);

  // The feature builder must not see the future. This is the one that matters.
  const rows: WeeklyRow[] = [
    { player_id: "a", position: "WR", week: 1, proj_pts_ppr: 10, actual_pts_ppr: 12 },
    { player_id: "a", position: "WR", week: 2, proj_pts_ppr: 11, actual_pts_ppr: 4 },
    { player_id: "b", position: "WR", week: 1, proj_pts_ppr: 9, actual_pts_ppr: 3 },
    { player_id: "b", position: "WR", week: 2, proj_pts_ppr: 8, actual_pts_ppr: 14 }
  ];
  const asIs = buildFeatures(rows, 8);
  const flipped = buildFeatures(
    rows.map((r) => (r.week === 2 ? { ...r, actual_pts_ppr: 999 - r.actual_pts_ppr } : r)),
    8
  );
  const week2 = (b: typeof asIs) => JSON.stringify(b.X.filter((_, i) => b.fold[i] === 2));
  ok("features do not leak the scored week's outcome", week2(asIs) === week2(flipped));

  // Determinism: two identical fits must agree exactly.
  const X = Array.from({ length: 120 }, (_, i) => [i, (i * 7) % 11]);
  const yy = Array.from({ length: 120 }, (_, i) => (i < 60 ? 0 : 1) as 0 | 1);
  const m1 = fitGradientBoosting(X, yy, BOOST);
  const m2 = fitGradientBoosting(X, yy, BOOST);
  ok(
    "boosting is deterministic from its seed",
    predictBoostedProba(m1, [30, 2]) === predictBoostedProba(m2, [30, 2])
  );
  const f1 = fitRandomForest(X, yy, { ...FOREST, trees: 20 });
  const f2 = fitRandomForest(X, yy, { ...FOREST, trees: 20 });
  ok("forest is deterministic from its seed", predictForestProba(f1, [30, 2]) === predictForestProba(f2, [30, 2]));

  if (fails.length > 0) {
    console.error(`\nself-test FAILED (${fails.length}): ${fails.join(", ")}`);
    process.exit(1);
  }
  console.log("\nself-test PASSED — the harness computes what it claims to.\n");
}

/* ------------------------------------------------------------------ */

function main(): void {
  const selfOnly = process.argv.includes("--self-test");
  console.log("protocol 7 — trees and boosting vs the logistic\n");
  console.log("self-test:");
  selfTest();
  if (selfOnly) return;

  const rows = loadRows();
  console.log(`snapshot ${SNAPSHOT} — ${rows.length} rows, fingerprint ${EXPECTED_FINGERPRINT}`);
  console.log(`features (${FEATURE_NAMES.length}): ${FEATURE_NAMES.join(", ")}\n`);

  const comparisons: Array<{ id: string; p: number; delta: number; lo: number; hi: number }> = [];

  for (const pos of POSITIONS) {
    const posRows = rows.filter((r) => r.position === pos);
    const built = buildFeatures(posRows, THRESHOLDS[pos]);
    const { X, y, fold, cluster } = built;
    const base = y.reduce<number>((a, b) => a + b, 0) / y.length;
    const clim = base * (1 - base);

    // Arm A — the shipped baseline: logistic on the projection alone.
    const armA = evaluateArm(
      "A logistic (proj only)",
      fitLogisticCV(projectionOnly(built), y, fold, { l2: 1.0 }),
      y,
      clim
    );

    // Arm B — logistic on all eleven features. Isolates the FEATURE effect.
    const armB = evaluateArm("B logistic (11 features)", fitLogisticCV(X, y, fold, { l2: 1.0 }), y, clim);

    // Arm C — random forest.
    const armC = evaluateArm(
      "C random forest",
      fitOutOfFold(X, y, fold, (trX, trY, teX) => {
        const model = fitRandomForest(trX, trY, FOREST);
        return teX.map((x) => predictForestProba(model, x));
      }),
      y,
      clim
    );

    // Arm D — gradient boosting.
    const armD = evaluateArm(
      "D gradient boosting",
      fitOutOfFold(X, y, fold, (trX, trY, teX) => {
        const model = fitGradientBoosting(trX, trY, BOOST);
        return teX.map((x) => predictBoostedProba(model, x));
      }),
      y,
      clim
    );

    console.log(`## ${pos} — n=${y.length}, base rate ${base.toFixed(3)}, climatology Brier ${clim.toFixed(4)}`);
    console.log("   arm                        Brier     BSS%     ECE      AUC");
    for (const a of [armA, armB, armC, armD]) {
      console.log(
        `   ${a.arm.padEnd(26)} ${a.brier.toFixed(4)}   ${a.bss.toFixed(1).padStart(5)}   ${a.ece.toFixed(4)}   ${a.auc.toFixed(3)}`
      );
    }

    // ΔBrier against arm A, with a cluster bootstrap on player_id.
    for (const arm of [armB, armC, armD]) {
      const rand = mulberry32(SEED + arm.arm.charCodeAt(0));
      const ci = clusterBootstrap(
        cluster,
        (idx) => brierOf(arm.probs, y, idx) - brierOf(armA.probs, y, idx),
        { resamples: BOOTSTRAP_RESAMPLES, rand, alpha: ALPHA }
      );
      comparisons.push({
        id: `${pos} ${arm.arm.slice(0, 1)}`,
        p: ci.p,
        delta: ci.point,
        lo: ci.lower,
        hi: ci.upper
      });
      console.log(
        `     Δ vs A: ${ci.point >= 0 ? "+" : ""}${ci.point.toFixed(4)}  95% CI [${ci.lower.toFixed(4)}, ${ci.upper.toFixed(4)}]  p=${ci.p.toFixed(4)}`
      );
    }
    console.log("");
  }

  console.log(`## Holm–Bonferroni across ${comparisons.length} comparisons (family-wise α=${ALPHA})\n`);
  console.log("   comparison   ΔBrier    95% CI              p        threshold  verdict");
  const corrected = holmBonferroni(comparisons.map((c) => ({ id: c.id, p: c.p })), ALPHA);
  for (const h of corrected) {
    const c = comparisons.find((x) => x.id === h.id)!;
    const better = c.delta < 0 && h.reject;
    console.log(
      `   ${h.id.padEnd(12)} ${c.delta >= 0 ? "+" : ""}${c.delta.toFixed(4)}  [${c.lo.toFixed(4)}, ${c.hi.toFixed(4)}]  ${h.p.toFixed(4)}   ${h.threshold.toFixed(4)}     ${
        better ? "BEATS A" : h.reject ? "differs, WORSE" : "no effect"
      }`
    );
  }
  console.log(
    "\nA negative Δ means lower Brier than arm A, i.e. better. Only a negative Δ whose CI" +
      "\nexcludes zero AND survives Holm counts as a win — protocol 7 §6."
  );
}

main();
