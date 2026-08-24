# Holdout result 5 — what weight should opportunity carry?

**Executed** 2026-08-24T02:43:22.752Z · **Protocol** [holdout-protocol-5.md](./holdout-protocol-5.md) (frozen `92616f7`)

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
