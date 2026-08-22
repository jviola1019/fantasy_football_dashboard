# PAR training data — dependence, pseudo-replication, and what it does to the verdict

**Date** 2026-08-20 · **Audit** §4 / §5 · **Harness** `scripts/backtest-valuation.ts` ·
**Reproduce** `npm run backtest:valuation` (add `RAE_CURVE_AGGREGATION=league-level|player-season|cluster-weighted`)

> **This supersedes the "UPDATE 2026-08-18" section of
> [`reports/2026-08-06/backtest-valuation.md`](../2026-08-06/backtest-valuation.md).**
> That section's central claim — *"rank-ratio's AUC interval lies entirely below
> 0.5 … PAR's interval includes 0.5. Replacing the transform removes a
> measurable defect."* — does not survive the dependence analysis below. It is
> retained there as a historical record with a pointer to this document.

---

## 1. What was unmeasurable before

`PointsObservation` carried `{season, position, adpRank, seasonPoints}` and **no
player identity**. The backtest pools observations from every earlier league, so
one NFL player-season appears once per league that drafted them — a different ADP
rank each time, but literally the same outcome number.

With no `playerId`, a 500-observation fit built from 500 distinct players was
indistinguishable from one built from 100 players counted five times. The second
carries roughly a fifth of the evidence. The type could not express the defect,
so no amount of care in the harness could have caught it.

`playerId` and `leagueId` are now **required** fields, and
`curveSampleDiagnostics()` reports the dependence structure of every fit.

## 2. Measured dependence

Largest curve fit (Creamy Les Coot 4.0, 2025, fitted on 2022/2023/2024):

| quantity | value |
|---|---|
| raw observations | **568** |
| unique player-seasons | **434** |
| duplicated rows | **134** |
| player-seasons appearing in >1 league | **134** |
| source leagues | 4 |
| seasons | 2022, 2023, 2024 |
| **design effect** (raw / unique) | **1.31** |

Per position:

| position | raw | effective | distinct ranks | design effect |
|---|---|---|---|---|
| RB | 165 | 125 | 46 | 1.32 |
| WR | 207 | 157 | 53 | 1.32 |
| TE | 58 | 45 | 16 | 1.29 |
| QB | 58 | 44 | 15 | 1.32 |
| DEF | 39 | 31 | 10 | 1.26 |
| K | 41 | 32 | 11 | 1.28 |

**Reading.** A naive count overstates the evidence by about 31%, uniformly across
positions. That is real but modest — smaller than the worst case, and worth
stating plainly rather than implying the training data was mostly duplicates. It
does *not* rescue the sample: 434 player-seasons across 4 leagues from one
manager group is still a narrow, correlated slice of football.

## 3. The three treatments (audit §5 A / B / C)

All three are implemented in `buildPointsCurve(observations, { aggregation })`.

| mode | what it does | what it costs |
|---|---|---|
| `league-level` (A) | one row per (league, player, season), weight 1 | treats one NFL outcome as *k* independent draws; over-weights popular players, i.e. the top of the draft, which is where curve shape matters most |
| `player-season` (B) | collapse to one row at the **median** ADP rank | clean on the outcome side, but discards real league-to-league ADP disagreement — a player taken RB8 in one league and RB20 in another is evidence about *both* |
| `cluster-weighted` (C) | keep every league row, weight `1/k` | none of the above; each distinct outcome contributes total weight exactly 1 while every rank it was drafted at survives |

**`cluster-weighted` is the default**, chosen on statistical grounds *before* any
untouched validation: it is the only one of the three that matches total evidence
to the number of independent outcomes (like B) while preserving the rank spread
(like A). It is the standard cluster-weighting treatment for repeated measures on
one unit, and the argument does not reference any score it produces.

The curves themselves barely move, which is reassuring — the choice is not a
large lever on the fitted shape:

| mode | effective obs | QB1 expected pts | RB1 expected pts |
|---|---|---|---|
| league-level | 568.0 | 295.3 | 219.7 |
| player-season | 434.0 | 293.4 | 208.3 |
| cluster-weighted | 434.0 | 293.5 | 209.2 |

## 4. But it changes the verdict

Like-for-like, 30 team-seasons, 3 leagues (the rows PAR can score at all):

