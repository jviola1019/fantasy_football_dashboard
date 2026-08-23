# Holdout result 4 — does opportunity add over production to date?

**Executed** 2026-08-23T19:59:04.086Z · **Protocol** [holdout-protocol-4.md](./holdout-protocol-4.md) (frozen `0cd6c2d`)

> Baseline is **production to date**, not a stale ADP. A week-9 waiver decision has eight weeks of results available. Features standardised within (season, position); all inference clustered on **player**.

| quantity | value |
|---|---|
| player-seasons | **958** |
| distinct players (effective N) | **452** |
| seasons | 2021, 2022, 2023, 2024 |
| positions | RB, TE, WR |
| snap-share name join | 926/958 (96.7%) |

## Confirmatory tests (Holm-Bonferroni, all three required)

| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |
|---|---|---|---|---|---|---|
| H1 | usage adds over production | 0.2289 | [0.1636, 0.2943] | 0.0002 | 0.0167 | **YES** |
| H2 | same, WITHIN position | 0.2259 | [0.1652, 0.2884] | 0.0002 | 0.0250 | **YES** |
| H3 | decile concordance (>0.5) | 0.5749 | [0.5496, 0.5948] | 0.0002 | 0.0500 | **YES** |

Cluster bootstrap over **452 players**, 5000 resamples.

### Verdict: **OPPORTUNITY ADDS PREDICTIVE VALUE**

All three pre-registered hypotheses survive Holm correction. Usage carries information beyond production to date, it is not a position artifact, and it changes a decision at matched production.

## Diagnostics (reported, NOT adjudicating)

### D1 — leave-one-season-out predictive Spearman

| model | out-of-fold Spearman vs weeks 9-17 |
|---|---|
| points-to-date alone | 0.7342 |
| touches alone | 0.7331 |
| **points + touches** | **0.7479** |

### D2 — share-based usage instead of counts

| predictor | partial Spearman (controlling for points-to-date) |
|---|---|
| touches | 0.2289 |
| target share | 0.1797 |
| wopr | 0.1601 |

### D3 — snap share (RAE's actual `opportunity` field), name-joined

Matched 926 of 958 (96.7%). Secondary precisely because the join can fail.

Partial Spearman on the matched subset (n=926): **0.1661**

### D4 — minimum detectable correlation

With 452 effective clusters, about **0.1173** at 80% power (one-sided). Note this closed form assumes independent units and is a conservative approximation; the cluster bootstrap above is the primary inference.

### D5 — effect size in plain units

Top touches quintile mean outcome z: **1.1078**
Bottom touches quintile mean outcome z: **-0.8457**
