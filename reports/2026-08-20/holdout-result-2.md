# Holdout result 2 — enlarged sample, pre-registered test family

**Executed** 2026-08-21T23:42:25.637Z · **Protocol** [holdout-protocol-2.md](./holdout-protocol-2.md) (frozen `77fb562`)

> **Outcome label: OBSERVED bracket participation** (Amendment 2, recorded pre-execution). The inferred `standings rank <= P` label used by protocol 1 is wrong for 33% of leagues.

> **Not an independent replication.** This sample CONTAINS protocol 1's leagues. Report alongside [`holdout-result.md`](./holdout-result.md), never instead of it. If this succeeds where protocol 1 failed, the honest reading is *underpowered*, not *the earlier result was wrong*.

| stage | leagues |
|---|---|
| rejected — no usable playoff bracket | 45 |
| rejected — IDP league | 15 |
| rejected — no observed bracket participants | 11 |
| rejected — unparseable starters | 6 |
| rejected — not every franchise drafted | 3 |
| rejected — no picks | 1 |
| rejected — standings incomplete | 1 |
| **scored** | **68** |

| quantity | value |
|---|---|
| team-seasons | **800** |
| leagues (clusters) | **68** |
| seasons | 2021, 2022, 2023 |
| league sizes | 8, 10, 12, 14, 16 |
| base rate | 0.5000 |

## Confirmatory tests (Holm-Bonferroni across the family)

| id | hypothesis | statistic | p | Holm threshold | reject null? |
|---|---|---|---|---|---|
| H1 | AUC > 0.5 | 0.5867 (perm null mean 0.5661) | 0.1010 | 0.0167 | no |
| H2 | Brier skill > 0 | -0.1632 | 1.0000 | 0.0250 | no |
| H3 | resolution − reliability > 0 | -0.0289 | 1.0000 | 0.0500 | no |

Brier skill 95% CI [-0.2195, -0.1046] · 68 clusters, 4844 distinct resamples.
Usefulness 95% CI [-0.0417, -0.0154].

### Verdict: **NOT VALIDATED**

Protocol 2 §3 requires **all three** hypotheses to survive Holm correction. They do not. No parameter is adjusted and no re-run is permitted on this sample.

## Diagnostics (reported, NOT adjudicating)

### D1 — Murphy decomposition

| component | value | reading |
|---|---|---|
| reliability (lower better) | 0.0381 | miscalibration |
| resolution (higher better) | 0.0093 | informativeness |
| uncertainty (fixed) | 0.2500 | the task's own difficulty |
| **usefulness = res − rel** | **-0.0289** | **not useful** — miscalibration exceeds informativeness |

### D2 — leave-one-league-out isotonic recalibration (the decisive diagnostic)

| forecaster | Brier | skill vs climatology | AUC |
|---|---|---|---|
| raw | 0.2797 | -0.1632 | 0.5867 |
| **recalibrated (LOLO)** | 0.2423 | **-0.0076** | 0.5316 |
| structural climatology | 0.2405 | 0 | 0.5 |

**Recalibration does not rescue skill.** Even with a monotone calibration map fitted out-of-fold, the forecast does not beat the league's own base rate. There is no signal being hidden by miscalibration.

Note on AUC here: a single monotone map preserves ranking, but this is leave-one-LEAGUE-out, so each league is mapped by a DIFFERENT function. Within a league the ordering is preserved; pooled across leagues it need not be, and isotonic pooling also creates ties that score 0.5. So a MOVED AUC here is expected, not a bug. An earlier version of this note claimed the opposite and was wrong.

### D3 — signal ceiling: can ANY draft-only predictor beat the base rate?

Leave-one-league-out logistic regression on pre-season draft features only.

| forecaster | AUC | Brier | skill vs climatology |
|---|---|---|---|
| shipped chain | 0.5867 | 0.2797 | -0.1632 |
| **draft-feature ceiling (LOLO)** | **0.5379** | 0.2499 | **-0.0391** |
| structural climatology | 0.5 | 0.2405 | 0 |

**Even a fitted draft-only model does not beat the base rate.** Predicting playoff qualification from draft order alone appears close to unachievable on this sample — which reframes the shipped model's failure: it is failing at a task that may not be winnable, not merely failing badly.

Standardised coefficients from the final fold (direction only, not inference):

| feature | weight |
|---|---|
| positionalEntropy | -0.1664 |
| meanPositionalRank | -0.1479 |
| eliteCount | 0.1302 |
| draftCapital | 0.1121 |
| bestPositionalRank | -0.0988 |
| earlyQbTeShare | 0.0094 |

### D4 — power / minimum detectable effect

| quantity | value |
|---|---|
| rows | 800 |
| design effect (clamped >= 1) | 1.0000 |
| effective n | 800.0 |
| **minimum detectable AUC − 0.5** at 80% power | **0.0508** |

Against a **0.5** null this sample could detect an AUC of about **0.551** or better, and the observed 0.5867 clears that.

