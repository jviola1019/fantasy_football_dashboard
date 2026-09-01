import type { ReliabilityBin } from "@/lib/stats/distribution";

/**
 * Turn a calibration curve into a sentence a person could act on.
 *
 * S5. `ReliabilityDiagram` announced itself as *"Reliability diagram: observed
 * frequency vs mean forecast probability"* — a description of the AXES. It was
 * identical whether the forecaster was perfectly calibrated, wildly
 * over-confident, or had no data at all, so it carried exactly zero bits about
 * the thing the chart exists to show. Worse, `role="img"` made the subtree
 * presentational, so the per-point `<title>` elements reporting each bin's
 * forecast, observed frequency and n were unreachable too.
 *
 * The sign convention is the one that matters and is easy to state backwards, so
 * it is stated here once: **gap = observed − forecast**.
 *
 *   gap > 0  the event happened MORE often than forecast → under-confident
 *   gap < 0  the event happened LESS often than forecast → over-confident
 *
 * The headline number is the n-weighted mean absolute gap. That is the
 * Estimated Calibration Error over the bins supplied, and it is called that
 * rather than something vaguer because it is what it is — but note it is
 * computed from the bins handed in, so it inherits their binning. It is not an
 * independent estimate and must not be presented as validation of anything;
 * `docs/calibration.md` holds the measured results that are.
 */
export function describeReliability(bins: ReliabilityBin[] | undefined): string {
  if (!bins || bins.length === 0) {
    return "Reliability diagram. No backtest has been run, so there is nothing plotted — the chart shows an empty grid rather than an implied result.";
  }

  const total = bins.reduce((s, b) => s + b.n, 0);
  if (total === 0) {
    return "Reliability diagram. Every bin is empty, so no calibration can be read from it.";
  }

  // n-weighted, so a bin holding three forecasts cannot outvote one holding
  // three hundred. An unweighted mean over bins is the usual mistake here.
  const weightedAbs = bins.reduce((s, b) => s + b.n * Math.abs(b.observedFreq - b.meanForecast), 0) / total;
  const weightedSigned = bins.reduce((s, b) => s + b.n * (b.observedFreq - b.meanForecast), 0) / total;

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const direction =
    Math.abs(weightedSigned) < 0.01
      ? "with no consistent direction to the error"
      : weightedSigned > 0
        ? `and skews under-confident overall: outcomes occurred ${pct(weightedSigned)} more often than forecast`
        : `and skews over-confident overall: outcomes occurred ${pct(-weightedSigned)} less often than forecast`;

  const perBin = bins
    .map(
      (b) =>
        `forecast ${pct(b.meanForecast)} observed ${pct(b.observedFreq)} (n=${b.n})`
    )
    .join("; ");

  return (
    `Reliability diagram over ${bins.length} bin${bins.length === 1 ? "" : "s"} and ` +
    `${total} forecast${total === 1 ? "" : "s"}. Mean absolute gap between observed and ` +
    `forecast frequency is ${pct(weightedAbs)}, ${direction}. ` +
    `Points on the dashed diagonal are perfectly calibrated. By bin: ${perBin}.`
  );
}
