# Frozen protocol 4 — does OPPORTUNITY add anything over production to date?

**Date frozen** 2026-08-21 · **Audit** §19 follow-up · **Status** FROZEN BEFORE EXECUTION

Written and committed **before** any metric is computed.

## 1. The question, and why it is this one

Protocols 1–3 established a single structural fact: every predictor in RAE's
valuation is a monotone function of consensus rank, so the model *is* the market
re-expressed and cannot beat it. Protocol 2's D3 put the draft-only ceiling below
the base rate even for a model fitted directly to the answer.

The only way out is information consensus has not priced. RAE already collects
exactly one such signal and **never uses it in valuation**: nflverse
`opportunity` (snap share) is stamped onto every record and does not enter
`trueValue`.

It is independent of ADP for a structural reason: **ADP freezes at the draft;
usage updates every week.**

> **Does usage through week 8 predict weeks 9–17 BEYOND what points scored
> through week 8 already predict?**

The "beyond" is the whole point. Opportunity that merely restates production is
worthless as an addition. The fantasy-analytics thesis being tested is that
**volume is sticky and efficiency is not**, so usage should carry information
that scoring alone does not.

## 2. Why this baseline and not ADP

The honest baseline for an *in-season* decision is **production to date**, not
draft position. A waiver decision in week 9 has eight weeks of results available;
pretending the only alternative is a stale ADP would be choosing a weak opponent.
If opportunity cannot beat points-to-date, it does not deserve a place in the
valuation.

## 3. Data — nflverse, free, CC-BY

| file | supplies | join |
|---|---|---|
| `player_stats_{season}.csv` | weekly `fantasy_points_ppr`, `carries`, `targets`, `target_share`, `wopr`, position | **none** — outcome and primary features share this file |
| `snap_counts_{season}.csv` | weekly `offense_pct` | **name join** — keyed on `pfr_player_id`, not the GSIS `player_id` |

**The primary test is join-free by design.** `snap_counts` cannot be joined to
`player_stats` on an id, only on a normalised name — the same fragility RAE's own
`normalizeOppName` has. So snap share is a **secondary** test and its match rate
is reported, never assumed.

Seasons **2021, 2022, 2023, 2024**. Regular season only (`season_type == "REG"`),
weeks 1–17.

## 4. Preprocessing — frozen

1. Positions **RB, WR, TE** only. These are where waiver and opportunity
   decisions actually happen; QB/K/DEF have different usage semantics and a
   touches metric is not comparable for them. Excluded with reason, not silently.
2. **Split**: features from weeks 1–8, outcome from weeks 9–17.
3. A player-season is included only with **≥ 4 games in weeks 1–8** and **≥ 4
   games in weeks 9–17** — otherwise the per-game means are noise.
4. All quantities are **per game played**, not per week, so missed games do not
   masquerade as low usage.
5. **Primary opportunity** = `(carries + targets) / games` in weeks 1–8 —
   touches, the canonical volume measure, defined identically for RB/WR/TE.
6. **Baseline** = `fantasy_points_ppr / games` in weeks 1–8.
7. **Outcome** = `fantasy_points_ppr / games` in weeks 9–17.
8. Features are standardised **within (season, position)** so cross-era and
   cross-position scoring levels cannot leak in — the specific mistake that
   produced protocol 3's retracted QB artifact.

## 5. Clustering — frozen

The same player appears across seasons and their skill persists, so
player-seasons are **not** independent.

**All inference clusters on `player_id`.** Effective N is the number of distinct
players and is reported beside every statistic.

## 6. Confirmatory hypotheses — Holm-Bonferroni, all three required

| id | hypothesis | statistic |
|---|---|---|
| **H1** | opportunity adds over production | partial Spearman of touches with outcome, controlling for points-to-date, > 0 |
| **H2** | it is not a position artifact | H1 computed **within position** and pooled, > 0 |
| **H3** | it changes a decision | among players matched on points-to-date (same decile), the higher-touch player has the higher outcome more than half the time |

H2 and H3 exist because of what protocols 3 taught: a cross-position result can
be manufactured by positional composition, and a correlation is not the same as a
decision rule.

### Success criterion — declared now

Opportunity earns a place in the valuation **if and only if all three of H1, H2,
H3 survive Holm correction at α = 0.05**, one-sided, clustered on player.

Explicitly NOT success: two of three; significance before correction but not
after; a positive point estimate with an interval spanning zero.

## 7. Diagnostics — reported, never adjudicating

- **D1** out-of-fold (leave-one-season-out) Spearman of three models against the
  outcome: points-to-date alone; touches alone; both. The practical question is
  whether "both" beats "points alone".
- **D2** the same for `target_share` and `wopr`, which are share-based rather
  than count-based.
- **D3** snap share (`offense_pct`), joined by normalised name, **with the match
  rate stated**. Secondary precisely because the join can fail.
- **D4** minimum detectable correlation at 80% power given the effective cluster
  count, so a null says what it could have found.
- **D5** effect size in plain units: mean outcome difference between top and
  bottom touch quintile at matched points-to-date.

## 8. Prohibited

- Tuning any threshold, weight or window on this data. The 8/9 split and the
  4-game minimum are fixed here, before any result is seen.
- Re-running after seeing the result. A harness bug found afterwards requires the
  fix and **both** results disclosed.
- Promoting a diagnostic to a criterion.
- Shipping any model change on a diagnostic alone.

## 9. What each outcome would mean

**If it passes** — RAE has a real, independent signal it is currently collecting
and discarding. The model changes in `docs/model-direction-2026-08-21.md` become
justified: an opportunity term in `trueValue`, and a re-weighted waiver formula.

**If it fails** — RAE has no independent signal anywhere in its current data, and
the honest position is to compete on governance, freshness and UX rather than on
prediction. That is a legitimate product, and it is what the disclosures already
shipped in this audit describe.