But **0.5 is the wrong null here.** Within-league permutation holds each league's berth count fixed, and unequal league sizes and berth rates put the null at **0.5661**, not 0.5. The effect actually being tested is therefore **0.0207**, not 0.0867.

That is **smaller than the 0.0508 minimum detectable effect**, so this sample was **NOT adequately powered** for the effect present. A null here means *no effect large enough to detect was found* — it does not show the effect is zero. This is consistent with H1's p = 0.1010: the permutation test and the power calculation agree once both use the same null.

### D5 — stratified by league size (no per-stratum p-values: concordance is unstable in small clusters)

| league size | leagues | rows | AUC | Brier | climatology |
|---|---|---|---|---|---|
| 8-team | 3 | 24 | 0.6367 | 0.2369 | 0.2083 |
| 10-team | 16 | 160 | 0.5538 | 0.2887 | 0.2406 |
| 12-team | 40 | 480 | 0.5706 | 0.2830 | 0.2436 |
| 14-team | 4 | 56 | 0.7212 | 0.2366 | 0.2449 |
| 16-team | 5 | 80 | 0.4730 | 0.2849 | 0.2281 |

---

# Interpretation

## Verdict, and what it is worth

**NOT VALIDATED.** All three pre-registered hypotheses fail Holm correction. The
label is now ground truth, so "wrong outcomes" is no longer an available excuse.

But the verdict is weaker than a flat "no signal", and D4 is why.

## The nulls were inconsistent, and fixing that changed the reading

Two reporting errors were found in the first execution and corrected before this
result was recorded. **The confirmatory numbers are byte-identical across both
runs** — only the surrounding text changed — and both runs are disclosed.

1. **The AUC-invariance note was wrong.** It claimed a monotone recalibration
   cannot move AUC. True for ONE map; false here, because leave-one-league-out
   fits a DIFFERENT map per league. Within a league ordering is preserved; pooled
   across leagues it need not be, and isotonic pooling also creates ties that
   score 0.5. That is why D2's AUC moved 0.5867 → 0.5316.

2. **The power calculation used the wrong null, and it inverted the conclusion.**
   Hanley-McNeil assumes a null AUC of 0.5. The cluster-permutation null here is
   **0.5661**, because within-league permutation holds each league's berth count
   fixed and unequal league sizes and berth rates shift the pooled baseline.

   | measured against | effect | vs MDE 0.0508 | reading |
   |---|---|---|---|
   | 0.5 (wrong null) | 0.0867 | clears it | "adequately powered" |
   | **0.5661 (permutation null)** | **0.0207** | **below it** | **underpowered** |

   The first version reported "adequately powered", which contradicted H1's
   p = 0.1010 in the same document. Once both use the same null they agree: the
   effect present is roughly 0.02 in AUC, and 800 rows across 68 clusters cannot
   resolve that.

**So the honest statement is: no effect large enough to detect was found. Not:
the effect is zero.**

## What the diagnostics say about *why*

**D1 — the failure is calibration, not information.** Reliability 0.0381 against
resolution 0.0093: miscalibration is **four times** larger than informativeness.
Usefulness −0.0289, so the forecast is not useful in Murphy's sense.

**D2 — recalibration removes almost all the damage, and still does not win.**

| forecaster | Brier | skill |
|---|---|---|
| raw | 0.2797 | −0.1632 |
| recalibrated (LOLO) | 0.2423 | **−0.0076** |
| climatology | 0.2405 | 0 |

Out-of-fold recalibration recovers −0.1632 → −0.0076, i.e. it closes ~95% of the
gap to climatology. That is a precise diagnosis: **the shipped model is
overwhelmingly a scaling failure, not an information failure.** But it still
lands *at* climatology, not above it. There is very little signal underneath the
miscalibration — it is just not the miscalibration that was hiding a good model.

**D3 — the task itself may be close to unwinnable.** A logistic regression fitted
out-of-fold on draft-only features reaches AUC 0.5379 and skill −0.0391. **Even a
model fitted directly to this outcome cannot beat the league's base rate.** That
reframes everything above: the shipped chain is failing at something a fitted
model also fails at. Its coefficients point sensibly (elite-player count and
draft capital positive; mean positional rank negative), so the features are not
nonsense — there is just very little there.

**D5 — no league size is spared.** Every stratum's Brier is worse than its own
climatology.

## What this licenses

- **Keep the scenario presentation.** Confirmed again, on ground-truth labels.
- **Do not ship PAR**, which was not evaluated here.
- **Do not tune anything.** Nothing was tuned, and the protocol forbids it.
- **Do not claim the model is proven worthless.** D4 says this sample could not
  detect an effect of the size actually present. That is a real limit on the
  conclusion, and stating it is not hedging.

## What would actually settle it

D3 is the finding that matters for planning. If a model fitted *directly* to the
outcome cannot beat the base rate from draft data, then better *valuation* is not
the missing piece — the draft may simply not carry enough information about a
fantasy season, and any product built on "we can forecast your season from your
draft" is built on sand. Testing that properly needs in-season inputs, not a
better transform of the same draft.
