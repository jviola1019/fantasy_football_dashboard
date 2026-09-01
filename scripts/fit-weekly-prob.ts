#!/usr/bin/env npx tsx
/**
 * Fit — and then FREEZE — the weekly start/sit probability model.
 *
 * WHY THIS SCRIPT EXISTS (redesign decision D1)
 * ─────────────────────────────────────────────
 * `docs/brier-results.md` reports a per-position logistic that maps a player's
 * pre-game projected PPR points to P(clears the start threshold), with a
 * measured out-of-fold Brier and Expected Calibration Error. It has been the one
 * model in this repository with a positive, replicated calibration result — and
 * it has never reached a user, because it cannot be fitted at render time:
 * weekly projections are pruned to 14 days and weekly ACTUALS are not stored at
 * all, so `fitLogisticCV` has nothing to learn from in production.
 *
 * So it ships as constants. Fit once, here, from the committed input snapshot;
 * frozen into `src/lib/models/weeklyProbability.ts`; evaluated at render time by
 * `predictLogisticProba`. Same precedent as `OPPORTUNITY_WEIGHT = 0.7613`.
 *
 * TWO DIFFERENT MODELS, AND THE DISTINCTION IS THE WHOLE POINT
 * ────────────────────────────────────────────────────────────
 * The coefficients SHIPPED are fitted on ALL rows for a position. That is what a
 * production model should use — throwing away 4/5 of the evidence to match a
 * cross-validation fold would make the shipped model worse for no reason.
 *
 * The skill REPORTED is the out-of-fold estimate (leave-one-week-out): each
 * row predicted by a model that never saw its week. That is the honest estimate
 * of how the shipped model performs on a week it has not seen, and it is the
 * only number that may be quoted as this model's accuracy.
 *
 * Quoting the full-fit model's in-sample Brier would be reporting how well it
 * memorised, and it would look better. `verify-weekly-prob.ts` re-derives BOTH
 * from the same committed snapshot and fails if either drifts.
 *
 * RUNNING
 *   npx tsx scripts/fit-weekly-prob.ts            # print the constants
 *   npx tsx scripts/fit-weekly-prob.ts --json     # machine-readable
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fitLogistic, fitLogisticCV, predictLogisticProba } from "../src/lib/stats/logistic";
import {
  brierScore,
  expectedCalibrationError,
  type ReliabilityBin
} from "../src/lib/stats/distribution";
import { fingerprintRows, prospectiveRowKey } from "../src/lib/stats/fingerprint";

/** The committed input snapshot every result here replays. */
export const PROSPECTIVE_SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";

/**
 * Start thresholds, copied from `scripts/brier-backtest.ts` and asserted equal
 * to it by `weeklyProbability.test.ts`. Chosen for a roughly even
 * positive/negative split among starters; changing one invalidates every number
 * in `docs/brier-results.md` for that position.
 */
export const THRESHOLDS = { QB: 18, RB: 10, WR: 8, TE: 6 } as const;
export type Position = keyof typeof THRESHOLDS;
export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

/** L2 penalty, matching `buildLogisticCalibration` in the backtest exactly. */
export const L2 = 1.0;

export interface ProspectiveRow {
  kind: "prospective";
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
  played: boolean;
}

export interface ProspectiveSnapshot {
  capturedAt: string;
  season: number;
  weeksLoaded: number;
  dnpCount: number;
  rows: ProspectiveRow[];
}

export function readSnapshot(path = PROSPECTIVE_SNAPSHOT): ProspectiveSnapshot {
  const raw = gunzipSync(readFileSync(path)).toString("utf8");
  const parsed = JSON.parse(raw) as ProspectiveSnapshot;
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error(`${path} has no rows — refusing to fit on nothing.`);
  }
  return parsed;
}


export interface PositionFit {
  position: Position;
  threshold: number;
  n: number;
  weeks: number;
  baseRate: number;
  /** SHIPPED: fitted on every row for this position. */
  intercept: number;
  coefficient: number;
  /** REPORTED: leave-one-week-out estimates. */
  oofBrier: number;
  oofEce: number;
  /** The out-of-fold reliability bins, so the panel plots what was measured. */
  reliabilityBins: ReliabilityBin[];
  /** Always forecasting the base rate — the bar any forecast must clear. */
  climatology: number;
  /** 1 - brier/climatology. <= 0 means the model is worse than a constant. */
  brierSkillScore: number;
}

