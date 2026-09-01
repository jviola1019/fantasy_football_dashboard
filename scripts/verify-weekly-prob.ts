#!/usr/bin/env npx tsx
/**
 * Prove the shipped weekly-probability constants are what the data produces.
 *
 * A frozen coefficient is a claim about a dataset that nobody can check by
 * reading it. `OPPORTUNITY_WEIGHT = 0.7613` had exactly this shape, and the only
 * thing standing between it and a typo was that somebody remembered the number.
 * This script removes the remembering.
 *
 * It refits from the committed snapshot and asserts, for every position:
 *
 *   1. THE INPUT IS THE SAME DATA. The row fingerprint still reads `bba1d103`,
 *      the value `docs/brier-results.md` was written against. A different
 *      fingerprint means the snapshot changed and every number below describes
 *      rows that no longer exist.
 *   2. THE COEFFICIENTS REPRODUCE. Refitting yields the shipped intercept and
 *      coefficient to 1e-9.
 *   3. THE PUBLISHED SKILL REPRODUCES. The out-of-fold Brier and ECE match both
 *      the frozen constants AND the values printed in `docs/brier-results.md`,
 *      which are parsed out of that file rather than retyped here — so the doc
 *      and the code cannot drift apart without this failing.
 *   4. THE MODEL IS ORDERED. P(clear) increases with the projection at every
 *      position. A negative coefficient would be a fitting bug that every
 *      aggregate metric above could still absorb.
 *
 * RUNNING
 *   npm run verify:weekly-prob
 */
import { readFileSync } from "node:fs";
import {
  WEEKLY_PROB_MODELS,
  WEEKLY_PROB_PROVENANCE,
  weeklyStartProbability,
  type WeeklyPosition
} from "../src/lib/models/weeklyProbability";
import { fitAll, readSnapshot, POSITIONS, THRESHOLDS } from "./fit-weekly-prob";
import { fingerprintRows, prospectiveRowKey } from "../src/lib/stats/fingerprint";

const COEF_TOL = 1e-9;
/** The doc rounds to 4 decimals, so it can only be compared at that precision. */
const DOC_TOL = 5e-5;

const failures: string[] = [];
const checks: string[] = [];

function check(ok: boolean, message: string): void {
  if (ok) checks.push(`PASS  ${message}`);
  else failures.push(`FAIL  ${message}`);
}

/**
 * Pull the published Brier and ECE for a position out of `docs/brier-results.md`.
 *
 * Parsed rather than retyped so this cannot pass against a stale doc. The doc's
 * per-position section is `## QB`, and the calibration model's rows are inside
 * `### Calibration model`.
 */
