# Frozen protocol 2 — enlarged holdout, pre-registered test family

**Date frozen** 2026-08-21 · **Audit** §19 follow-up · **Status** FROZEN BEFORE EXECUTION

Written and committed **before** the enlarged sample is scored. Architecture,
preprocessing, sampling frame, filters, test family, multiplicity correction and
success criteria are fixed at commit time.

## 0. Relationship to protocol 1 — read this first

Protocol 1 ran once on 13 clusters and **failed both criteria**
([`holdout-result.md`](./holdout-result.md)). Protocol 2's sample **contains
protocol 1's leagues**, because acquisition resumed from the same frozen frame
rather than drawing a fresh one.

Therefore:

- **This is NOT an independent replication.** It is the same experiment with more
  data, and it must be reported **alongside** protocol 1's result, never instead
  of it.
- **Protocol 1's result stands regardless of what this returns.** If protocol 2
  succeeds where protocol 1 failed, the honest reading is "the earlier sample was
  underpowered", not "the earlier result was wrong".
- **This is the last permitted run on this sample.** A third pass would be
  running until the answer changes.

## 1. Why run it at all

Protocol 1's failure is consistent with two very different worlds:

1. the model has no signal; or
2. the model has a little signal and 13 clusters could not detect it.

Protocol 1 cannot separate them, and post-hoc diagnostics on 13 clusters cannot
either. **§4 below computes the minimum detectable effect explicitly**, so a null
result comes with a statement of what it could and could not have found — which
protocol 1 lacked.

## 2. Sample — same frame, more of it

Identical to protocol 1 §5: same seasons (2021-2024), same ten search terms in
the same order, candidate ids sorted ascending as integers and walked in order,
same structural filters. The only change is that acquisition ran longer.

Because the frame is sorted and walked in order, the enlarged sample is the
**deterministic prefix** of the same frame. No league is included or excluded on
any basis but the frozen structural filters.

**Execution trigger:** run once when archived leagues reach **≥ 150**, or when
acquisition terminates, whichever comes first. Whatever the filters yield is what
gets scored.

## 3. Confirmatory tests — the family, fixed now

Three hypotheses. All one-sided, all cluster-aware, all corrected together.

| id | hypothesis | statistic | null |
|---|---|---|---|
| **H1** | the model discriminates | AUC | cluster permutation (labels shuffled *within* league) |
| **H2** | the model has skill over the league's own base rate | Brier skill vs structural climatology | cluster bootstrap over whole leagues |
| **H3** | the forecast is *useful* in Murphy's sense | resolution − reliability > 0 | cluster bootstrap |

**H3 is new and comes from the forecast-verification literature**: a useful
probabilistic forecast has a Brier score below its uncertainty component —
equivalently, resolution exceeds reliability. It is included because H1 and H2
can both fail for a forecast that is merely miscalibrated, and H3 separates
"badly scaled" from "uninformative".

### Multiplicity

**Holm–Bonferroni across H1, H2, H3.** Testing three hypotheses and reporting the
best one is how a null becomes a false positive. Ordered p-values are compared
against α/(m−i+1) with α = 0.05.

### Success criterion — declared now

The shipped chain demonstrates positive external skill **if and only if all three
of H1, H2, H3 are significant after Holm correction.**

Explicitly NOT success:
- two of three;
- any test significant before correction but not after;
- a point estimate that improves on protocol 1;
- any diagnostic in §4 coming out favourably.

## 4. Diagnostics — reported, never adjudicating

These characterise. They are **not** corrected for multiplicity and **cannot**
support a success claim, because they were not pre-specified as criteria.

- **D1 — Murphy decomposition.** Brier = reliability − resolution + uncertainty,
  computed over forecast bins. Quantifies how much of the failure is calibration
  (reliability) versus informativeness (resolution).
- **D2 — leave-one-league-out isotonic recalibration.** Refit a monotone
  calibration map on all leagues but one, apply to the held-out league, pool.
  This is the decisive diagnostic: **if the recalibrated model beats climatology,
  the raw model has signal that miscalibration was hiding; if it still does not,
  there is no signal to rescue.** Leave-one-cluster-out is the recommended
  internal-external validation design for clustered data.
- **D3 — signal ceiling.** Leave-one-league-out logistic regression on simple
  draft-only features (total draft capital, early QB/TE share, positional
  balance, best positional rank held). Estimates whether *any* draft-only
  predictor beats the base rate, i.e. whether the model is failing at a task that
  is achievable at all.
- **D4 — power / minimum detectable effect.** Given the realized row count and
  the design effect implied by the cluster structure, the smallest AUC departure
  from 0.5 detectable at 80% power, α = 0.05. Published guidance puts ΔAUC = 0.10
  at roughly 36-142 observations and ΔAUC = 0.02 at 909-3,709, before any
  inflation for clustering — so this number decides whether a null is
  informative or merely underpowered.
