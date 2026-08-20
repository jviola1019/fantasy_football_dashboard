# The points curve — what is assumed, what is measured

**Audit** §6 · **Implementation** [`src/lib/models/pointsCurve.ts`](../src/lib/models/pointsCurve.ts) ·
**Status** experimental candidate, **not** production

This document exists because `pointsCurve.ts` contains a modeling assumption that
is easy to mistake for a finding. Nothing here licenses calling the PAR candidate
calibrated or validated. See [`model-validation-plan.md`](./model-validation-plan.md)
for the protocol that would be required to say either.

---

## 1. The monotonicity constraint is an ASSUMPTION, not an empirical law

The fit imposes:

> expected season points must be **non-increasing** with worse positional draft rank

This is a constraint the model **puts on the data**, not a regularity the data
demonstrates. Said plainly: RB1 is not observed to outscore RB2. The raw data
says the opposite constantly.

Measured on real leagues in the development sample, one league's quarterbacks
finished:

| positional draft rank | QB1 | QB2 | QB3 | QB4 |
|---|---|---|---|---|
| actual season points | 320 | 180 | 114 | **254** |

QB4 outscored QB2 and QB3. Under the constraint, ranks 2–4 are pooled to a single
value. That pooling is the model asserting *the market's ordering is right on
average and this is noise*, which is a belief about drafts, not a measurement of
this sample.

### Why impose it anyway

1. **It is the only structure the data can support.** With a handful of leagues,
   each (position, rank) cell holds a few observations. Per-rank means are
   dominated by which individual player happened to occupy the rank.
2. **Unconstrained fits produce rank inversions**, which downstream code treats
   as real value differences. A curve saying RB4 > RB2 would tell the draft board
   to prefer the later pick, on noise.
3. **The alternative assumptions are stronger.** A moving average assumes a
   smoothness the data has not earned *and* still permits inversions. A
   parametric form (exponential, power-law) assumes a functional shape nobody has
   established for fantasy scoring.

### What would falsify it

A genuinely non-monotone expected-points curve — e.g. a systematic rank range
that outscores an earlier one across many independent leagues and seasons. Under
the current constraint that finding is **unrepresentable**: the fit would flatten
it. Anyone testing for it must fit **without** the constraint and compare, not
read it off this curve. That is a known blind spot, recorded here deliberately.

---

## 2. What loss function is minimized

Weighted least squares subject to the monotone constraint:

$$\min_{\mu_1 \ge \mu_2 \ge \dots \ge \mu_K} \sum_{k=1}^{K} w_k (\bar{y}_k - \mu_k)^2$$

where `ȳ_k` is the weighted mean of observed season points at positional rank
`k`, and `w_k` is the total fitting weight at that rank.

Solved exactly by **pool-adjacent-violators (PAVA)**, implemented in
`isotonicDecreasing`. Properties that matter here:

- It is the **exact** minimizer, not an approximation or an iterative fit.
- It is the maximum-likelihood estimate under the ordering constraint with
  Gaussian errors of equal variance within a rank.
- It has **no hyperparameter** — no bandwidth, no smoothing strength, nothing to
  tune. That is a deliberate defence against the failure mode this audit is
  guarding: with 5 effective clusters, any tunable knob is an invitation to fit
  noise and call it calibration.
- Squared error makes the fit sensitive to outliers. A single 400-point season at
  a rank moves that rank's mean substantially. This is not mitigated, because the
  robust alternatives (median, Huber) all introduce a tuning parameter or lose
  the exact-solution property.

---

## 3. How zero-weight (missing) ranks behave

A rank with no observation — nobody in any pooled league drafted, say, a TE at
positional rank 19 — is handled as:

- **value**: inherits the previous rank's mean (`lastMean`), so the series has no
  hole;
- **weight**: `0`, so it exerts **no** pull on the fit.

The consequences, stated so they cannot surprise anyone reading a PAR number:

1. A missing rank is **interpolation, not evidence**. `expectedPointsAt` will
   return a number for it, and that number is carried forward from the nearest
   populated rank below it.
2. Because PAVA operates on the padded series, a run of missing ranks becomes a
   **flat plateau**. A PAR difference computed across such a plateau is exactly
   zero — which is honest (we have no evidence they differ), but must not be read
   as "these players are measurably equal".
