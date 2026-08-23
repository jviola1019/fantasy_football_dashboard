# Frozen protocol 6 — is leave-one-week-out optimistic?

**Date frozen** 2026-08-23 · **Status** FROZEN BEFORE ANY SCORING

Written and committed **before** the harness exists and before any number is
computed. Protocol 6 exists because P2-7 was *disclosed* rather than fixed, and
a disclosure that never gets measured is a caveat that quietly becomes a habit.

## 1. The claim under test

`buildLogisticCalibration` fits `P(actual ≥ threshold)` from `proj_pts_ppr` and
scores it out-of-fold by **leave-one-week-out**. Its docstring used to say
"so no leakage". That claims more than the design delivers, and the correction
shipped in P2-7 says so in words:

> Holding out a WEEK removes temporal leakage: no outcome from the scored week
> is in the training set. It does NOT make the folds independent, because THE
> SAME PLAYERS appear in every other week.

**Words are not a measurement.** The question this protocol answers:

> **How much lower is the reported out-of-fold calibration error than it would
> be under folds that are independent at the PLAYER level?**

## 2. Why this is not obviously large

Stated up front so the result cannot be dressed up either way. The model has
**one feature** — the projection — and player identity is not in it. The leak is
therefore indirect: training on a player's other weeks lets the fitted mapping
adapt to the idiosyncrasies of the very players it is then scored on (a player
who consistently beats their projection pulls the curve toward themselves).

With one monotone feature that effect is bounded. It could plausibly be
negligible. **A null result here is a real result** and will be reported as one.

## 3. Data — the snapshot, not the network

`reports/2026-08-20/brier-prospective.json.gz`, the committed input snapshot
introduced by P2-5: **3,573 startable player-weeks, 17 weeks, 2025 season**,
fingerprint `bba1d103`.

Protocol 6 could not have been run honestly before P2-5, because two runs would
have scored different data. That ordering was deliberate.

No re-fetching. No `--refresh`. If the snapshot changes, this protocol is void
and must be re-frozen.

## 4. The three schemes compared

All three fit the identical model — logistic on `proj_pts_ppr`, `l2 = 1.0` —
and differ **only** in how folds are assigned.

| id | scheme | what it controls |
|---|---|---|
| **A** | leave-one-week-out | the shipped scheme. Temporal separation only. |
| **B** | grouped 5-fold **by player** | every row for a player is in exactly one fold. Player-level independence; weeks are mixed. |
| **C** | week ∧ player disjoint | a test fold shares neither a week nor a player with its training set. The strict version. |

**B is primary.** C is reported as a diagnostic because it discards a large
share of the training rows to achieve double disjointness, so a worse score
under C confounds "leakage removed" with "less training data" — a confound B
does not have.

`k = 5`, chosen before running as the conventional default, and **not** to be
adjusted afterwards. Fold assignment is `mulberry32`-seeded on a fixed constant
so the split is reproducible.

## 5. Metric

**Expected Calibration Error (10 equal-width bins), occupancy-weighted.**
Primary, because the claim is about calibration, and because ECE is the number
the report already quotes as "the projections' calibration error".

Brier score is reported alongside. It is **not** a criterion — Brier mixes
calibration and discrimination, so a Brier move cannot settle a calibration
question.

Positions are pooled for the primary. Per-position figures are a diagnostic.

## 6. Inference

Cluster bootstrap on **`player_id`**, 5,000 resamples, the same treatment
protocols 4 and 5 use and for the same reason: a player's weeks are not
independent draws. The statistic is the **paired difference** `ECE(B) − ECE(A)`
computed within each resample, so the two schemes see identical resampled data.

Reported as a point estimate with a **95% percentile interval**.

## 7. The decision rule — declared now

**Materiality threshold: 0.01 absolute ECE (1 percentage point).**

Chosen because the calibration model's reported ECEs sit at roughly 0.02–0.03;
a shift of 0.01 is the smallest change that would alter how the model is
described in prose rather than only in a table.

| outcome | what ships |
|---|---|
| `ECE(B) − ECE(A) ≥ 0.01` **and** the 95% interval excludes 0 | LOWO is materially optimistic. The **grouped figure becomes the reported calibration error**, and the LOWO number is retained only as a labelled comparison. |
| interval excludes 0 but the gap is `< 0.01` | Real but immaterial. The LOWO figure stands, and the P2-7 caveat is **replaced by the measured number** — "optimistic by N pp" instead of "optimistic by an unmeasured amount". |
| interval includes 0 | No detectable optimism at this sample size. The caveat is rewritten to say exactly that, with the interval, and **the claim that LOWO is optimistic is retracted**. |

Explicitly NOT success: a negative point estimate reported as "no leakage"
without its interval; choosing whichever of B or C reads better; or adjusting
`k`, the bin count, or the threshold after seeing a number.

## 8. Prohibited

- Re-running after seeing the result. A harness bug found afterwards requires
  the fix and **both** results disclosed.
- Changing `k`, the seed, the bin count, or the materiality threshold.
- Promoting diagnostic C to the criterion.
- Re-fetching the inputs.
- Reporting Brier as though it settled a calibration question.

## 9. What each outcome means for the product

**If LOWO is materially optimistic** — every calibration number in
`docs/brier-results.md` has been flattering the projections, and the honest
figure is worse than what has been shown.

**If it is not** — P2-7's disclosure was correct to be cautious and is now
quantified, and the one-feature argument in §2 is supported by evidence rather
than by reasoning alone.

Either way the disclosure stops being an open question. That is the point:
**an unmeasured caveat is indistinguishable from an excuse.**
