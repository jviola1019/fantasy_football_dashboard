# Frozen protocol 7 — do trees and boosting beat the logistic, and is it the model or the features?

**Date frozen** 2026-08-25 · **Status** FROZEN BEFORE ANY MODEL IS FITTED OR ANY
METRIC COMPUTED

Written and committed **before** `trees.ts`, `weeklyFeatures.ts` or
`holdout-evaluate-7.ts` exist.

---

## 0. First, correcting the premise this protocol was requested under

The request was *"all of the Brier and statistical outputting looks worse than
random"*. Measured against climatology (always forecast the base rate) on the
committed snapshot, that is true of **one** model and **one** document, not of
all of them:

| position | n | AUC | logistic Brier | climatology | Brier Skill Score |
|---|---|---|---|---|---|
| QB | 512 | 0.630 | 0.2368 | 0.2458 | **+3.7%** |
| RB | 876 | 0.770 | 0.1969 | 0.2497 | **+21.2%** |
| WR | 1,470 | 0.750 | 0.2036 | 0.2498 | **+18.5%** |
| TE | 715 | 0.744 | 0.2059 | 0.2499 | **+17.6%** |

RB, WR and TE beat climatology by 17–21% with AUC 0.74–0.77. That is real
discrimination, not noise.

What **is** at or below random:

- **The QB rank→prob discrimination model**: Brier 0.2716 against climatology's
  0.2458 — worse than forecasting the base rate every week. `brier-results.md`
  already says so in its caveat.
- **QB generally**: AUC 0.630 and BSS +3.7% is barely better than a coin.
- **`docs/season-calibration.md`**: playoff Brier 0.0770 and championship 0.0855
  are **synthetic self-consistency** — the simulator scored against outcomes
  drawn from its own distribution. The document states this plainly and the
  real-data backtest section reads *"No real-data backtest run."* Those numbers
  are not evidence about the NFL, and no skill claim should rest on them.
- **Protocols 1–3**: refuted and disclosed as refuted.

So the honest framing for this protocol is not "everything is broken". It is:
**QB is weak, the season sim is unvalidated against reality, and the weekly
model has been asked to work from a single feature.**

## 1. The question

The calibration model's only input is `proj_pts_ppr`
(`brier-backtest.ts:buildLogisticCalibration` — `X = posRows.map(r => [r.proj_pts_ppr])`).

A decision tree, a random forest and a gradient-boosted ensemble on that one
feature are all approximating the same monotone one-dimensional function
P(outcome | projection). A logistic curve is close to the right parametric shape
for it. **Swapping model class alone should therefore change almost nothing, and
if it does, that is more likely variance than skill.**

> **Does adding causal, pre-game features beat the single-feature logistic — and
> when it does, is the gain attributable to the FEATURES or to the MODEL CLASS?**

Answering the second half requires a logistic fitted on the same expanded
features. Without that arm, a boosting win cannot be attributed, and "we tried
boosting and it won" would be an unfalsifiable claim about the wrong thing.

## 2. Data — inherited, frozen, unchanged

`reports/2026-08-20/brier-prospective.json.gz`, input fingerprint **`bba1d103`**
over **3,573** rows, captured 2026-08-23T19:39:27.895Z. Season 2025, 17 weeks.

Thresholds unchanged: **QB ≥ 18, RB ≥ 10, WR ≥ 8, TE ≥ 6** PPR.
Outcome unchanged: `actual_pts_ppr >= threshold`. DNP rows keep their existing
treatment (scored 0, no survivorship filter).

Nothing about the data is re-chosen. Reusing the existing snapshot and thresholds
verbatim means a difference in the result cannot be a difference in the data.

## 3. Features — and the leakage rule that governs them

Every feature is computed from **weeks strictly earlier than the scored week**.
A player's row in week *w* may use weeks 1…*w*−1 and nothing else. This is
declared before the feature builder exists, because a "rolling" feature computed
over the full season is the single easiest way to manufacture a result.

| # | feature | causal? |
|---|---|---|
| 1 | `proj_pts_ppr` | the projection itself, pre-game |
| 2 | projection rank within (position, week) | same-week projections only, no outcomes |
| 3 | projection z-score within (position, week) | same-week projections only |
| 4 | mean `actual_pts_ppr` over weeks < w | prior outcomes only |
| 5 | sd of `actual_pts_ppr` over weeks < w | prior outcomes only |
| 6 | prior hit rate vs the position threshold | prior outcomes only |
| 7 | mean projection error (`actual − proj`) over weeks < w | prior outcomes only |
| 8 | sd of that error | prior outcomes only |
| 9 | count of prior appearances | structural |
| 10 | count of prior DNPs | prior outcomes only |
| 11 | week index | structural |

