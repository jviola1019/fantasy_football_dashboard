# Trade Value Backtest — Calibration Report (Pooled Multi-Season, 2022–2025)

## Purpose

This document records the methodology, data provenance, and empirical results for the
statistical backtest harness in `src/lib/trade/backtest.test.ts`. The backtest validates
whether the trade simulator's **market-derived player values** agree with **realized
fantasy production** — i.e. whether the value model is a sound basis for grading trades.

This is the **multi-season pooled** rebuild. The earlier version validated a single season
(2025) and measured ρ = 0.614; its Backtest A gate had to be lowered to 0.55 because one
season is dominated by injury noise. This rebuild pools **four completed seasons (2022,
2023, 2024, 2025)** — 784 player-seasons — so single-year injury luck is averaged out and
the correlation estimate is far more trustworthy.

---

## Concurrent validity vs. predictive validity

The trade simulator does not forecast the future. It grades trades happening **now** using
**current market-derived values** (positionally-adjusted, ECR-derived). The correct thing
to validate is therefore **concurrent (construct) validity**: *does a positionally-adjusted,
market-derived value model agree with realized fantasy production over the SAME period?*
A sound value model should. Value and outcome are measured over one common window, so the
test isolates "is the model internally sound" from "can anyone predict the NFL" (predictive
validity, which is inherently capped near ρ ≈ 0.4–0.5 by single-season NFL variance).

For each season the value snapshot is taken at that **season's end** (December / early
January) and paired with the **same season's** realized PPR VOR.

---

## Data Sources (REAL — every number traceable, nothing fabricated or estimated)

### Value side — `tradeValue`: DynastyProcess `values.csv`, `value_1qb` column

Repo: `dynastyprocess/data` (GitHub), which keeps full git history of `files/values.csv`.
For each season the GitHub commits API was used to find the automated weekly scrape commit
dated nearest that season's end (after Week 18 completed), and the file was fetched from
`raw.githubusercontent.com/dynastyprocess/data/<commit-sha>/files/values.csv`.

`value_1qb` is a **redraft, positionally-adjusted, ECR-derived** cardinal value — the same
column the production trade-value pipeline reads (`parseDynastyProcessCsv` in
`src/lib/trade/values.ts`). It already bakes in positional scarcity, so it is directly
comparable to positional VOR with no cross-position mismatch.

| Season | Commit SHA | Commit date | `scrape_date` in file | URL |
|--------|------------|-------------|-----------------------|-----|
| 2022 | `fd4e1173795b3d74337edbe5debfa6e6a0433d6c` | 2023-01-13 | `2023-01-13` | `https://raw.githubusercontent.com/dynastyprocess/data/fd4e1173795b3d74337edbe5debfa6e6a0433d6c/files/values.csv` |
| 2023 | `2c0a665528809a88757f4e742f8f0a90f79c14f9` | 2024-01-12 | `2024-01-12` | `https://raw.githubusercontent.com/dynastyprocess/data/2c0a665528809a88757f4e742f8f0a90f79c14f9/files/values.csv` |
| 2024 | `aa76abea066c210415bbbc33afc2c68e6d937527` | 2025-01-10 | `2025-01-10` | `https://raw.githubusercontent.com/dynastyprocess/data/aa76abea066c210415bbbc33afc2c68e6d937527/files/values.csv` |
| 2025 | `b8060540eff0dac02c2f16ed774e7e1811c5e7f7` | 2026-01-09 | `2026-01-09` | `https://raw.githubusercontent.com/dynastyprocess/data/b8060540eff0dac02c2f16ed774e7e1811c5e7f7/files/values.csv` |

Each `scrape_date` is the weekend immediately after that season's Week 18, i.e. a literal
end-of-season snapshot with no following-season rookie contamination. All four URLs were
fetched and verified to return HTTP 200 with the identical 12-column header
(`player,pos,team,age,draft_year,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,scrape_date,fp_id`).
DynastyProcess git history reaches comfortably past 2022, so the full 4-season span the
task requested was sourced — no season was dropped.

### Production side — `fantasyPoints`: nflverse realized PPR totals

Source: **nflverse `stats_player_reg_<YEAR>`**, `fantasy_points_ppr` column — regular-season
aggregated player stats. All four files were downloaded 2026-05-21 and returned HTTP 200.

| Season | URL | Rows |
|--------|-----|------|
| 2022 | `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2022.csv` | 2,007 |
| 2023 | `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2023.csv` | 1,943 |
| 2024 | `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2024.csv` | 1,997 |
| 2025 | `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv` | 2,020 |

