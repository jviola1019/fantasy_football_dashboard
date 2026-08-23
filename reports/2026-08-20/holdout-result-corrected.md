# Holdout result — protocol 1 RE-ANALYSED with the ground-truth outcome label

**Executed** 2026-08-21T23:33:18.931Z · **Protocol** [holdout-protocol.md](./holdout-protocol.md) (frozen `7688d14`)

> **This is a CORRECTED RE-ANALYSIS, not protocol 1's reported result.** Protocol 1 inferred the outcome from `standings rank <= P`, which validation showed is wrong for 33% of leagues — division winners take an automatic berth ahead of a better-record wildcard. The field size P was right in all 86 checked leagues; which teams filled it was not. This run uses OBSERVED bracket participants instead. The original stands at [`holdout-result.md`](./holdout-result.md) and is not replaced.

Archived leagues read: **21**

## Sample construction

| stage | leagues |
|---|---|
| archived | 21 |
| rejected — no usable playoff bracket | 5 |
| rejected — not every franchise drafted | 2 |
| rejected — IDP league | 1 |
| **scored** | **13** |

## Sample

| quantity | value |
|---|---|
| team-seasons (rows) | **160** |
| leagues (clusters) | **13** |
| seasons | 2021, 2023 |
| league sizes | 10, 12, 14, 16 |
| playoff fields | 4, 6, 8 |
| observed qualification rate | 0.4750 |
| structural rate (mean P/N) | 0.4750 |

> **Self-check now CLOSED.** Protocol §6's declared check was vacuous — the label was defined from the standings rank, so the identity held by construction. This run does not infer the outcome at all: it uses the franchises that actually appear in the playoff bracket. Validation across 150 leagues found the inferred label wrong for 33% of them (28 of 84 judgeable), with the field size P correct in all 86 checked cases and only the identity of the qualifiers wrong — the signature of division winners taking an automatic berth ahead of a better-record wildcard.

## Headline

| forecaster | Brier | log loss | AUC | ECE |
|---|---|---|---|---|
| **shipped chain** | **0.2814** | 0.7978 | **0.5623** | 0.1687 |
| structural climatology (P/N) | 0.2404 | 0.6737 | 0.5 by construction | 0.0000 |
| raw draft capital | — | — | 0.5155 | — |

Brier skill score vs structural climatology: **-0.1705**

## Uncertainty — cluster bootstrap over whole leagues

| quantity | 95% CI | clusters | distinct resample values |
|---|---|---|---|
| AUC | [0.4700, 0.6390] | 13 | 4745 |
| Brier skill | [-0.2545, -0.0758] | 13 | 4909 |

Resolution: a 13-cluster bootstrap can reach a very large number of distinct multisets, so unlike the 3-cluster development-set intervals these are genuinely estimated rather than a percentile of a handful of values.

## Reliability (10 equal-width bins)

| bin | n | mean forecast | observed rate |
|---|---|---|---|
| 0.0–0.1 | 12 | 0.0696 | 0.4167 |
| 0.1–0.2 | 33 | 0.1602 | 0.4545 |
| 0.2–0.3 | 34 | 0.2533 | 0.3824 |
| 0.3–0.4 | 32 | 0.3570 | 0.4688 |
| 0.4–0.5 | 17 | 0.4485 | 0.5882 |
| 0.5–0.6 | 14 | 0.5422 | 0.5000 |
| 0.6–0.7 | 8 | 0.6331 | 0.5000 |
| 0.7–0.8 | 4 | 0.7543 | 0.7500 |
| 0.8–0.9 | 5 | 0.8360 | 0.8000 |
| 0.9–1.0 | 1 | 0.9200 | 0.0000 |

## Verdict against the criterion declared before execution

Protocol §9 required BOTH of:

1. AUC 95% CI entirely above 0.5 — **NOT MET**
2. Brier skill 95% CI entirely above 0 — **NOT MET**

**RESULT: the shipped chain does NOT demonstrate positive external skill on this sample.** Per protocol §9, no parameter is adjusted and re-run on this data. The model stays presented as a scenario generator, not a forecast.