3. Leading missing ranks — rank 1 absent — inherit `lastMean = 0`, giving a
   spurious zero at the top of the curve. In practice rank 1 of every position is
   always drafted, so this has not occurred; it is nonetheless a latent defect,
   recorded rather than assumed away.

---

## 4. Why flat extrapolation beyond the fitted range

`expectedPointsAt` clamps to the last fitted rank rather than extrapolating.

Past the deepest drafted rank the players are waiver-wire fodder who are close to
interchangeable. Linear extrapolation of a decreasing curve would invent large —
and eventually negative — differences between players who are all equally
replaceable, and PAR would then reward reaching for a deep bench player over an
equivalent one. Flat is the assumption that **beyond the data, everyone is the
same**, which is both closer to true and the conservative direction: it can only
compress differences, never manufacture them.

Note this makes PAR **exactly zero** for every player at or past the replacement
rank when that rank sits beyond the fitted range. That is intended.

---

## 5. How uncertainty around each curve is represented

**It is not.** `PositionCurve` is a bare `number[]` per position. There is no
standard error, no interval, no posterior.

This is the most important limitation in this file, and it is why §6 says *do not
expose a falsely precise PAR value from a tiny positional curve*.

Concretely, in the current development sample:

- Each (position, rank) cell holds observations from at most a handful of
  leagues, and after the §5 cluster-weighting each distinct NFL player-season
  contributes total weight 1 — so a rank's effective sample is often **1 or 2**.
- A PAR of "37.4 points above replacement" therefore has a standard error
  plausibly of the same order as the estimate itself.
- Isotonic regression additionally has **non-standard asymptotics**: pooled
  blocks are data-determined, so naive per-rank standard errors are wrong even
  with more data, and the estimator is biased at the boundaries.

### What should be built before any PAR number is quoted with precision

A **cluster bootstrap over whole leagues** (not over rows — rows within a league
are dependent, per §5), refitting the curve on each resample and reporting a
per-rank interval. The machinery already exists: `bootstrapCI` in
`src/lib/stats/distribution.ts`, and the valuation backtest already cluster-
bootstraps over leagues.

It is **not** built yet, deliberately. With 3–5 effective clusters a bootstrap
would produce intervals so wide as to be uninformative while lending false rigour
to the exercise. The correct sequencing is: acquire an untouched, many-cluster
sample first (audit §19), then bootstrap. Until then the honest representation of
uncertainty is this section, not an interval.

### Interim guard

Until intervals exist, PAR values must be presented as ordinal, not cardinal —
"this player rates above that one under the curve", never "worth 37.4 points
more". Nothing in production reads PAR today, which is the strongest form of
this guard.

---

## 6. Dependence in the training data (cross-reference to §5)

The curve is fitted on observations pooled across every earlier league. One NFL
player-season appears once per league that drafted them: same outcome, different
ADP rank.

`buildPointsCurve` defaults to **`cluster-weighted`** — every league-level row is
retained but weighted `1/k`, where `k` is the number of leagues containing that
player-season, so each distinct outcome contributes total weight exactly 1 while
its league-specific rank information survives.

That choice was made on statistical grounds **before** any untouched validation
and is not to be re-selected by score. `curveSampleDiagnostics` reports raw
observations, unique player-seasons, duplicates, source leagues, seasons and
per-position effective sample so the dependence is visible rather than assumed.

`counts` on a fitted `PointsCurve` is therefore **effective** (fractional)
observations, not row count. Quote that number.

---

## 7. Summary — assumption ledger

| # | Assumption | Type | Falsifiable from this curve? |
|---|---|---|---|
| 1 | Expected points are non-increasing in positional draft rank | **structural** | **No** — imposed; requires an unconstrained fit to test |
| 2 | Weighted squared error is the right loss | **structural** | No — a modeling choice |
| 3 | Within-rank errors are exchangeable | **structural** | Partly, with more data |
| 4 | Missing ranks equal the nearest populated rank below | **interpolation** | No — by construction there is no evidence there |
| 5 | Beyond the fitted range, all players are equal | **structural, conservative** | No |
| 6 | Repeated player-seasons carry `1/k` evidence each | **statistical, a priori** | Not by score; only by design argument |
| 7 | Uncertainty is unrepresented | **known gap** | — |

None of the above is an empirical finding about football. Every one is a choice
about how to fit a small, dependent sample, and each is here so it can be argued
with rather than inherited.