export function fitPosition(rows: ProspectiveRow[], pos: Position): PositionFit | null {
  const threshold = THRESHOLDS[pos];
  const posRows = rows.filter((r) => r.position === pos);
  if (posRows.length < 20) return null;

  const X = posRows.map((r) => [r.proj_pts_ppr]);
  const y = posRows.map((r) => (r.actual_pts_ppr >= threshold ? 1 : 0));
  const fold = posRows.map((r) => r.week);
  const weeks = new Set(fold).size;
  // Leave-one-week-out needs at least two weeks; with one, `fitLogisticCV`
  // correctly refuses to leak and returns 0.5 for every row, whose ECE is a
  // property of the base rate with the projections nowhere in it (audit P2-2).
  if (weeks < 2) return null;

  const shipped = fitLogistic(X, y, { l2: L2 });
  const oof = fitLogisticCV(X, y, fold, { l2: L2 });

  const forecasts = oof.map((prob, i) => ({ prob, outcome: y[i]! as 0 | 1 }));
  const baseRate = y.reduce<number>((s, v) => s + v, 0) / y.length;
  const oofBrier = brierScore(forecasts).score;
  // Climatology: forecast the base rate for everything. For a Brier score this
  // equals p(1-p), the irreducible uncertainty.
  const climatology = brierScore(y.map((o) => ({ prob: baseRate, outcome: o as 0 | 1 }))).score;
  const ece = expectedCalibrationError(forecasts, 10);

  return {
    position: pos,
    threshold,
    n: posRows.length,
    weeks,
    baseRate,
    intercept: shipped.intercept,
    coefficient: shipped.coefficients[0]!,
    oofBrier,
    oofEce: ece.ece,
    /** The reliability bins the panel plots, straight from the same evaluation. */
    reliabilityBins: ece.bins,
    climatology,
    brierSkillScore: climatology > 0 ? 1 - oofBrier / climatology : 0
  };
}

export function fitAll(snapshot: ProspectiveSnapshot): PositionFit[] {
  return POSITIONS.map((p) => fitPosition(snapshot.rows, p)).filter(
    (f): f is PositionFit => f !== null
  );
}

function main(): void {
  const snapshot = readSnapshot();
  const fits = fitAll(snapshot);
  const fp = fingerprintRows(snapshot.rows.map(prospectiveRowKey));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ fingerprint: fp, capturedAt: snapshot.capturedAt, fits }, null, 2));
    return;
  }

  console.log(`snapshot ${PROSPECTIVE_SNAPSHOT}`);
  console.log(`captured ${snapshot.capturedAt} · ${snapshot.rows.length} rows · fingerprint ${fp}\n`);
  console.log("pos   n     wk  base    intercept    coefficient   oofBrier  oofECE   clim     BSS");
  for (const f of fits) {
    console.log(
      `${f.position.padEnd(5)} ${String(f.n).padEnd(5)} ${String(f.weeks).padEnd(3)} ` +
        `${f.baseRate.toFixed(3)}  ${f.intercept.toFixed(6).padStart(11)}  ` +
        `${f.coefficient.toFixed(6).padStart(11)}   ${f.oofBrier.toFixed(4)}    ` +
        `${f.oofEce.toFixed(4)}   ${f.climatology.toFixed(4)}   ${(f.brierSkillScore * 100).toFixed(1)}%`
    );
  }
  console.log("\nSanity — P(clears threshold) at a few projections:");
  for (const f of fits) {
    const model = { intercept: f.intercept, coefficients: [f.coefficient] };
    const pts = [f.threshold * 0.5, f.threshold, f.threshold * 1.5];
    const probs = pts.map((p) => `${p.toFixed(1)}pts -> ${(predictLogisticProba(model, [p]) * 100).toFixed(1)}%`);
    console.log(`  ${f.position}: ${probs.join("   ")}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  main();
}
