/**
 * Strategy B presentation for the season simulation (audit 2026-08-20 §3).
 *
 * The order of information is the whole design:
 *
 *  1. The **league baseline** is the prominent number, because it is the only
 *     trustworthy one. "6 of 10 teams make the playoffs" is arithmetic about the
 *     league, and on the same backtest sample climatology (Brier 0.2400) beat
 *     the model (0.3353).
 *  2. The **model's scenario** appears as a qualitative band relative to that
 *     baseline — never as a standalone percentage, because a one-decimal
 *     percentage from a model with ECE 0.2999 asserts a precision it does not
 *     have, and reads as a forecast when it is a simulated frequency.
 *  3. The **raw simulated frequencies** stay available behind an explicit
 *     disclosure, so nothing is hidden and the output stays auditable
 *     (CLAUDE.md: never hide unavailable data, never remove validation state).
 *
 * Mobile-first: two short text rows, no wide number+interval columns to
 * truncate at 320px.
 */
import { scenarioReading, type ScenarioReading } from "@/lib/models/scenarioBand";
import type { ConfidenceInterval } from "@/lib/stats/distribution";

export interface ScenarioOutlookRow {
  /** "Playoffs", "Championship". */
  label: string;
  /** The simulated frequency under model assumptions, percent. */
  scenarioPct: number;
  /** The structural base rate for this outcome in this league, percent. */
  baselinePct: number;
  /** Monte-Carlo interval for the frequency, when one was computed. */
  interval?: ConfidenceInterval | null;
}

function pct(v: number, dp = 0): string {
  return `${v.toFixed(dp)}%`;
}

function BandRow({ label, reading }: { label: string; reading: ScenarioReading }) {
  return (
    <li className="scenario-row">
      <span className="scenario-row-label">{label}</span>
      <span className="scenario-row-baseline">
        <span className="scenario-row-baseline-val">{pct(reading.baselinePct)}</span>
        <span className="scenario-row-baseline-tag">league baseline</span>
      </span>
      <span className={`scenario-row-band scenario-band-${reading.tone}`}>{reading.label}</span>
    </li>
  );
}

export function ScenarioOutlook({
  rows,
  iterations,
  seed,
  numTeams,
  playoffTeams,
  headingId
}: {
  rows: ScenarioOutlookRow[];
  iterations: number;
  seed: number;
  numTeams: number;
  playoffTeams: number;
  /** id of the heading this group is labelled by, for the disclosure region. */
  headingId?: string;
}) {
  const readings = rows.map((r) => ({
    row: r,
    reading: scenarioReading(r.scenarioPct, r.baselinePct)
  }));

  return (
    <div className="scenario-outlook">
      <ul className="scenario-list" aria-describedby={headingId}>
        {readings.map(({ row, reading }) => (
          <BandRow key={row.label} label={row.label} reading={reading} />
        ))}
      </ul>

      <p className="scenario-explainer">
        The baseline is fixed by league shape: {playoffTeams} of {numTeams} teams make the playoffs
        and one wins. The band is where this roster lands in the simulation, under the model&apos;s
        own assumptions — it is not a measured likelihood.
      </p>

      {/* Progressive disclosure, not concealment: the raw frequencies remain
          reachable by keyboard and are labeled for what they are. */}
      <details className="scenario-raw">
        <summary>Show raw simulated frequencies (uncalibrated)</summary>
        <ul className="ci-list">
          {readings.map(({ row }) => (
            <li className="ci-row" key={row.label}>
              <span>{row.label}</span>
              <b>
                {pct(row.scenarioPct, 1)}
                {row.interval ? (
                  <small className="ci-range">
                    {" "}
                    [{row.interval.lower.toFixed(1)} – {row.interval.upper.toFixed(1)}]
                  </small>
                ) : null}
              </b>
            </li>
          ))}
        </ul>
        <p className="small-note">
          Simulated frequency under model assumptions, not a forecast probability. Seed {seed} ·{" "}
          {iterations.toLocaleString()} simulated seasons. Any interval shown is Monte-Carlo
          sampling error only — it does not include model or input error, and the model&apos;s
          measured calibration error is far larger.
        </p>
      </details>
    </div>
  );
}
