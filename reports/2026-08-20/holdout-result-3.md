# Holdout result 3 — does the reputation edge predict?

**Executed** 2026-08-21T23:51:55.624Z · **Protocol** [holdout-protocol-3.md](./holdout-protocol-3.md) (frozen `963bdd5`)

> Tests the quantity the product is named for, which nothing had previously tested: `edge = trueValue − perceivedValue`. All inference clusters on **player-season**, not league — one NFL player-season appears in many leagues with identical points.

| quantity | value |
|---|---|
| leagues | 115 |
| player-season-league rows | **21714** |
| **distinct player-seasons (effective N)** | **1211** |
| mean edge | 8.353 |
| sd edge | 21.578 |

## Confirmatory tests (Holm-Bonferroni, all three required)

| id | hypothesis | statistic | 95% CI | p | Holm | reject null? |
|---|---|---|---|---|---|---|
| H1 | edge predicts beating draft cost | 0.0579 | [0.0181, 0.0979] | 0.0008 | 0.0250 | **YES** |
| H2 | same, WITHIN position | -0.0480 | [-0.0757, -0.0197] | 0.9996 | 0.0500 | no |
| H3 | concordance at matched cost (>0.5) | 0.5316 | [0.5168, 0.5465] | 0.0002 | 0.0167 | **YES** |

Cluster bootstrap over **1211 player-seasons**, 5000 resamples, 4817 distinct H1 values.

### Verdict: **NOT DEMONSTRATED**

Protocol 3 §7 requires **all three**. No weight, threshold or transform is adjusted, and no re-run is permitted on this sample.

## Diagnostics (reported, NOT adjudicating)

### D1 — effect size in plain units

Top edge quintile mean pointsZ: **-0.2316**
Bottom edge quintile mean pointsZ: **0.0461**
Difference: **-0.2777** standard deviations of within-league scoring.

### D2 — is the edge just a position label?

| position | n | mean edge | sd edge | mean residual |
|---|---|---|---|---|
| WR | 7536 | 3.38 | 13.95 | -0.1848 |
| RB | 6234 | 3.41 | 15.58 | -0.2915 |
| QB | 2586 | -0.37 | 18.52 | 1.1550 |
| TE | 2377 | 4.25 | 22.31 | -0.3056 |
| DEF | 1538 | 39.33 | 18.28 | 0.2756 |
| K | 1443 | 45.03 | 19.60 | 0.3669 |

Between-position sd of mean edge: **18.76** · mean within-position sd: **18.04**.
Within-position variation is SMALLER than between-position variation, so the edge is substantially a positional signal — which is what H2 exists to separate.

### D3 — minimum detectable correlation at 80% power

With **1211** effective clusters, the smallest detectable Spearman correlation is about **0.0715** (one-sided, α = 0.05).
The observed 0.0579 is **below** that, so a null means no effect large enough to detect was found — not that the effect is zero.

### D4 — which half carries the signal?

| predictor | Spearman vs residual |
|---|---|
| edge (trueValue − perceivedValue) | 0.0579 |
| trueValue alone | 0.0628 |
| perceivedValue alone | 0.0109 |

### D5 — same-position concordance at matched cost

0.5097 (H3 restricted to pairs of the same position).

---

# Interpretation

## Verdict

**NOT DEMONSTRATED.** H2 fails — and it fails in the *wrong direction*.

| | statistic | 95% CI | reading |
|---|---|---|---|
| H1 across positions | +0.0579 | [0.0181, 0.0979] | significant, positive |
| **H2 within position** | **−0.0480** | **[−0.0757, −0.0197]** | **significantly INVERTED** |
| H3 concordance, all pairs | 0.5316 | [0.5168, 0.5465] | significant |
| D5 concordance, same position | 0.5097 | — | close to chance |

H2 is the hypothesis that exists to separate "we find mispriced players" from
"draft scarce positions earlier". It answers: the edge does **not** identify
mispriced players. Within a position it points the wrong way.

## Why the cross-position result is an artifact, not a success

D2 is the whole story:

| position | n | mean edge | mean residual |
|---|---|---|---|
| K | 1443 | **45.03** | +0.3669 |
| DEF | 1538 | **39.33** | +0.2756 |
| TE | 2377 | 4.25 | −0.3056 |
| RB | 6234 | 3.41 | −0.2915 |
| WR | 7536 | 3.38 | −0.1848 |
| **QB** | 2586 | **−0.37** | **+1.1550** |

Two things jump out.

**Kickers and defenses get a mechanically enormous edge.** They are drafted very
late overall (low `perceivedValue`) but there are few of them, so positional rank
is low and `trueValue` is high. Edge around 45 and 39 versus around 3.4 for the
skill positions. That is arithmetic about roster construction, not a market
inefficiency. They then "beat" a **position-blind** expected-points-by-draft-slot
curve because kickers score steadily while the curve expects little from late
picks.

**Quarterbacks refute the edge outright.** QBs have the **lowest** edge of any
position (−0.37) and by a wide margin the **highest** residual (+1.1550 sd). The
edge says quarterbacks are the least underpriced group; the outcomes say they are
the most underpriced by far. That single row is the opposite of what the
mechanism predicts.

So H1 and H3 are carried by positional scoring profiles interacting with a
position-blind cost curve — a confound this protocol's residual model does not
remove, and which H2 and D5 were pre-registered to expose. Restricting
concordance to same-position pairs collapses it from 0.5316 to **0.5097**,
essentially chance.

## The named mechanism adds nothing

D4 is the most direct verdict on "reputation arbitrage":

