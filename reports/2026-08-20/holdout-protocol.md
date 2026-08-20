# Frozen holdout protocol — external validation of the shipped valuation chain

**Date frozen** 2026-08-20 · **Audit** §4 / §19 · **Status** FROZEN BEFORE EXECUTION

This document is written and committed **before** the holdout data is scored.
Everything below — architecture, preprocessing, sampling frame, filters, scoring
rule, metrics, and the success criterion — is fixed at commit time. Any change
after the first execution invalidates the holdout and must be recorded as a new,
separate protocol.

The purpose of freezing is narrow and specific: it removes the analyst's freedom
to keep adjusting until the answer improves. If the result is bad, the result is
bad.

---

## 1. Why a new sample was needed

The five Sleeper leagues used to date are **development data**. They have already
influenced:

- the diagnosis of the rank-ratio failure,
- the choice of the PAR architecture,
- the `STARTER_ANCHOR_TV` correction,
- the dependence treatment chosen in §5,
- every performance number quoted so far.

They are no longer an untouched sample and cannot be used as a holdout at any
point in the future.

Two independent lines of evidence say the existing sample is too small to settle
anything (see [`par-dependence-analysis.md`](./par-dependence-analysis.md)):

- the PAR/RANK verdict flips with the choice of dependence treatment;
- the PAR bootstrap interval is a percentile of **9 distinct values** across 3
  clusters, because a `k`-cluster bootstrap can reach only `C(2k−1, k)` distinct
  multisets regardless of iteration count.

The blocker is **cluster count**, not modelling.

## 2. Data source — MyFantasyLeague

Sleeper exposes no public league directory, which is what previously made an
untouched sample look unobtainable. **MyFantasyLeague does.**

`https://api.myfantasyleague.com/{year}/export?TYPE=leagueSearch&SEARCH={term}&JSON=1`
returns real, completed, public league ids. Measured 2026-08-20: **18,723 unique
candidate league ids for season 2023 alone** from 10 search terms.

