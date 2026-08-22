# Holdout result 4 — does opportunity add over production to date?

**Executed** 2026-08-22T04:30:52.427Z · **Protocol** [holdout-protocol-4.md](./holdout-protocol-4.md) (frozen `0cd6c2d`)

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

---

## Interpretation

Written **after** seeing the result. No statistic was recomputed, no parameter
adjusted, and the numbers above stand exactly as the harness emitted them.

### What passed

All three pre-registered hypotheses cleared Holm correction. Under protocol 4 §6
that is the declared success criterion, and it is met. This is the first positive
result in four protocols.

### Four things that must be stated alongside it

**1. The p-values are at the bootstrap floor, not vanishingly small.**
`0.0002` is `1/(5000+1)` — zero of 5000 cluster resamples fell at or below the
null. The correct reading is *p < 0.0002*, not *p = 0.0002*. More resamples would
not produce a smaller number with this harness.

**2. The practical gain is real but modest, and D1 is the honest measure of it.**
Out of fold, points-to-date alone reaches Spearman **0.7342**; adding touches
moves it to **0.7479**. That is **+0.0137**. Significant is not the same as large.
Anyone reading the confirmatory table alone would overestimate what this buys;
the correct summary is that usage adds a small, reliable increment on top of a
baseline that was already strong.

**3. Part of the effect is mechanical, and PPR scoring is why.**
In PPR, a reception *is* a point. So a player who keeps drawing targets scores
partly because the volume continues, not only because volume reveals hidden
skill. This does not invalidate the finding for its intended use — for a start/sit
or waiver decision, "this player's volume will persist" is exactly the useful
claim — but it does mean the result should not be described as uncovering latent
talent the market missed.

**4. The scope is in-season only.**
What was measured is: usage in weeks 1–8 predicts points in weeks 9–17 beyond
points in weeks 1–8. Nothing here licenses a change to **pre-season** draft
valuation, where no in-season usage exists by definition. Protocols 1–3 tested
that regime and it failed. Both findings stand, and they are about different
regimes.

### What this does and does not license

**Licensed:** presenting opportunity as a *validated* in-season signal, with this
result as its provenance and the scope limit above attached.

**NOT licensed:** setting or changing any weight from this data. Protocol 4 §8
prohibits tuning a weight here, and the D1 regression coefficients are a
diagnostic — §8 also prohibits shipping a model change on a diagnostic alone.
The existing waiver weight is therefore left **exactly as it was**; what changes
is that it is now documented and evidenced rather than asserted. Choosing a
better weight requires a new pre-registered protocol with its own held-out split.

### Why this result is more credible than protocol 3's retracted one

Protocol 3 produced an apparent quarterback effect that dissolved on inspection,
because a position-blind cost curve manufactures a positive residual for any
high-scoring position. Protocol 4 was designed against exactly that failure:
features are standardised **within (season, position)**, and H2 re-tests the
whole claim **within position**. H2's estimate (0.2259) is indistinguishable from
the pooled H1 (0.2289), which is the signature of an effect that is *not*
positional composition. Effective N is 452 clusters against protocol 3's 43.
