# Holdout result 5 — what weight should opportunity carry?

**Executed** 2026-08-22T22:57:24.409Z · **Protocol** [holdout-protocol-5.md](./holdout-protocol-5.md) (frozen `92616f7`)

> Weight fitted on **2021–2024** (protocol 4's already-spent data), evaluated on **2017–2019**, which no protocol in this audit has touched. The weight was computed once and never adjusted.

| quantity | value |
|---|---|
| fit set | 958 player-seasons, 452 players |
| evaluation set | **694** player-seasons, **392** players |
| b_points (fit) | 0.4370 |
| b_touches (fit) | 0.3327 |
| **fitted weight w** | **0.7613** |

## Confirmatory tests on the UNTOUCHED evaluation set (Holm, all three required)

| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |
|---|---|---|---|---|---|---|
| H1 | weighted beats points alone | 0.0195 | [0.0070, 0.0324] | 0.0008 | 0.0250 | **YES** |
| H2 | same, WITHIN position | 0.0199 | [0.0074, 0.0324] | 0.0010 | 0.0500 | **YES** |
| H3 | decile concordance (>0.5) | 0.5961 | [0.5602, 0.6140] | 0.0002 | 0.0167 | **YES** |

Cluster bootstrap over **392 players**, 5000 resamples.

### Verdict: **THE WEIGHT GENERALISES**

All three pre-registered hypotheses survive Holm correction on seasons the weight was never fitted on. w = 0.7613 is licensed for the in-season ranking.

## Diagnostics (reported, NOT adjudicating)

### D2 — the weight refitted independently on the evaluation set

| set | b_points | b_touches | w |
|---|---|---|---|
| fit (2021–2024) | 0.4370 | 0.3327 | **0.7613** |
| eval (2017–2019) | 0.2945 | 0.4184 | **1.4208** |

Same sign in both eras.

### D3 — evaluation with 2020 added back (the a-priori exclusion)

With 2020: 924 player-seasons, gain 0.0197 (primary excluded it: 0.0195).

### D4 — out-of-sample Spearman on the evaluation set

| model | Spearman vs weeks 9–17 |
|---|---|
| points-to-date alone | 0.6390 |
| touches alone | 0.6460 |
| **points + 0.761 × touches** | **0.6585** |

### D5 — sensitivity of the gain to w

| w | gain on eval |
|---|---|
| 0.00 | 0.0000 |
| 0.10 | 0.0062 |
| 0.20 | 0.0107 |
| 0.30 | 0.0138 |
| 0.50 | 0.0177 |
| 0.75 ← fitted | 0.0193 |
| 1.00 | 0.0205 |

---

## Interpretation

Written **after** seeing the result. Nothing was recomputed and no parameter
adjusted; the numbers above stand exactly as the harness emitted them.

### What passed

All three pre-registered hypotheses cleared Holm correction on **2017–2019**,
seasons the weight was never fitted on and no protocol in this audit had touched.
Under protocol 5 §6 that is the declared success criterion, and it is met. The
gain is **+0.0195** Spearman (0.6390 → 0.6585) over points-to-date alone.

### Three things the diagnostics say, which the verdict alone does not

**1. The DIRECTION generalises; the MAGNITUDE does not.** D2 refits the weight
independently on the evaluation era and gets **1.4208** against the fitted
**0.7613** — the same sign, but nearly double. A weight is not a constant of
nature here; it drifts with the era. Reporting "w = 0.7613" as though it were
precise would overstate what was measured.

**2. The gain is a plateau, not a peak.** D5 shows the gain rising monotonically
across the whole range tested — 0.0062 at w=0.1, 0.0177 at 0.5, 0.0193 at the
fitted 0.761, 0.0205 at 1.0. The fitted weight is **not** the best value on the
evaluation set, and deliberately was not re-tuned to become one. The useful
reading is that *any* weight in roughly [0.5, 1.0] buys almost the same thing.
That is more robust than a sharp optimum would be, and it means the precise
number matters far less than the decision to include usage at all.

**3. Usage alone beat points alone on this era.** D4: touches-only reaches
**0.6460** against points-only **0.6390**. That is not what protocol 4 would have
predicted, and it is worth stating plainly rather than leaving in a table.

**4. The 2020 exclusion was not load-bearing.** D3 adds the COVID season back and
the gain is 0.0197 against 0.0195. The a-priori exclusion changed nothing, which
is the outcome that makes the pre-registration credible rather than convenient.

### What this licenses — and, importantly, what it does not

**Licensed:** an in-season ranking of the form `points-to-date + w × touches`,
with w in the region of 0.5–1.0, carrying an out-of-sample justification on
392 players across three untouched seasons.

**NOT licensed: changing RAE's existing waiver formula to 0.7613.** That formula
is `trueValue + edge×0.4 + opportunity×0.4 + scarcity×0.8`, and `trueValue` is
**consensus-derived**, not points-to-date. Protocol 5 fitted a weight for a
*different model* than the one RAE ships. Transferring the number across would be
exactly the category error this audit has spent four protocols avoiding —
protocols 1–3 established that consensus-derived predictors behave nothing like
observed production.

Shipping this properly requires RAE to compute **points-to-date** as a real
in-season feature, which it does not currently do. Until then the honest position
is: the weight is validated for a model RAE has not built yet, and the existing
waiver constant remains what protocol 4 left it as — evidenced in direction,
unjustified in magnitude, and labelled as such.

### Why this result is credible

The evaluation set was chosen and frozen **before** the weight existed, and it is
genuinely untouched: protocols 1–3 used MyFantasyLeague data, protocol 4 used
2021–2024. The fit set is data already spent on discovery, so nothing new was
contaminated. The harness self-test proves — empirically, by reproducing protocol
4's exact 958 rows and 452 players — that the preprocessing was inherited verbatim
rather than quietly re-chosen to favour the result.
