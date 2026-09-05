/**
 * Area under the ROC curve, by the Mann–Whitney identity.
 *
 * WHY IT BELONGS BESIDE BRIER RATHER THAN INSTEAD OF IT. Brier answers "are the
 * probabilities right"; AUC answers "is the ORDER right". They come apart in
 * exactly the case this product cares about: a model can be perfectly ranked and
 * badly calibrated, or perfectly calibrated and useless for choosing between two
 * players. `docs/weekly-prob-baselines.md` already turns on that distinction —
 * the shipped weekly model is monotone in its own input, so its AUC is
 * effectively the projection's and its entire contribution is calibration.
 * Reporting only Brier would hide that; reporting only AUC would hide the
 * calibration that is the model's whole point.
 *
 * WHY MANN–WHITNEY RATHER THAN TRAPEZOIDS UNDER A CURVE. AUC is identically the
 * probability that a randomly chosen positive outranks a randomly chosen
 * negative. Computing it as a rank statistic is exact, needs no threshold grid,
 * and — the part that matters here — handles TIES correctly by construction:
 * tied scores contribute exactly one half, which is what a model that cannot
 * separate two rows deserves. A trapezoid implementation has to special-case
 * ties and usually gets them slightly wrong.
 *
 * Returns NaN when one class is absent, because AUC is undefined there. Not 0.5:
 * a model evaluated on all-positives has not achieved coin-flip discrimination,
 * it has been handed a question with no answer, and 0.5 would let that pass
 * silently into a report.
 */

export function rocAuc(scores: readonly number[], outcomes: readonly (0 | 1)[]): number {
  if (scores.length !== outcomes.length) {
    throw new Error(`rocAuc: ${scores.length} scores and ${outcomes.length} outcomes`);
  }
  const n = scores.length;
  let positives = 0;
  for (const o of outcomes) positives += o;
  const negatives = n - positives;
  if (positives === 0 || negatives === 0) return Number.NaN;

  // Midranks: tied scores share the average of the ranks they span, which is
  // what makes a tie worth exactly half a correct ordering.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a]! - scores[b]!);
  const rank = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1]!]! === scores[order[i]!]!) j += 1;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) rank[order[k]!] = mid;
    i = j + 1;
  }

  let rankSumPositive = 0;
  for (let k = 0; k < n; k += 1) if (outcomes[k] === 1) rankSumPositive += rank[k]!;

  return (rankSumPositive - (positives * (positives + 1)) / 2) / (positives * negatives);
}