- **D5 — stratified performance** by league size and playoff-field size. No
  per-stratum p-values: concordance indices are unstable in small clusters.

## 5. Everything else is unchanged from protocol 1

Preprocessing (§4), outcome label (§6), scoring protocol (§7) and the production
`SIM_BASE` constants are exactly as frozen in
[`holdout-protocol.md`](./holdout-protocol.md). The PAR candidate remains **out of
scope** — it needs a runtime points curve, and fitting one here would introduce
unfrozen choices.

## 6. Prohibited

- Tuning any parameter on this data. No cushion, anchor, slope, coefficient or
  curve setting.
- Re-running after seeing the result.
- Promoting a diagnostic to a criterion.
- Dropping a confirmatory test that comes out badly.
- Reusing the five Sleeper development leagues as a holdout, ever.

## 7. If it fails again

Then the shipped chain has no demonstrated external skill on the largest
untouched sample obtainable, and D2/D3/D4 say whether that is because the signal
is absent, hidden by miscalibration, or merely undetectable at this size. All
three are publishable answers. Production stays on the scenario presentation
either way.

## Sources consulted

- [Simplifying and generalising Murphy's Brier score decomposition](https://rmets.onlinelibrary.wiley.com/doi/10.1002/qj.2985)
- [Two Extra Components in the Brier Score Decomposition](https://journals.ametsoc.org/view/journals/wefo/23/4/2007waf2006116_1.xml)
- [Verification of probability forecasts for football outcomes: score decompositions, reliability and discrimination](https://arxiv.org/pdf/2106.14345)
- [Evaluation of clinical prediction models (part 1): from development to external validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC10772854/)
- [The calibrated model-based concordance improved assessment of discriminative ability in patient clusters of limited sample size](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6551913/)
- [Sample size and power analysis for ROC AUC differences: Obuchowski-McClish and Hanley-McNeil](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12924612/)
- [Smooth isotonic regression: a new method to calibrate predictive models](https://pubmed.ncbi.nlm.nih.gov/22211175/)

---

# DISCLOSURE — an accidental interim look at the enlarged sample

**Recorded 2026-08-21, before protocol 2 was executed.** This is written because
concealing it would be the actual misconduct; an interim peek that nobody knows
about is worth less than nothing.

## What happened

While adding the D3 draft-only features, I ran `holdout-evaluate.ts` intending a
**determinism check** — confirming that adding fields to the `Row` type left
protocol 1's numbers unchanged.

It did not do that. `loadRaw()` preferred the live acquisition directory over the
committed bundle, and that directory had grown from 21 leagues to 77 while
acquisition ran. So the run scored **513 rows across 43 clusters**, not protocol
1's 160 across 13. I saw the following before realising:

```
rows 513 · clusters 43
Brier 0.2901 · log loss 0.8366 · AUC 0.5574 · ECE 0.1704
AUC         95% CI [ 0.5107, 0.5979]
Brier skill 95% CI [-0.2685, -0.1445]
```

## Why it matters

That is an interim result on a superset of protocol 2's sample. Pre-registration
exists precisely to stop an analyst seeing partial results and then making
choices that bend toward them.

Note in particular that the AUC interval there lies **entirely above 0.5**, where
protocol 1's straddled it — exactly the "protocol 1 was underpowered" outcome
protocol 2 was designed to test. I have seen that. It cannot be unseen.

## Why the damage is bounded

1. **The success criterion was already fixed** (§3) and cannot be changed. All
   three hypotheses must survive Holm correction. Seeing an interim AUC does not
   loosen that.
2. **The stopping rule was already fixed** (§2): 150 leagues, or acquisition
   terminating. My discretion over *when to stop* — the main channel through
   which a peek biases a result — was pre-registered before the peek.
3. **The interim numbers are recorded here**, so any later result can be checked
   against them rather than presented as a first look.
4. Even in the peeked numbers, **H2 fails badly** (Brier skill interval entirely
   below zero). The all-three criterion was not close to being met.

## What was changed as a result

`holdout-evaluate.ts` now reads **only** its committed bundle (`RawSource =
"pinned"`), so protocol 1's harness can never silently absorb later-acquired
leagues. Protocol 2 explicitly requests the working set. This was a real
reproducibility defect independent of the peek: before the fix, running
`npm run holdout:evaluate` after any further acquisition would have reported a
different number under protocol 1's name.

## What was NOT changed

No hypothesis, no threshold, no correction method, no stopping rule, no
preprocessing, no feature. The `features` field added to `Row` carries only
pre-season draft quantities and was verified not to move protocol 1's numbers:
re-run against the pinned bundle it reproduces 160 rows, 13 clusters, Brier
0.2822, AUC 0.5569, CIs [0.4630, 0.6300] and [-0.2550, -0.0910] exactly.