| predictor | Spearman vs residual |
|---|---|
| `trueValue` alone | **0.0628** |
| `edge` = trueValue − perceivedValue | 0.0579 |
| `perceivedValue` alone | 0.0109 |

Subtracting `perceivedValue` — the entire arbitrage step, the thing the product is
named for — makes the signal **slightly worse** than `trueValue` alone. There is
no arbitrage being extracted. There is a positional-scarcity score with a
consensus-rank term subtracted from it, and the subtraction is not earning its
place.

## A reporting inconsistency, stated rather than left standing

D3 reports a minimum detectable correlation of 0.0715 and calls the observed
0.0579 undetectable — while H1's bootstrap gives p = 0.0008 with a CI of
[0.0181, 0.0979] that clearly excludes zero. **These disagree, and D3 is the one
that is wrong here.**

The closed form `(z_a + z_b) / sqrt(n - 3)` assumes *n independent observations*,
and I fed it the cluster count (1211). That ignores the fact that a player-season
appears in different leagues at *different* draft slots and formats, so its edge
varies within cluster and carries real information. The cluster bootstrap models
that correctly; the closed form does not. **The bootstrap is the primary
inference.**

This is the same class of error as protocol 2's null mismatch — a closed-form
approximation quietly assuming something the design violates — and it is recorded
rather than quietly dropped.

## What this means for the product

This matters more than the season simulator, because playoff percentages are
already presented as scenarios while **draft and waiver rankings are presented as
advice**.

A draft board's job is *within-position* ordering: "who should I take at RB?"
That is precisely where H2 and D5 say the signal is absent-to-inverted. The
surfaces affected are `draft/tiers.ts`, `draft/keepers.ts`, the Waiver Wire
priority formula, Player Universe and Market Intelligence.

What is **not** shown: that the rankings are worse than nothing. `perceivedValue`
is consensus ECR, a strong baseline, and this test does not knock it down. What is
shown is that **RAE's adjustment on top of consensus is not adding value, and
within position it subtracts some.**

## What follows

1. **Do not present the reputation edge as identifying mispriced players.** On
   the evidence it identifies scarce positions, which is a different and much
   weaker claim.
2. **The positional-value part is worth keeping** and worth relabelling honestly
   as positional scarcity.
3. **The QB row is the interesting lead.** A group the model rates lowest on edge
   outperformed its draft cost by more than a standard deviation. That is a real,
   large, unexplained effect and the first thing in this audit that looks like it
   could support a genuine edge — but it needs its own frozen protocol, not a
   post-hoc claim from a table I have already seen.
4. **Nothing was tuned**, and the protocol forbids a re-run on this sample.

---

# CORRECTION — the "QB lead" was my own artifact, and is retracted

**Recorded 2026-08-21, after the result above was written.**

The interpretation above says of quarterbacks: *"The edge says quarterbacks are
the least underpriced group; the outcomes say they are the most underpriced by
far."*

**That is wrong, and it was my error, not the model's.**

## What the data actually says

Mean **raw** within-league points z-score, across every scored drafted player in
the archived sample — no draft-cost adjustment at all:

| position | n | mean raw pointsZ |
|---|---|---|
| DEF | 3,362 | +0.7642 |
| **QB** | **10,227** | **+0.7551** |
| K | 5,120 | +0.5662 |
| RB | 24,001 | −0.0646 |
| WR | 34,208 | −0.0913 |
| TE | 18,695 | −0.3335 |

Quarterbacks simply **score more fantasy points** than other positions. That is
not news; it is why replacement level exists and why VBD was invented.

## Why that produced a spurious +1.16

Protocol 3 §5 fits `expected(overallRank)` **position-blind** — one curve over
all positions. So a position that scores more raw points than average will
mechanically show a positive residual at every draft slot, and a position that
scores less will show a negative one. Compare:

| position | mean raw pointsZ | mean residual |
|---|---|---|
| QB | +0.7551 | +1.1550 |
| DEF | +0.7642 | +0.2756 |
| K | +0.5662 | +0.3669 |
| WR | −0.0913 | −0.1848 |
| RB | −0.0646 | −0.2915 |
| TE | −0.3335 | −0.3056 |

The residual ordering tracks the raw-points ordering. **The residual is measuring
positional scoring level, not mispricing.**

## What this changes

1. **The "open lead" is retracted.** There is no evidence here that the market
   underprices quarterbacks. I should not have written that, and anyone reading
   the earlier text should disregard that paragraph.
2. **H1 and H3 are contaminated more deeply than first stated.** The original
   interpretation blamed K/DEF edge magnitude. The fuller explanation is that the
   position-blind cost curve makes *every* cross-position comparison confounded by
   positional scoring level.
3. **H2 is the only clean test in protocol 3** — it holds position fixed, so the
   confound cannot operate. H2 is the one that **failed, in the inverted
   direction** (−0.0480, CI [−0.0757, −0.0197]).

So the protocol's verdict is unchanged and, if anything, firmer: the single
trustworthy hypothesis says the edge is inverted within position. The two that
"passed" should not have been counted as evidence in either direction.

## Why the design still did its job

Protocol 3 pre-registered H2 precisely because "the edge might only be a
positional signal" was the obvious failure mode. It was pre-registered as
confirmatory, not as a diagnostic, and success required **all three** — so a
protocol built around the contaminated tests alone would have been reported as a
success. The all-three rule is what stopped an artifact being sold as a finding.

The lesson for the next protocol is concrete: **fit the expected-cost curve
within position, or include position as a covariate.** A position-blind baseline
cannot support any cross-position claim.
