# Frozen protocol 5 — what weight should opportunity carry?

**Date frozen** 2026-08-22 · **Status** FROZEN BEFORE ANY SCORING

Written and committed **before** any weight is fitted or any metric computed.

## 1. The question, and why protocol 4 could not answer it

Protocol 4 established that in-season usage adds information beyond points
scored to date, and **explicitly forbade deriving a weight from that data**
(§8: no tuning, and no shipping on a diagnostic alone). So RAE's waiver formula
still carries an unjustified constant, now merely *evidenced* rather than
*asserted*.

> **Does a weighted combination of points-to-date and usage beat points-to-date
> alone, at a weight fitted WITHOUT looking at the data it is judged on?**

The whole difficulty is separating "we can fit a weight" from "the weight
generalises". A weight fitted and evaluated on the same seasons will always look
good; that is not evidence.

## 2. The split, and why this one

| set | seasons | role |
|---|---|---|
| **Fit** | 2021, 2022, 2023, 2024 | protocol 4's data — already spent on discovery, so fitting here contaminates nothing new |
| **Evaluation** | 2017, 2018, 2019 | **never touched by any protocol in this audit** |

Fitting on already-spent data and evaluating on genuinely fresh data is the only
arrangement that makes the evaluation meaningful. Reusing 2021–2024 for both
would measure curve-fitting, not skill.

**2020 is excluded from the primary, a priori.** No preseason, widespread
opt-outs and altered usage make it structurally unlike the others. The reason is
recorded **now**, before any result, because excluding a season *after* seeing
the answer would be indefensible. A pre-registered diagnostic (D3) adds it back,
so the verdict cannot rest on that judgement call.

## 3. Data and preprocessing — inherited from protocol 4, unchanged

nflverse (CC-BY). Positions **RB, WR, TE**. Regular season only. Features from
weeks 1–8, outcome weeks 9–17. Minimum 4 games in each half. All quantities per
game played. Features standardised **within (season, position)**.

Nothing here is re-chosen. Reusing protocol 4's preprocessing verbatim means a
difference in result cannot be attributed to a changed pipeline.

- **Baseline** `points` = `fantasy_points_ppr / games`, weeks 1–8
- **Opportunity** `touches` = `(carries + targets) / games`, weeks 1–8
- **Outcome** `fantasy_points_ppr / games`, weeks 9–17

## 4. How the weight is fitted — frozen

On the **fit set only**, ordinary least squares of the standardised outcome on
the two standardised predictors:

```
zOutcome ~ b_points * zPoints + b_touches * zTouches
```

The shipped weight is the ratio **w = b_touches / b_points**, i.e. how much a
standard deviation of usage is worth relative to a standard deviation of scoring.
The evaluation score is then `zPoints + w * zTouches`.

`w` is computed **once**, on the fit set, and is **not** adjusted afterwards for
any reason. If the evaluation fails, the answer is that the weight does not
generalise — not that a different weight should be tried.

## 5. Clustering

All inference clusters on `player_id`. The same player recurs across seasons and
their skill persists, so player-seasons are not independent. Effective N is the
number of distinct players and is reported beside every statistic.

## 6. Confirmatory hypotheses — Holm-Bonferroni, all three required

Evaluated **only** on 2017–2019.

| id | hypothesis | statistic |
|---|---|---|
| **H1** | the weighted score beats points alone | paired difference in Spearman vs outcome, > 0 |
| **H2** | it is not a position artifact | H1 computed **within position** and pooled, > 0 |
| **H3** | it changes a decision | among players matched on points-to-date decile, the higher weighted-score player has the higher outcome more than half the time |

### Success criterion — declared now

The weight ships **if and only if all three survive Holm correction at α = 0.05**,
one-sided, clustered on player.

Explicitly NOT success: two of three; significance before correction but not
after; a positive point estimate whose interval spans zero; or an improvement
that exists only in the fit set.

## 7. Diagnostics — reported, never adjudicating

- **D1** the fitted `w`, with its bootstrap interval on the fit set.
- **D2** the weight refitted independently on the evaluation set. If the two are
  wildly different, the weight is sample-specific even if H1 passes — that is
  information the reader needs, not a criterion.
- **D3** the whole evaluation repeated with 2020 included, so the a-priori
  exclusion is visible rather than load-bearing.
- **D4** out-of-fold Spearman for points-alone, touches-alone, and weighted, on
  the evaluation set — the practical magnitude, as in protocol 4.
- **D5** sensitivity of H1 to `w` across a range, showing whether the result
  depends on the precise fitted value or holds across a plateau.

## 8. Prohibited

- Fitting or adjusting `w` on the evaluation set.
- Re-running after seeing the result. A harness bug found afterwards requires the
  fix and **both** results disclosed.
- Promoting a diagnostic to a criterion.
- Shipping any weight this protocol does not license.

## 9. What each outcome means

**If it passes** — RAE can ship a weight with an out-of-sample justification, and
the waiver formula stops carrying an arbitrary constant.

**If it fails** — the honest conclusion is that opportunity is real (protocol 4)
but its *magnitude* is not stable enough to encode. The disclosure shipped after
protocol 4 stands unchanged, and the existing weight stays as it is: evidenced in
direction, unjustified in size, and labelled as such.
