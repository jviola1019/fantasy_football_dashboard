/**
 * Reproduce the measurement behind `RECEPTION_NEUTRAL_POSITIONS`.
 *
 * `src/lib/leagues/scoringPoints.ts` permits ONE cross-format substitution: for
 * positions whose projection is identical in PPR, half-PPR and standard, because
 * reception scoring is the only difference between the formats and those
 * positions are not credited with receptions.
 *
 * That is a factual claim about live Sleeper data, so it has to be checkable
 * rather than asserted. This script re-measures it and FAILS if the claim stops
 * holding — i.e. if a nominally reception-neutral position starts showing a
 * PPR/STD gap, the substitution is no longer lossless and the constant is wrong.
 *
 *   npx tsx scripts/check-projection-units.ts [season] [week]
 *
 * Live network. Exits non-zero on violation so it can gate CI if wired up.
 */
import {
  fetchSleeperWeeklyProjections,
  PROJECTION_POSITIONS,
  type SleeperProjectionPosition
} from "../src/lib/sleeper/projections";
import { RECEPTION_NEUTRAL_POSITIONS } from "../src/lib/leagues/scoringPoints";

/** A gap this small is float noise, not reception scoring. */
const EPSILON = 1e-9;

interface PositionStats {
  position: SleeperProjectionPosition;
  rows: number;
  pprEqStd: number;
  meanGap: number;
  maxGap: number;
  missingPpr: number;
  missingHalf: number;
  missingStd: number;
}

function summarise(
  position: SleeperProjectionPosition,
  rows: Array<{ stats: { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number } }>
): PositionStats {
  let n = 0;
  let pprEqStd = 0;
  let gapSum = 0;
  let maxGap = 0;
  let missingPpr = 0;
  let missingHalf = 0;
  let missingStd = 0;

  for (const row of rows) {
    const { pts_ppr: ppr, pts_half_ppr: half, pts_std: std } = row.stats;
    if (ppr == null && half == null && std == null) continue;
    n++;
    if (ppr == null) missingPpr++;
    if (half == null) missingHalf++;
    if (std == null) missingStd++;
    if (ppr != null && std != null) {
      const gap = Math.abs(ppr - std);
      gapSum += gap;
      if (gap > maxGap) maxGap = gap;
      if (gap < EPSILON) pprEqStd++;
    }
  }

  return {
    position,
    rows: n,
    pprEqStd,
    meanGap: n > 0 ? gapSum / n : 0,
    maxGap,
    missingPpr,
    missingHalf,
    missingStd
  };
}

async function main(): Promise<void> {
  const season = process.argv[2] ?? "2025";
  const week = Number(process.argv[3] ?? 8);
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    console.error(`week must be an integer 1-18, got ${process.argv[3]}`);
    process.exit(2);
  }

  console.log(`Sleeper projections ${season} week ${week} — PPR/HALF/STD divergence by position\n`);

  const { byPosition, failures } = await fetchSleeperWeeklyProjections({ season, week });
  for (const f of failures) {
    console.error(`  fetch failed: ${f.position} — ${f.reason}`);
  }
  if (byPosition.size === 0) {
    console.error("no positions fetched — cannot measure. Treating as UNKNOWN, not PASS.");
    process.exit(2);
  }

  const header =
    "position | rows | ppr==std | mean |ppr-std| | max |ppr-std| | missing ppr/half/std | neutral?";
  console.log(header);
  console.log("-".repeat(header.length));

  const violations: string[] = [];
  for (const position of PROJECTION_POSITIONS) {
    const rows = byPosition.get(position);
    if (!rows) continue;
    const s = summarise(position, rows);
    const declaredNeutral = RECEPTION_NEUTRAL_POSITIONS.includes(position);
    const measuredNeutral = s.rows > 0 && s.maxGap < EPSILON;

    console.log(
      `${s.position.padEnd(8)} | ${String(s.rows).padStart(4)} | ${String(s.pprEqStd).padStart(8)} | ` +
        `${s.meanGap.toFixed(4).padStart(15)} | ${s.maxGap.toFixed(4).padStart(14)} | ` +
        `${`${s.missingPpr}/${s.missingHalf}/${s.missingStd}`.padStart(20)} | ` +
        `${declaredNeutral ? "declared" : "-"}${measuredNeutral ? " measured" : ""}`
    );

    // The violation that matters: we declare a position safe to substitute
    // across formats, but the data says the formats differ for it. That would
    // make substitution a silent unit change.
    if (declaredNeutral && !measuredNeutral) {
      violations.push(
        `${position}: declared reception-neutral but max |ppr-std| = ${s.maxGap.toFixed(4)} over ${s.rows} rows`
      );
    }
    // The reverse is not a violation — declaring a position reception-scoring
    // when it happens to be neutral is merely conservative.
  }

  console.log();
  if (violations.length > 0) {
    console.error("VIOLATION — RECEPTION_NEUTRAL_POSITIONS is no longer supported by the data:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nCross-format substitution in selectProjectionForFormat would now change the unit.\n" +
        "Remove the offending position from RECEPTION_NEUTRAL_POSITIONS."
    );
    process.exit(1);
  }
  console.log("PASS — every declared reception-neutral position has identical PPR and STD values.");
}

main().catch((err) => {
  console.error("check:projection-units failed:", err);
  process.exit(2);
});
