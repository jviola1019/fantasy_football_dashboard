# Statistical Calibration Plan

**Sprint 3 update (2026-05-29):** The calibration helpers are now fully implemented:
`brierScore()` (Murphy decomposition), `reliabilityDiagram()`, and `kFoldCV()` ship in
`src/lib/stats/distribution.ts` and are covered by 14 property tests in
`distribution.test.ts` + `brierBacktest.test.ts`. The `ReliabilityDiagram` SVG component
renders in NexusSim's "Risk Analysis" tab (placeholder until backtest data is attached).
The backtest script `scripts/brier-backtest.ts` tries 2025 nflverse data first (2025
season is complete), falls back to local `C:/tmp/nfl_stats_2025.csv`, then to 2024 data.
Run `npx tsx scripts/brier-backtest.ts` to generate `docs/brier-results.md`.

Status: **structural** — the simulation engine is deterministic, replayable, and statistically well-behaved on its inputs. The calibration *helpers* are implemented; production *calibration against real outcomes* is still pending. This document is the contract for what production calibration will require and how the dashboard will report uncertainty in the meantime.

## What every metric encodes

| Metric | Definition | Bounds | Sensitivity |
| --- | --- | --- | --- |
| `scarcityGap` | `trueValue − perceivedValue + 0.18·ownershipLeverage − 0.08·fragility` | ±200 (theoretical), typically ±25 | monotone ↑ in `trueValue`, ↓ in `fragility` |
| `valuationGap` | `|trueValue − perceivedValue|·confidence + 0.12·max(0, ownershipLeverage)` | ≥ 0 | rises with disagreement |
| `narrativeVelocity` | `0.54·trendingMomentum + 0.28·volatility − 0.11·fragility` | ≈ ±90 | monotone ↑ in `trendingMomentum` |
| `chaosExposure` | `0.45·volatility + 0.4·fragility + 0.15·|trendingMomentum|` | ≥ 0 | monotone ↑ in `volatility` |
| `liquidityScore` | `(0.6·opportunity + 0.4·valuationGap)/10` | ≥ 0 | rises with opportunity |
| `championshipProbability` | fraction of simulated seasons whose **bracket winner** is the user's team | [0, 100]% | rises with roster strength + favorable variance |
| `playoffProbability` | fraction of simulated seasons the team finishes **top `playoffTeams`** in the standings | [0, 100]% | rises with roster strength |
| `catastrophicRisk` | fraction of seasons the team finishes in the **bottom third** of the standings | [0, 100]% | falls with roster strength |
| `regretIndex` | `1 − playoffProbability` (the chance you miss the playoffs) | [0, 100]% | inverse of playoff odds |

> These are genuine **season Monte Carlo** frequencies (`src/lib/seasonSim.ts`): a full round-robin schedule, each weekly matchup decided by sampled team scores, standings seeding a single-elimination playoff bracket. They are NOT the old "mean score > 83/73/69" threshold heuristic (that model was removed — see `docs/season-sim.md`).

The derived metrics are unit-tested in `src/lib/derivedMetrics.stats.test.ts` for determinism, range bounds, and sensitivity. The season sim is held to a calibration contract in `src/lib/seasonSim.test.ts` + `src/lib/simulation.calibration.test.ts` (a league-average roster makes the playoffs ≈ `playoffTeams/numTeams`, monotonic in strength, favorite-variance lowers title odds, real projections drive the odds, all probabilities bounded [0,1]).

## What the simulation consumes today

The engine reads `PlayerMarketRecord` fields (`trueValue`, `perceivedValue`, `volatility`, `fragility`, `ownershipLeverage`, `trendingMomentum`, `confidence`) and a `SimulationParams` tuple (`seed`, `iterations`, `rosterSlots`, `riskTolerance`). When connected to fixture data those inputs are documented dev calibration. When connected to real Sleeper/ESPN league data they default to zero (see `src/lib/normalize.ts`) — the dashboard correctly surfaces an `unavailable` envelope rather than fabricating signal.

## What production calibration requires

To claim accuracy against real-world outcomes the engine needs all of:

1. **Projections** — weekly point projections per player. Source candidates: FantasyPros consensus (paid), nflverse `ffanalytics` (free), Sleeper's projections if exposed. Maps to `trueValue`.
2. **Schedule** — opponent strength + matchup difficulty per week. Maps to a per-week multiplier on `trueValue`.
3. **Injury and depth chart** — current designation + percentile risk. Maps to `fragility`. Source: ESPN injury feed (already wired in `src/lib/espn/league.ts`), Sleeper `/v1/players/nfl` (which includes `injury_status`).
4. **Scoring rules** — league-specific PPR/half/std + bonus categories. Read from Sleeper `getLeague().scoring_settings` / ESPN `mSettings`. Modulates the projection → score transform.
5. **Ownership baseline** — league-wide ownership %. Maps to `ownershipLeverage`. Source: Sleeper trending + ESPN `mPositionalRatings`.
6. **News/sentiment** — narrative direction with timestamp. Maps to `trendingMomentum`. Source: ESPN's news JSON API — `src/lib/espn/news.ts` + `src/lib/espn/newsMatch.ts` (currently lexical only; sentiment classifier is future work). There is no RSS adapter and `src/lib/news/` does not exist.
7. ~~**Weather** — wind/precip at outdoor venues. Maps to a per-game adjustment on `volatility`. Source: `src/lib/weather/openmeteo.ts` (already wired).~~ **Struck 2026-09-01.** `src/lib/weather/` was deleted on 2026-08-24 (commit `29e6744`) because it was reachable only from its own test and no surface referenced it — see `docs/data-sources.md`, which recorded the removal correctly while this copy of the same claim went on advertising it as wired.

## Calibration procedure (when those inputs arrive)

1. **Historical replay.** Use prior seasons' settled outcomes as ground truth. For each completed week, run the simulation against the inputs available *at kickoff* (not in hindsight) and record predicted vs. actual.
2. **Brier score per probability metric.** Brier = mean((forecast − outcome)²). Targets, drawn from analogous fantasy/betting literature:
   - `playoffProbability`: Brier ≤ 0.20
   - `championshipProbability`: Brier ≤ 0.10
   - `catastrophicRisk`: Brier ≤ 0.15
3. **Reliability diagram.** Bin forecasts into deciles and plot observed frequency vs. predicted. Calibration is good when the diagonal is followed within ±5 percentage points per decile.
4. **K-fold cross-validation across seasons.** k = 3 (e.g., train on 2022–2023, validate on 2024). Avoids in-season leakage.
5. **Parameter tuning.** Use grid search over the documented constants in `src/lib/models.ts` (`0.18`, `0.08`, `0.54`, `0.28`, `0.11`, etc.). Each constant change is a PR that must improve the validation Brier scores without regressing test sensitivities in `derivedMetrics.stats.test.ts`.
6. **Recalibration cadence.** Quarterly during the season (post-Week 4, Week 9, Week 13). The cron in `vercel.ts` is the right place to schedule the recalibration job once the data pipeline exists.

## Confidence-band reporting standard

Wherever the dashboard displays a probability or rate computed from Monte Carlo output, it must also display the band around it, derived via `bootstrapCI` from `src/lib/stats/distribution.ts` — 500 resamples, alpha = 0.05, seed 1019, the same Mulberry32 RNG as the simulation engine, so the band is reproducible from `(seed, iterations, samples)` alone (`src/lib/envelope/derive.ts:74-75`).

**It is not a confidence interval, and this section used to say it was.** What `bootstrapCI` measures over simulation draws is how much the answer moves when the simulation is re-run — a Monte-Carlo *replication range*. It says nothing about whether the model is right, and the model's measured season calibration error is 16.13pp. Calling the ±1.5pp replication range a 95% confidence interval told the reader the forecast was roughly eleven times more certain than the evidence supports. Audit P0-4 retracted the wording on 2026-08-22; the function is `deriveReplicationRange` and the component is `ScenarioBands`, titled "Scenario Outlook". See `src/lib/envelope/derive.ts:41-47`.

For point estimates that are not Monte Carlo outputs (e.g. `scarcityGap` of a single player), no CI is displayed — the value is a deterministic function of inputs and uncertainty lives in the inputs themselves. Source confidence (`PlayerMarketRecord.confidence` ∈ [0, 1]) is surfaced verbatim in the source-state envelope.

## Out-of-scope this pass

- Bayesian updating of `trueValue` from in-game performance.
- Multi-week joint forecasting (correlation between consecutive weeks).
- Strategy-conditional simulations (e.g. "if I trade X for Y, replay 10k rosters").
- Public benchmarking against ESPN's or Yahoo's playoff projections.

All of the above are tractable extensions of the current engine; none are required to surface honest uncertainty today.