`fantasy_points_ppr` uses standard full-PPR scoring (4-pt passing TD, 1 pt per reception,
0.1 pt/yd, 6-pt rush/rec TD, −2 INT/fumble). Only `season_type == "REG"` rows matching the
target `season` are used.

### Join

The two sources are joined per season on normalized `name + position` (lowercased,
punctuation and common suffixes — Jr/Sr/II/III/IV/V — stripped). For each season the joined
pool is sorted by `tradeValue` within position and the **top 28 QB / 60 RB / 80 WR / 28 TE**
are kept (196 rows/season, 784 total). Unmatched DynastyProcess players (season-long
injuries with no stat line) are correctly excluded — they have no realized production to
pair. Per-season join coverage: 2022 matched 440 of 522, 2023 matched 467 of 593, 2024
matched 431 of 484, 2025 matched 386 of 425; every position had far more matches than the
pool depth taken, so the fixture is filled entirely with genuine fantasy-relevant players.

---

## Fixture Coverage

File: `src/lib/trade/fixtures/backtest-multiseason.json` (784 rows). Each row is
`{ season, name, position, tradeValue, fantasyPoints }`. The earlier single-season file
`backtest-2025.json` is **deleted** — this multi-season fixture supersedes it.

The pool is deliberately deeper than `REPLACEMENT_RANKS` at every position (28 QB vs QB13,
60 RB vs RB25, 80 WR vs WR37, 28 TE vs TE13), so every realized-VOR baseline lands on a
genuine mid-tier replacement player rather than the worst (often injured) player in the
sample. Baseline players actually landed on per season:

| Season | QB13-area baseline | RB25-area baseline | WR37-area baseline | TE13-area baseline |
|--------|--------------------|--------------------|--------------------|--------------------|
| 2022 | Lamar Jackson (QB14, 236.1) | AJ Dillon (RB26, 167.6) | Tyler Boyd (WR38, 167.1) | Juwan Johnson (TE14, 134.8) |
| 2023 | Russell Wilson (QB14, 256.9) | Austin Ekeler (RB26, 185.4) | Brandin Cooks (WR38, 173.2) | Dallas Goedert (TE14, 136.3) |
| 2024 | Geno Smith (QB14, 266.0) | Tyrone Tracy Jr. (RB26, 182.3) | Cooper Kupp (WR38, 175.0) | Isaiah Likely (TE14, 123.7) |
| 2025 | Sam Darnold (QB14, 235.4) | Quinshon Judkins (RB26, 169.8) | Rashid Shaheed (WR38, 156.6) | AJ Barner (TE14, 147.3) |

(Index shows the actual sorted rank `realizedVor` lands on — `REPLACEMENT_RANKS` is
0-vs-1-indexed so QB13 → sorted index 13 → QB14.) Every baseline is a real, recognizable
mid-tier player — the VOR baseline artifact from the original 37-WR fixture is fully fixed.

---

## Pooling Method (rigorous)

Absolute realized VOR is **not** comparable across seasons: scoring environments shift, and
each season has its own injury distribution. The pool is therefore **standardized within
season** before any statistic is computed.

**Backtest A.** For each season: (1) compute realized PPR VOR with `realizedVor` /
`REPLACEMENT_RANKS`; (2) z-score **both** `tradeValue` and realized VOR *within that season*
using the new `zScores` helper. The standardized pairs from all four seasons are pooled
into one ~784-row array and a **single `spearman()`** call is run on the pool. Pooling
happens after standardization, so a high-scoring or injury-heavy season cannot dominate.

Standardization choice — **within season** (not within season×position). Spearman is
invariant to monotone transforms, so within-season z-scoring is what removes the
cross-season scale difference; cross-position mixing was checked and found to be a
second-order effect (within-season-only pooled ρ = 0.648 vs within-season×position pooled
ρ = 0.661 — a 0.013 difference). The simpler within-season standardization is used as the
headline method; the ~0.01 it leaves on the table is documented here rather than hidden.

**Backtest B.** 1-for-1 pairings are swept **within each season only** — players are never
paired across seasons because the value scales differ. Realized VOR is z-scored within
season, each pair's gap is the absolute difference of the two standardized VORs, and gaps
are pooled by verdict across all four seasons before `welchTTest` / `cohensD`.

A new exported helper `zScores(values: number[]): number[]` was added to `backtest.ts`
(sample-stdev denominator, returns all-zeros for a constant input, empty for empty input)
with its own three unit tests in `backtest.test.ts`. The `spearman`, `realizedVor`, and
`REPLACEMENT_RANKS` algorithms were **not** modified.

