# Protocol 6 result — is leave-one-week-out optimistic?

> **Protocol** frozen at `reports/2026-08-20/holdout-protocol-6.md` before this harness existed.  
> **Input** `reports/2026-08-20/brier-prospective.json.gz`, captured 2026-08-23T19:39:27.895Z — the committed P2-5 snapshot, replayed, never re-fetched.  
> **Rows** 3,573 player-weeks · **402** distinct players · 8.9 weeks per player on average  

## The dependence being tested

Each player appears in **8.9 rows on average**. Under leave-one-week-out every one of a player's other weeks is in the training set for the week being scored, so the folds are separated in time but not in players.

## Result

| scheme | folds | ECE | Brier | rows scored |
|---|---|---|---|---|
| **A** leave-one-week-out *(shipped)* | by week | **0.0160** | 0.2072 | 3,573 |
| **B** grouped by player *(primary)* | 5-fold | **0.0153** | 0.2065 | 3,573 |
| C week ∧ player disjoint *(diagnostic)* | 5-fold | — | — | 0 |

**ECE(B) − ECE(A) = -0.0006** · 95% cluster bootstrap [-0.0075, 0.0066] · 5,000 resamples on 402 player clusters, paired within resample.

### Verdict against the pre-declared rule: **NOT DETECTABLE**

The interval includes zero. **There is no detectable optimism at this sample size**, and per protocol §7 the claim that leave-one-week-out is optimistic is RETRACTED — replaced by this interval. That is the outcome §2 warned was plausible: the model has one feature and player identity is not in it, so the leak was always bounded.

### Why diagnostic C is empty

Scheme C scored **zero rows**, and that is informative rather than a gap. With 402 players spread across every week of the season, each player-fold's set of weeks covers essentially the whole schedule — so excluding every row that shares a week with the test fold leaves nothing to train on.

The strict scheme is **inexpressible on this data**, and the reason is exactly the dependence protocol 6 set out to measure: players span weeks so thoroughly that week-disjointness and player-disjointness cannot both hold. Reporting a number here would have required weakening one of them, which the frozen protocol forbids.

### Per position (diagnostic, not a criterion)

| position | ECE A | ECE B | difference | n |
|---|---|---|---|---|
| QB | 0.0331 | 0.0375 | +0.0044 | 512 |
| RB | 0.0327 | 0.0358 | +0.0032 | 876 |
| WR | 0.0175 | 0.0230 | +0.0055 | 1470 |
| TE | 0.0246 | 0.0262 | +0.0016 | 715 |


### A disagreement between the pooled and per-position views

Every position individually shows B worse than A (+0.0016 to +0.0055), while the **pooled** difference is -0.0006. Pooling forecasts from four positions into shared bins lets well-calibrated and poorly-calibrated regions offset each other, so the pooled figure is not the average of the per-position ones.

**The verdict above is unchanged**, because the pooled statistic is what protocol 6 §5 declared as primary and §8 forbids promoting a diagnostic to a criterion after seeing it. But the consistent positive sign across all four positions is the kind of pattern a larger sample might resolve into a real effect, and it would be dishonest to report the pooled null without it.

What this does **not** license: quoting the per-position numbers as the finding. They were declared a diagnostic before the run, and they stay one.
### What is NOT claimed

- Brier is reported above and is **not** a criterion. It mixes calibration and discrimination, so a Brier move cannot settle a calibration question.
- Scheme C is a diagnostic. Excluding every row sharing a week with the test fold removes a large share of the training data, so a worse score there confounds leakage with sample size.
- This measures the CALIBRATION model's fold structure. It says nothing about whether the projections themselves are any good, which protocols 1–3 already answered separately.

Reproduce: `npm run holdout:evaluate6` · arithmetic: `npm run holdout:evaluate6 -- --self-test`