Features 7 and 8 carry the substantive hypothesis: **Sleeper's projections may be
systematically biased per player**, and a model that has seen a player beat his
projection four times running should say something different from one that has
only seen the projection.

Week 1 has no history. Features 4–10 are therefore undefined for it. They are
filled with the **position-level prior mean** and flagged by feature 9 = 0, so
the model can learn to discount them, rather than being dropped — dropping week 1
would change the evaluation set between arms and make the comparison invalid.

## 4. Models — four arms, hyperparameters fixed now

| arm | model | why it is here |
|---|---|---|
| **A** | logistic, feature 1 only | the shipped baseline, reproduced exactly |
| **B** | logistic, features 1–11 | isolates the FEATURE contribution |
| **C** | random forest | variance-reduction ensemble, no boosting |
| **D** | gradient-boosted trees | the model class the request asked for |

Hyperparameters, fixed **a priori** and not tuned against the evaluation:

- **C:** 200 trees, `maxDepth` 6, `minSamplesLeaf` 8, `sqrt(p)` features per
  split, bootstrap sampling, seed 20260825.
- **D:** 300 rounds, `learningRate` 0.05, `maxDepth` 3, `minSamplesLeaf` 10, L2
  leaf regularisation 1.0, row subsample 0.8, seed 20260825.

Shallow and heavily regularised on purpose: the smallest position has 512 rows,
and a deep ensemble on 11 features would fit noise. **No hyperparameter search.**
If these settings lose, the honest report is that these settings lose — not that
some other setting might have won.

All randomness comes from the repo's seeded `mulberry32`. Two runs must produce
byte-identical output; the harness asserts this.

## 5. Evaluation — identical across arms

**Leave-one-week-out**, exactly as arm A already uses: train on all other weeks,
predict the held-out week, score the pooled out-of-fold predictions. Every arm
sees the same folds, the same rows and the same outcomes.

Per position and pooled:

- **Primary:** Brier score, and Brier Skill Score against climatology.
- **Secondary:** Expected Calibration Error, 10 equal-count bins.
- **Diagnostic:** AUC, and the Murphy decomposition already in use.

Uncertainty: **cluster bootstrap on `player_id`**, 2,000 resamples, the same
method protocol 6 used, because rows from one player are not independent.

## 6. Decision rule — declared before any number exists

For each position, arm X beats arm A only if **both** hold:

1. ΔBrier = Brier(X) − Brier(A) is negative, and its 95% cluster-bootstrap
   confidence interval **excludes zero**;
2. the effect survives **Holm–Bonferroni** across the 12 comparisons
   (4 positions × 3 arms), at family-wise α = 0.05.

Attribution is decided as follows, and this mapping is fixed now:

| pattern | conclusion |
|---|---|
| B beats A, and D ≈ B | **the features did the work.** Ship the features on the logistic; trees add nothing. |
| D beats B, and B beats A | features help, and the tree captures interactions the linear form cannot. |
| D beats A but B does not | suspicious — a non-linear gain with no linear component on 512–1,470 rows. Report as **not established** pending more data. |
| nothing beats A | **the single-feature logistic is the right model.** Say so and stop. |

The last row is a real possible outcome and is pre-committed as such. A protocol
that cannot return "your existing model was already the best one" is not a test.

## 7. What this cannot answer

- **One season, one projection source.** 2025 Sleeper only. Nothing here
  generalises to another season or another projection provider, and no result
  will be described as though it does.
- **QB has 512 rows.** With a base rate near 0.44 that is roughly 223 positives.
  A 2-point Brier improvement is not detectable at that size, so a null result
  for QB is uninformative rather than reassuring, and will be reported that way.
- **It does not touch the season simulator.** The playoff/championship
  probabilities remain validated only against themselves. Fixing that needs real
  completed-season outcomes, which is a separate protocol and a separate data
  acquisition.
- **It does not make QB's rank→prob model acceptable.** That model is worse than
  climatology and this protocol does not repair it; if the calibration arm wins,
  the rank model should be retired from the QB report rather than defended.

## 8. Pre-commitments

- No arm is added, removed or re-specified after seeing a number.
- No hyperparameter is changed after seeing a number.
- No feature is added after seeing a number. Features 1–11 are the set.
- The harness ships a `--self-test` that checks its own arithmetic (tree fitting,
  gradient computation, bootstrap) against hand-computed cases **before** it is
  pointed at the real data.
- If the result is "nothing beats the baseline", that is the reported result and
  the code is deleted rather than kept as an unused alternative.