| aggregation | PAR Brier | PAR AUC | PAR AUC 95% CI | interval straddles 0.5? |
|---|---|---|---|---|
| `league-level` (previous default) | 0.3338 | 0.4398 | [0.3750, **0.5417**] | **yes** |
| `player-season` | 0.3231 | 0.4583 | [0.3750, **0.5833**] | **yes** |
| **`cluster-weighted`** (a-priori choice) | 0.3289 | 0.4051 | [0.3750, **0.4583**] | **NO** |

RANK is unaffected in all three (Brier 0.3353, AUC 0.2546, CI [0.1333, 0.4450]) —
as it must be, since rank-ratio VBD never consults the points curve. That
invariance is itself a check that the change is doing what it claims.

**So the headline claim from 2026-08-18 is not robust.** *"PAR removes the
statistically significant inversion"* holds under two defensible analyst choices
and fails under the one selected on principle. Under `cluster-weighted`, PAR's
interval also lies entirely below 0.5 — the same verdict as the shipped model.

Note this cuts **against** the candidate the previous session built, and the
default was still set to `cluster-weighted`. Choosing the aggregation that
flatters PAR would be precisely the failure mode audit §5 names.

## 5. The deeper problem: the interval is not estimable at 3 clusters

None of the intervals above should be leaned on at all, and this is now measured
rather than argued.

A cluster bootstrap resampling `k` clusters with replacement can only reach
`C(2k−1, k)` distinct multisets:

| clusters | distinct multisets possible |
|---|---|
| 3 | 10 |
| 5 | 126 |

Instrumented over 5000 iterations, the harness reports how many distinct values
the resampling actually reached:

```
RANK AUC ... [0.1333, 0.4450]  (5 clusters, 105 distinct resample values)
PAR  AUC ... [0.3750, 0.4583]  (3 clusters,   9 distinct resample values)
RANK skill . [-0.4588, -0.1320] (5 clusters, 138 distinct resample values)
PAR  skill . [-0.6824, -0.1074] (3 clusters,  10 distinct resample values)
```

**The PAR interval is a percentile of nine numbers.** Its endpoints are
essentially the min and max of those nine. Raising `iterations` from 5000 to a
million would change nothing: resolution is a function of cluster count, not
iteration count.

Consequently:

- Whether PAR's interval straddles 0.5 is **an artifact in either direction**.
  The `league-level` result should not have been reported as evidence that PAR
  fixed the inversion, and the `cluster-weighted` result must not now be reported
  as evidence that it did not.
- The identical lower bound of `0.3750` across all three treatments is a
  fingerprint of the same coarse grid, not a stable estimate.
- RANK's 5-cluster interval (105 distinct values) is meaningfully better but
  still thin.

## 5b. Postscript — the external holdout, run after this analysis

The holdout described in [`holdout-protocol.md`](./holdout-protocol.md) was
subsequently executed once. It bears directly on §4 above.

RANK's *inversion* — the property that made `league-level` vs `cluster-weighted`
look like it flipped a verdict — **did not replicate** on 160 team-seasons across
13 unseen leagues: AUC **0.5569 [0.4630, 0.6300]**, straddling 0.5.

So the aggregation sensitivity documented above was sensitivity in an estimate
that was itself noise. That does not weaken the §5 argument — cluster-weighted is
still the correct treatment on statistical grounds, chosen a priori — but it does
mean the flipped "verdict" was never a real verdict in either direction. The
resolution point stands and is reinforced: at 3 clusters, neither answer was
estimable.

Full result and interpretation: [`holdout-result.md`](./holdout-result.md).

## 6. Conclusions

1. **PAR is not shipped, and this strengthens rather than weakens that call.**
   Production stays on rank-ratio with its failure declared. `pointsCurve.ts`
   remains a tested library that nothing in production reads.
2. **No PAR-vs-RANK comparison on this sample should be treated as decisive.**
   Three clusters cannot support the claim in either direction.
3. **The blocker is cluster count, not modelling.** Both the aggregation
   sensitivity and the 9-value bootstrap point at the same thing: too few
   independent leagues. That is what audit §19 exists to fix, and it is now
   actionable — see [`holdout-protocol.md`](./holdout-protocol.md).
4. **The dependence itself is modest** (design effect 1.31) and is now visible on
   every fit rather than invisible.

## 7. What was deliberately NOT done

- No parameter, coefficient, cushion, anchor or curve setting was tuned to move
  any number here.
- The aggregation default was **not** selected by score; it scores worse than the
  alternative on this sample.
- The 2026-08-06 report was not rewritten to make its earlier claim look better.
  It is marked superseded and left intact.