---

## Backtest A: Pooled Concurrent-Validity Spearman Rank Correlation

### Per-season ρ (raw `tradeValue` vs realized VOR, n = 196 each)

| Season | ρ |
|--------|---|
| 2022 | 0.643 |
| 2023 | 0.677 |
| 2024 | 0.662 |
| 2025 | 0.614 |

The per-season correlation is remarkably **stable** — every season lands in 0.61–0.68.
That stability is itself the key finding: the ~0.65 concurrent correlation is not a
2025-specific injury accident, it is the structural relationship in *every* season.

### Pooled ρ (within-season z-standardized, n = 784)

**Pooled Spearman ρ = 0.648.**

- Within-season z-standardized pool (headline test method): **ρ = 0.648**.
- Raw pooled (no standardization): ρ = 0.647 — essentially identical, confirming
  standardization does not flatter the result.
- Within-season×position standardized pool: ρ = 0.661 (alternative, see method note).
- Non-parametric bootstrap 95% CI on the pooled ρ (2,000 resamples of player-seasons,
  seed 20260521): **[0.602, 0.692]**.

Pooled per-position correlation (within-season z): RB 0.731, WR 0.689, QB 0.528, TE 0.533.
RB and WR value tracks realized production tightly; QB and TE are noisier — small
fantasy-relevant pools plus a few high-impact injuries dominate them every season.

### Threshold

**Gate in test: ρ ≥ 0.62. Measured pooled ρ = 0.648 → PASS.**

The task's nominal target was ρ ≥ 0.7. **The real pooled ρ is 0.648, and its entire
bootstrap 95% confidence interval [0.602, 0.692] sits below 0.70.** Pooling four seasons
did exactly what it should — it shrank the *sampling* uncertainty of the estimate — but it
did **not** lift the point estimate to 0.70, because the per-season ρ is structurally
~0.65 in every one of the four seasons, not just in 2025. The honest conclusion is that
the original calibration doc's hope that "multi-season pooling would likely push ρ into the
0.75–0.9 band" was **wrong**: pooling reduces estimator variance, it does not change the
underlying construct correlation.

Per the task's explicit rule — *if a real pooled number still does not clear a nominal
gate, do NOT fabricate and do NOT silently weaken; set the gate to the value the data
supports and justify it* — the Backtest A gate is set to **ρ ≥ 0.62**. That value is
cleared by the 0.648 point estimate with margin and sits above the bootstrap lower bound
(0.602), so the test is a genuine, non-trivial pass rather than a rubber stamp.

Why the honest ceiling is ~0.65 and not ~0.8, and why pooling cannot fix it:

1. **Single-season realized VOR is an intrinsically noisy criterion — in every season.**
   Even a perfect value model is bounded by in-season injuries, role changes, and scheme.
   Each season has its own crop of high-value players who lose most of the year (2022:
   numerous; 2025: Malik Nabers torn ACL Week 4, Tyreek Hill season-ending knee). A value
   snapshot taken that same January still ranks those players where their body of work and
   role place them — that is what a value model is *for*. These are large rank inversions
   no sound model avoids, and they recur every year, so pooling averages the *estimate* but
   not the *phenomenon*.
2. **`value_1qb` is a redraft value with a mild age tilt** — it modestly suppresses
   productive veterans. This is a minor, second-order effect (the original single-season
   analysis found `ecr_1qb` gave an essentially identical ρ).
3. **Concurrent ≠ tautological.** Value is a forward-looking market consensus; realized
   VOR is one noisy sample of the outcome distribution. They are strongly related but not
   identical — exactly as construct-validity theory predicts. A ρ of ~0.65 with a 784-point
   sample is a strong, unambiguous positive relationship.

A ρ ≥ 0.62 gate is defensible: it is far above zero, above the ρ ≈ 0.4–0.5
predictive-validity ceiling, and the test demonstrates the value model has real concurrent
construct validity across four independent seasons — without overclaiming a precision the
real data does not support.

---

## Backtest B: Pooled Verdict Calibration

**Method.** For every 1-for-1 pairing of the 196 fixture players **within each season**
(4 × 19,110 = 76,440 pairs total), call `evaluateTrade` to get the verdict
(`balanced` / `slight-edge` / `lopsided`). The realized VOR gap is the absolute difference
of the two players' realized VOR **z-scored within their season**. Gaps are pooled by
verdict across all four seasons; Welch's t-test and Cohen's d compare `balanced` vs
`lopsided`.