Endpoints used (all public, all `JSON=1`, all requiring redirect-follow because
the API host 302s to the league's own server):

| TYPE | supplies | role |
|---|---|---|
| `leagueSearch` | candidate league ids | sampling frame |
| `league` | franchises, roster limits, starters, scoring | league format |
| `draftResults` | round / pick / player / franchise | **model input** |
| `leagueStandings` | h2h record, points for | **outcome** |
| `playoffBrackets` | bracket sizes | outcome (playoff field size) |
| `playerScores` (`W=YTD`) | league-scored season points | stored for later PAR work; **not used in this protocol** |

Attribution, licensing, rate limits and retention are recorded in
[`docs/data-source-map.md`](../../docs/data-source-map.md). Requests are throttled
and carry an identifying User-Agent; the API returns HTTP 429 when pushed, which
the harness respects with backoff.

Independence from the development set is structural: different platform,
different manager population, no overlap of league ids is even possible.

## 3. What is being tested

**The shipped production chain, end to end, unchanged:**

```
draft pick order
  -> positional rank
  -> positionReplacementRank(position, format)
  -> ecrToTrueValue
  -> PlayerMarketRecord
  -> runNexusSimulation
  -> playoffProbability
```

This is the exact chain that renders in the product. No substitutions.

**The PAR candidate is NOT evaluated in this protocol.** It needs a points curve
at runtime, and fitting one on MFL data introduces a second set of choices
(cross-platform scoring normalisation, curve seasons, positional mapping) that
have not been frozen. Mixing an unfrozen candidate into a frozen holdout is how
holdouts get burned. `playerScores` is archived so a *separately frozen* PAR
protocol can use it later without re-acquiring anything.

## 4. Preprocessing — frozen

1. **Positions.** Only `QB`, `RB`, `WR`, `TE`, `PK`, `DEF` are used. MFL `PK` maps
   to `K`; MFL `DEF`/`Def` maps to `DEF`. IDP positions (`DT`, `DE`, `LB`, `CB`,
   `S`) are **dropped**, and any league where they constitute more than 15% of
   drafted players is **excluded** (it is an IDP league, a different game).
2. **Positional rank** = 1-based order of appearance within position, sorted by
   overall pick number ascending. Identical rule to the Sleeper harness.
3. **Roster assignment** = the drafting franchise. Waiver adds, trades and
   end-of-season rosters are **not** used — the draft happens before week 1, so
   it cannot contain in-season information.
4. **League format** is parsed from MFL `league` settings (franchise count,
   starter slots). Where a field cannot be parsed, the league is **excluded**
   rather than defaulted.
5. **No outcome data enters any input.** Asserted in code, not promised.

## 5. Sampling frame — frozen and deterministic

1. Seasons: **2021, 2022, 2023, 2024**.
2. Search terms, in this fixed order:
   `redraft, league, football, ffl, fantasy, money, friends, keeper, the, dynasty`.
3. Candidate ids are pooled per season and **sorted ascending as integers**.
   Selection walks that sorted list in order. There is no randomisation and no
   scoring-dependent selection, so the frame is reproducible from the terms alone.
4. Inclusion filters, applied in order, all structural:
   - `draftResults` exists and is non-empty;
   - **`picks / franchises >= 12`** — a full redraft/startup draft. A dynasty
     rookie draft has ~5 and would make positional rank meaningless;
   - `8 <= franchises <= 16`;
   - IDP share of drafted players `< 15%`;
   - `leagueStandings` present with a record for every franchise;
   - a non-consolation playoff bracket exists, giving a playoff field size `P`
     with `2 <= P < franchises`.
5. Target: **200 leagues**, capped at 400 HTTP-fetched leagues per season to
   bound the load on a free public API. Whatever the filters yield is what gets
   scored — the target is not adjusted after seeing results.

## 6. Outcome label — frozen

`madePlayoffs = (regular-season standings rank <= P)`

- Standings rank is by MFL `leagueStandings`, sorted by `h2hw` descending then
  `pf` descending. Ties broken by `pf`; still-tied franchises are **excluded**
  from that league rather than arbitrarily ordered.
- `P` = the largest `teamsInvolved` among brackets whose name/title does not
  match `/consolation|toilet|loser|place|3rd|5th|7th/i`.

**Self-check, declared in advance:** the observed qualification rate must equal
`P / franchises` by construction. The harness computes both and **aborts the
league** if they differ by more than 0.001. A divergence means the bracket was
misread, and a misread outcome label would silently corrupt the whole result.

## 7. Scoring protocol — frozen

- Forecast: `runNexusSimulation(roster, params).playoffProbability / 100`, with
  `seed = 20260513`, `iterations = 2500`, `riskTolerance = 0.58` — the production
  `SIM_BASE` constants, unmodified.
- `weeklyProjections` is explicitly `null`, exercising the off-season structural
  path — the path a pre-draft user actually sees.
- One row per (league, franchise).
- Baselines:
  - **structural climatology**: the per-league constant `P / franchises`. Note
    this is *stronger* than a global constant, because it adapts to league shape.
  - **global climatology**: the pooled qualification rate across all leagues.
  - **raw draft capital**: `sum(totalPicks − pickNo)` over the franchise's picks,
    an AUC-only reference for whether the transform adds or destroys signal.

## 8. Metrics — frozen

Reported whether they flatter the model or not:

- Brier score
- Brier skill score against structural climatology
- Log loss (probabilities clamped to `[1e-6, 1−1e-6]`)
- AUC (Mann-Whitney, ties counted 0.5)
- ECE, 10 equal-width bins
- Reliability table (bin, n, mean forecast, observed rate)
- **Cluster bootstrap over whole leagues**, 5000 iterations, seed 12345
- **Effective cluster N**, and the **number of distinct bootstrap resample
  values** — the resolution check §5 established as necessary

## 9. Success criterion — declared before execution

The shipped chain is judged to have **positive external skill** if and only if,
on this sample:

1. the AUC 95% cluster-bootstrap CI lies **entirely above 0.5**, and
2. the Brier skill score against structural climatology has a 95% CI **entirely
   above 0**.

Anything else is a failure to demonstrate skill. In particular:

- an AUC point estimate above 0.5 with a CI spanning it is **not** success;
- an improvement over the development-set numbers is **not** success;
- "better than the old model" is **not** success.

If the result is a failure, it is reported as a failure. No coefficient,
cushion, anchor, slope or curve setting will be adjusted and re-run on this data.
Post-hoc tuning on a holdout converts it into development data permanently, and
there is no second untouched sample waiting behind it.

## 10. Execution rules

1. The harness runs **once**.
2. Raw acquired data is archived under `reports/2026-08-20/holdout-data/` so the
   run is reproducible without re-fetching, and so a re-run cannot quietly draw a
   different sample.
3. Full output — including failure — is written to
   `reports/2026-08-20/holdout-result.md`.
4. If a bug is found in the harness *after* execution, the fix and a re-run must
   be disclosed explicitly, with both results shown. Silently re-running until it
   works is the failure mode this section exists to prevent.

## 11. What this protocol cannot settle

- **Generalisation to Sleeper/ESPN.** MFL's manager population skews serious and
  dynasty-literate. A result here is evidence about redraft leagues on MFL.
- **Scoring-format coverage.** MFL leagues vary; coverage is whatever the frame
  yields and is reported, not controlled.
- **The PAR candidate.** Explicitly out of scope, per §3 above.
- **Causality.** This measures whether the chain ranks and calibrates. It does
  not explain why.