function publishedMetrics(doc: string, pos: WeeklyPosition): { brier: number; ece: number } | null {
  const section = new RegExp(`\\n## ${pos}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(doc);
  if (!section) return null;
  const calib = /### Calibration model[\s\S]*?(?=\n### |\n## |$)/.exec(section[1]!);
  if (!calib) return null;
  const brier = /\|\s*\*\*Brier\*\*\s*\|\s*([0-9.]+)\s*\|/.exec(calib[0]);
  const ece = /\|\s*\*\*ECE\*\*\s*\|\s*([0-9.]+)\s*\|/.exec(calib[0]);
  if (!brier || !ece) return null;
  return { brier: Number(brier[1]), ece: Number(ece[1]) };
}

function main(): void {
  const snapshot = readSnapshot();
  const fingerprint = fingerprintRows(snapshot.rows.map(prospectiveRowKey));
  // Newlines normalised: this repository is checked out with CRLF on Windows,
  // and every regex below anchors on a bare "\n##". Without this the parse
  // silently matched nothing and the doc/code agreement went unchecked -- a
  // check that cannot see its input reports success.
  const doc = readFileSync(WEEKLY_PROB_PROVENANCE.results, "utf8")
    .replace(/\r\n/g, "\n");

  console.log(`verify:weekly-prob`);
  console.log(`  snapshot   ${WEEKLY_PROB_PROVENANCE.snapshot}`);
  console.log(`  captured   ${snapshot.capturedAt}`);
  console.log(`  rows       ${snapshot.rows.length}`);
  console.log(`  fingerprint ${fingerprint}\n`);

  check(
    fingerprint === WEEKLY_PROB_PROVENANCE.fingerprint,
    `input fingerprint is ${WEEKLY_PROB_PROVENANCE.fingerprint} (got ${fingerprint})`
  );
  check(
    snapshot.rows.length === WEEKLY_PROB_PROVENANCE.totalRows,
    `snapshot holds ${WEEKLY_PROB_PROVENANCE.totalRows} rows (got ${snapshot.rows.length})`
  );

  const fits = fitAll(snapshot);
  check(fits.length === POSITIONS.length, `all ${POSITIONS.length} positions fitted (got ${fits.length})`);

  for (const fit of fits) {
    const pos = fit.position as WeeklyPosition;
    const shipped = WEEKLY_PROB_MODELS[pos];
    if (!shipped) {
      failures.push(`FAIL  ${pos}: fitted from the snapshot but not shipped`);
      continue;
    }

    check(shipped.threshold === THRESHOLDS[pos], `${pos}: threshold ${THRESHOLDS[pos]}`);
    check(
      Math.abs(shipped.intercept - fit.intercept) < COEF_TOL,
      `${pos}: intercept reproduces (shipped ${shipped.intercept}, refit ${fit.intercept})`
    );
    check(
      Math.abs(shipped.coefficient - fit.coefficient) < COEF_TOL,
      `${pos}: coefficient reproduces (shipped ${shipped.coefficient}, refit ${fit.coefficient})`
    );
    check(
      Math.abs(shipped.oofBrier - fit.oofBrier) < COEF_TOL,
      `${pos}: out-of-fold Brier reproduces (${shipped.oofBrier.toFixed(6)})`
    );
    check(
      Math.abs(shipped.oofEce - fit.oofEce) < COEF_TOL,
      `${pos}: out-of-fold ECE reproduces (${shipped.oofEce.toFixed(6)})`
    );
    check(shipped.n === fit.n, `${pos}: n = ${fit.n}`);
    check(
      shipped.reliabilityBins.length === fit.reliabilityBins.length,
      `${pos}: ${fit.reliabilityBins.length} reliability bins`
    );

    // The doc is the published claim; the constants are what ships. They must agree.
    const pub = publishedMetrics(doc, pos);
    if (!pub) {
      failures.push(`FAIL  ${pos}: could not parse Brier/ECE out of ${WEEKLY_PROB_PROVENANCE.results}`);
    } else {
      check(
        Math.abs(pub.brier - shipped.oofBrier) < DOC_TOL,
        `${pos}: shipped Brier matches the published ${pub.brier}`
      );
      check(
        Math.abs(pub.ece - shipped.oofEce) < DOC_TOL,
        `${pos}: shipped ECE matches the published ${pub.ece}`
      );
    }

    // Monotone in the projection. A sign error here would leave every aggregate
    // metric above looking plausible while the model ranked players backwards.
    const lo = weeklyStartProbability(pos, 0)!;
    const mid = weeklyStartProbability(pos, shipped.threshold)!;
    const hi = weeklyStartProbability(pos, shipped.threshold * 2)!;
    check(
      lo < mid && mid < hi,
      `${pos}: P(clear) increases with the projection (${(lo * 100).toFixed(1)}% -> ${(mid * 100).toFixed(1)}% -> ${(hi * 100).toFixed(1)}%)`
    );
  }

  for (const line of checks) console.log(line);
  if (failures.length > 0) {
    console.error("");
    for (const line of failures) console.error(line);
    console.error(
      `\nverify:weekly-prob FAILED — ${failures.length} of ${checks.length + failures.length} checks. ` +
        `The shipped constants no longer describe the committed data; do NOT ship this.`
    );
    process.exit(1);
  }
  console.log(`\nverify:weekly-prob: ${checks.length}/${checks.length} checks passed.`);
}

main();