**Pooled results:**

| Verdict     | Pairs (n) | Mean standardized realized VOR gap |
|-------------|-----------|------------------------------------|
| balanced    | 3,162     | 0.849 |
| slight-edge | 5,290     | 0.843 |
| lopsided    | 67,988    | 1.164 |

- `meanDelta` (balanced − lopsided) = **−0.315**  (gate: < 0 → **PASS**)
- `pTwoSided` ≈ **0** (Welch t = −26.47, df ≈ 3,718 — far beyond p < 0.05)  (gate: < 0.05 → **PASS**)
- `cohensD` = **−0.367**  (gate: |d| ≥ 0.30 → **PASS**)

The direction is correct and overwhelmingly significant: trades the model calls "balanced"
end ~0.32 standardized-VOR units closer in realized production than trades it calls
"lopsided", and the buckets are monotone (balanced ≈ slight-edge ≈ 0.84 < lopsided ≈ 1.16).

### Threshold

**Gates in test: `meanDelta < 0`, `pTwoSided < 0.05`, `|cohensD| ≥ 0.30`. All PASS.**

`meanDelta < 0` and `pTwoSided < 0.05` are kept at the task's nominal values and pass with
enormous margin (t = −26, p effectively zero). The Cohen's d gate is set to **0.30**, not
the nominal 0.5. **The real pooled |d| is 0.367.** Pooling four seasons *did* lift d — from
0.31 single-season to 0.367 pooled, the direction the original doc predicted — but it did
not reach 0.5, for the same structural reason as Backtest A: Cohen's d divides the mean
difference by a pooled standard deviation that is itself inflated by the high
within-bucket variance of single-season realized outcomes, and that variance is intrinsic
to NFL seasons, not a sampling artifact pooling can erase. A standardized effect of 0.367
is a solid small-to-medium effect; combined with a t-statistic of −26 it is not remotely a
chance finding. Per the task's "set the gate to what the data supports" rule, the |d| gate
is **0.30** — cleared by the measured 0.367 with margin.

---

## What Is Empirically Validated vs. Assumed

### Validated by this backtest

- `spearman()`, `realizedVor()`, and the new `zScores()` helper are correct (5 unit tests
  pass; 8 tests total in the suite).
- A **positionally-adjusted, market/ECR-derived value model has real concurrent construct
  validity, replicated across four independent seasons**: it rank-correlates with
  same-season realized PPR VOR at a pooled ρ = 0.648 (per-season 0.61–0.68) over a
  784-player-season real fixture.
- The simulator's **verdict thresholds** (`BALANCED_MAX = 10%`, `SLIGHT_MAX = 25%` in
  `evaluate.ts`) are directionally calibrated and replicate across four seasons:
  balanced-verdict trades end significantly closer in standardized realized VOR than
  lopsided ones (pooled meanDelta = −0.315, p ≈ 0, d = −0.367).
- Every number in `backtest-multiseason.json` comes from a real, cited source — four
  DynastyProcess `value_1qb` snapshots pinned by commit SHA, four nflverse
  `stats_player_reg_<YEAR>` files. **No data was fabricated or estimated.**

### Not validated / out of scope

- **Predictive** validity (preseason value → realized outcome) is not tested — the
  simulator does not make preseason forecasts, so this is by design.
- The exact nominal magnitudes ρ ≥ 0.7 and |d| ≥ 0.5 were **not** reached even after
  pooling four seasons. The gates are honestly set to **ρ ≥ 0.62** and **|d| ≥ 0.30**, the
  values the real pooled data clears. The pooled ρ's entire 95% CI [0.602, 0.692] lies
  below 0.70, so 0.70 is empirically unsupported, not merely unreached.

### Assumed / limitations

- **Single-season realized VOR is a noisy validity criterion.** Pooling four seasons
  removes *sampling* noise from the estimate but not the intrinsic season-to-season
  injury/role variance in the outcome itself — that is why ρ plateaus near 0.65. Adding
  more seasons would tighten the CI further but would not move the point estimate above
  ~0.65.
- **PPR scoring convention.** nflverse standard PPR (4-pt pass TD, no yardage bonuses) is
  applied consistently to every player and season; leagues with 6-pt pass TDs would shift
  QB ranks slightly.
- **Fixed replacement ranks.** `REPLACEMENT_RANKS` assumes a 12-team, 1QB league.
- **No games-played adjustment.** Realized VOR uses full-season totals including games
  missed to injury — intentional, since that is the real risk a value model and a trade
  verdict must price in.
