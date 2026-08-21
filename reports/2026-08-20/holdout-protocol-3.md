# Frozen protocol 3 — does the REPUTATION EDGE predict anything?

**Date frozen** 2026-08-21 · **Audit** §19 follow-up · **Status** FROZEN BEFORE EXECUTION

Written and committed **before** any edge metric is computed. Architecture,
preprocessing, unit of analysis, clustering, hypotheses, multiplicity correction
and success criteria are fixed at commit time.

## 1. Why this target, and not the season simulator

Protocols 1 and 2 tested `runNexusSimulation` → playoff probability. That is
**one panel**. A codebase scan shows the same failed chain's `trueValue` also
drives:

| surface | decision it makes |
|---|---|
| `draft/tiers.ts` | tier boundaries — where the "cliffs" are |
| `draft/keepers.ts` | whether a keeper is worth its cost |
| Waiver Wire | claim priority (`trueValue + edge·0.4 + opportunity·0.4 + scarcity·0.8`) |
| Player Universe, Market Intelligence, Draft Intelligence | the rankings shown to the user |

**None of these has ever been validated.** Every validation in this repository —
`docs/model-validation-plan.md`, the 2026-08-17 execution, both holdout protocols
— measured playoff probability alone.

More pointedly, the product is named for a quantity nothing has tested:

```
reputationEdge = trueValue − perceivedValue + ownershipLeverage·0.18 − fragility·0.08
```

Both inputs derive from the **same** FantasyPros ECR:

- `perceivedValue = ecrToPerceivedValue(rank_ecr, maxRank)` — **overall** rank, 0-100
- `trueValue = ecrToTrueValue(_, posRank, replacementPosRank)` — **positional** rank
  against replacement, 0-100. Note `rank_ecr` is accepted and unused; trueValue
  depends only on positional rank and replacement rank.

So the "arbitrage" is **not private information**. It is the claim that *consensus
overall ranking under-weights positional scarcity relative to our replacement
model* — classic VBD-versus-ADP. That is a real and testable claim, and if it is
false then the draft, waiver and keeper recommendations lose their basis
regardless of what the season simulator does.

## 2. Why the statistics are better here

Protocol 2's D4 showed the season-level test could not resolve the ~0.02 AUC
effect actually present: 68 clusters is not enough. The unit there was a
team-season.

Here the unit is a **player-season**, and the archived sample already holds
**115,156 player-score rows across 140 leagues**. No new acquisition is needed,
and the resolvable effect size is far smaller.

## 3. Data — already archived, nothing new fetched

| source | supplies |
|---|---|
| `draftResults` | overall pick order → overall rank and positional rank |
| `playerScores` (`W=YTD`) | realized league-scored season points |
| `_players-{season}.json` | position |
| `league` | franchise count and starter slots → replacement rank |

## 4. Preprocessing — frozen

1. Positions `QB, RB, WR, TE, K, DEF` only; IDP dropped, IDP-heavy leagues
   excluded, exactly as protocols 1 and 2.
2. **Overall rank** = 1-based order of the pick across the whole draft.
   **Positional rank** = 1-based order within position. Both fixed before week 1.
3. `trueValue = ecrToTrueValue(posRank, posRank, positionReplacementRank(position, format))`
   and `perceivedValue = ecrToPerceivedValue(overallRank, totalPicks)`, using the
   **production functions unmodified**.
4. **`edge = trueValue − perceivedValue`.** The `ownershipLeverage` and
   `fragility` terms are **NOT tested** — they have no historical values for MFL
   leagues. Their weights are 0.18 and 0.08, so this tests the dominant term, and
   the omission is a stated limitation rather than a silent simplification.
5. **Points are normalised WITHIN league** to a z-score before any pooling.
   League scoring rules differ, so raw points are not comparable across leagues;
   z-scoring within league makes them so and removes league scoring level and
   spread as confounds.
6. A player with no `playerScores` entry is dropped — no imputation.

## 5. Outcome — draft-cost-adjusted performance

The question is not "did this player score a lot" (the first pick usually does).
It is **"did this player beat what their draft cost implied?"**

- `expected(overallRank)` is fitted by **non-increasing isotonic regression** on
  (overall rank → within-league points z-score), **leave-one-league-out**. The
  monotone constraint is the same structural assumption documented in
  `docs/points-curve-assumptions.md`, and it is imposed, not observed.
- **`residual = pointsZ − expected(overallRank)`.**

## 6. Clustering — the trap this protocol must not fall into

One NFL player-season appears in up to 140 leagues **with the same realized
points**. Treating those as independent observations would be the §5
pseudo-replication error at far greater magnitude, and would manufacture
significance out of nothing.

**All inference clusters on `season:playerId`, not on league.** The cluster
bootstrap resamples whole player-seasons. Effective N is the number of distinct
player-seasons and is reported beside every statistic.

## 7. Confirmatory hypotheses — Holm-Bonferroni across the family

| id | hypothesis | statistic |
|---|---|---|
| **H1** | the edge predicts beating draft cost | Spearman correlation of `edge` with `residual` > 0 |
| **H2** | the edge is not merely a position label | H1's correlation, computed **within position** and pooled, > 0 |
| **H3** | the edge beats ADP as a decision rule | concordance: among player pairs drafted within 12 overall picks of each other, the higher-edge player has the higher `pointsZ` more than half the time |

**H2 exists because the edge is largely a positional-scarcity signal.** If it
only works *across* positions it may be saying nothing more than "draft running
backs earlier", which is a positional-value claim, not an arbitrage one. H2
isolates whether it discriminates *among players at the same position*.

**H3 is the decision test.** It mirrors what the product actually asks a user to
do: at a given draft cost, prefer the higher-edge player.

### Success criterion — declared now

The reputation edge is demonstrated **if and only if all three of H1, H2, H3 are
significant after Holm correction at α = 0.05**, one-sided, with inference
clustered on player-season.

Explicitly NOT success: two of three; significance before correction but not
after; a positive point estimate with an interval spanning zero.

## 8. Diagnostics — reported, never adjudicating

- **D1** effect size in plain units: mean `pointsZ` difference between the top and
  bottom edge quintile, at matched draft cost.
- **D2** edge distribution by position — is the edge nearly constant within a
  position, i.e. a relabelled position dummy?
- **D3** minimum detectable correlation at 80% power given the **effective**
  cluster count, so a null states what it could have found.
- **D4** the same test on `perceivedValue` alone and on `trueValue` alone, to see
  which half of the difference carries whatever signal exists.

## 9. Prohibited

- Tuning any weight, threshold or transform on this data.
- Re-running after seeing the result. A harness bug found afterwards requires the
  fix and **both** results to be disclosed.
- Promoting a diagnostic to a criterion.
- Dropping a confirmatory hypothesis that comes out badly.

## 10. What a failure would mean

That the product's central claim — that it identifies mispriced players — is
unsupported on 140 leagues of real drafts and real outcomes. That is a more
serious finding than the season simulator's failure, because playoff percentages
are already presented as scenarios while draft and waiver rankings are presented
as advice.

It would **not** mean the rankings are worse than nothing: `perceivedValue` is
consensus ECR, which is a strong baseline. It would mean the *adjustment* RAE
layers on top is not adding value, and the honest response is to say so on those
surfaces.
