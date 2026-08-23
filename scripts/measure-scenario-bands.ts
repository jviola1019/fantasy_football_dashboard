/**
 * P0-4 reproduction: what do the season-simulation "confidence bands" actually
 * measure, and how wide are they next to the model's MEASURED error?
 *
 * The claim under test (audit 2026-08-22, P0-4): the bands are labelled as a
 * confidence interval but are computed by re-running the SAME model on the SAME
 * inputs under different seeds, so they can only ever measure Monte-Carlo
 * replication noise. If that is right, their width should be a small fraction
 * of the model's measured calibration error — which would make them an
 * uncertainty display that systematically understates uncertainty.
 *
 * This script measures both numbers and prints them side by side. It is a
 * DIAGNOSTIC: it fixes nothing and decides nothing on its own.
 *
 * Run: npx tsx scripts/measure-scenario-bands.ts
 */
import { fixtureEnvelope } from "../src/lib/fixtures";
import { deriveAppData } from "../src/lib/envelope/derive";

/** Measured out-of-sample calibration error of the shipped chain. */
const MEASURED_ECE = {
  shippedChain: 0.1613, // reports/2026-08-20/AUDIT-LEDGER.md
  protocol2: 0.1704 // reports/2026-08-20/holdout-protocol-2.md
};

function main() {
  const env = fixtureEnvelope();
  const { sim, replicationRange: bands } = deriveAppData(env);
  if (!bands) throw new Error("no bands - fixture roster is empty");
  const rows = [
    { label: "Playoffs", point: sim.playoffProbability, ci: bands.playoff },
    { label: "Championship", point: sim.championshipProbability, ci: bands.championship }
  ];

  console.log("=== What the band measures ===");
  console.log("deriveReplicationRange re-runs the SAME model on the SAME inputs");
  console.log("across 20 seeds. Every source of error except the pseudo-random");
  console.log("draw is held fixed, so the spread is replication noise alone.\n");

  console.log("metric        point     band [lo - hi]        width(pp)");
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(13)} ${r.point.toFixed(2).padStart(6)}    ` +
        `[${r.ci.lower.toFixed(2)} - ${r.ci.upper.toFixed(2)}]`.padEnd(22) +
        `${r.ci.width.toFixed(3).padStart(8)}`
    );
  }

  console.log("\n=== Does the band contain the number it is drawn around? ===");
  // Found while reproducing P0-4. The displayed POINT comes from one run at
  // SIM_BASE.iterations; the BAND is bootstrapped over 20 replicates at a
  // different, smaller iteration count. They are two different estimators, so
  // nothing makes the interval contain the estimate it is printed next to —
  // and in the fixture league it does not.
  let broken = 0;
  for (const r of rows) {
    const inside = r.point >= r.ci.lower && r.point <= r.ci.upper;
    if (!inside) broken += 1;
    console.log(
      `${r.label.padEnd(13)} point ${r.point.toFixed(2).padStart(6)} ` +
        `${inside ? "IS" : "IS NOT"} inside [${r.ci.lower.toFixed(2)} - ${r.ci.upper.toFixed(2)}]`
    );
  }
  console.log(
    broken > 0
      ? `\n${broken} of ${rows.length} displayed intervals EXCLUDE their own point estimate.`
      : "\nAll intervals contain their point estimate."
  );

  console.log("\n=== Against the model's MEASURED error ===");
  for (const [name, ece] of Object.entries(MEASURED_ECE)) {
    console.log(`${name.padEnd(14)} ECE = ${(ece * 100).toFixed(2)}pp`);
  }
  const widest = Math.max(...rows.map((r) => r.ci.width));
  const ecePp = MEASURED_ECE.shippedChain * 100;
  console.log(
    `\nwidest band = ${widest.toFixed(3)}pp · measured ECE = ${ecePp.toFixed(2)}pp ` +
      `→ the band is ${(ecePp / Math.max(widest, 1e-9)).toFixed(1)}x too narrow ` +
      `to represent the error we have actually measured.`
  );

  console.log(
    "\nThe widen() multipliers applied for degraded/unavailable data (1.5x and\n" +
      "2.5x) do not close that gap and are not derived from any measurement."
  );
}

main();
