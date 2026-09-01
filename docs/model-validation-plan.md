# Model validation — coverage gap and plan (2026-08-16)

## The finding

**The simulator that is validated is not the simulator the product uses.**

This was established by executed evidence, not inspection. Two model changes landed
in this branch — replacement level became league-derived, and the simulation's
opponent field became scoring-aware. Both harnesses were run before and after each
change and returned **bit-identical** numbers:

| Harness | Before | After replacement level | After sim anchor |
|---|---|---|---|
| `calibrate:season` playoff Brier / ECE | 0.0770 / 0.0096 | 0.0770 / 0.0096 | 0.0770 / 0.0096 |
| `calibrate:season` championship Brier | 0.0855 | 0.0855 | 0.0855 |
| `backtest:sleeper` pooled Brier / ECE | 0.1657 / 0.2583 | 0.1657 / 0.2583 | 0.1657 / 0.2583 |

Identical output after changing the model is **evidence of non-coverage, not of
safety**. Tracing why:

- **`calibrate:season`** calls `runSyntheticCalibration()`. It generates its own
  forecasts and scores them against its own draws. It measures self-consistency —
  that the machinery is internally honest — and touches no product code path.
- **`backtest:sleeper`** imports `runSeasonSimulation` from `lib/seasonSim.ts` and
  feeds it **real weekly scores** from completed Sleeper leagues. It never
  references `enrich`, `positionReplacementRank`, `trueValue`, or
  `runNexusSimulation`.

So there are two simulators:

| | `runSeasonSimulation` (seasonSim.ts) | `runNexusSimulation` (simulation.ts) |
|---|---|---|
| Input | real weekly score distributions | players → `trueValue` → points |
| Uses replacement level | no | **yes** (via `trueValue`) |
| Uses `avgStarterPtsFor()` / `AVG_STARTER_PTS_PPR` | no | **yes** |
| Drives the dashboard | no | **yes** |
| Backtested | **yes** — Brier 0.1657 on 10 real team-seasons | **no — nothing** |

The valuation chain the product actually ships — ECR → replacement level →
`trueValue` → `runNexusSimulation` → the odds on screen — has **no out-of-sample
validation at all**.

This matters against the project's own rules. `CLAUDE.md` states *"If a model lacks
calibration, do not present it as production-safe"* and *"Backtest output must
remain documented"*. The dashboard currently presents `runNexusSimulation` output
with a governance banner, and that banner is honest — it says the composite indexes
are *"not yet fitted to observed outcomes (QNT-01)"* — but the gap is wider than
that note implies: the simulation on top of them is unvalidated too.

## Why the two changes were still made

Both are **correctness** fixes with an argument independent of predictive accuracy:

- Replacement level ignored `numTeams`, `starters` and `numQbs`, so an 8-team,
  2-TE or superflex league received 12-team 1QB baselines. Three of the operator's
  four real leagues are not 12-team.
- The opponent field was PPR-anchored while the user's own starters were scored in
  the league's real format — the two sides of the comparison were in different
  units.

Neither claim depends on a backtest. But neither is *validated* either, and this
document exists so nobody mistakes "gates green" for "model verified".

## Plan

### 1. Build a harness that exercises the real path (prerequisite for everything else)

`scripts/backtest-valuation.ts`, scoring the shipped chain end-to-end:

- Take completed 2025 Sleeper leagues (the same public leagues `backtest:sleeper`
  already uses — no credentials, reproducible).
- Reconstruct each roster **as of week 1** from the draft results, so the inputs are
  genuinely pre-season.
- Run the actual product path: FantasyPros ECR snapshot → `enrichRoster` →
  `trueValue` → `runNexusSimulation` with that league's real `LeagueFormat`.
- Score `playoffProbability` against actual playoff qualification with Brier + ECE,
  using the existing `scoreForecasts` so numbers are comparable.

**Leakage rules, stated up front:** the ECR snapshot must be pre-season, never
in-season; actual weekly scores may only ever be the outcome label, never an input;
and the league format must come from the platform, not from the outcome.

### 2. Establish a baseline, then attribute each change

Run the new harness at three commits: before the replacement-level change, after
it, and after the sim-anchor change. That gives a per-change delta rather than one
aggregate number, which is the only way to tell whether a change helped, hurt, or
did nothing.

### 3. Set an honest bar

Ten team-seasons is far too thin to conclude anything — the existing
`backtest:sleeper` ECE of 0.2583 on n=10 is not a calibration claim and should stop
being cited as one. Widen to every completed league reachable from the operator's
account across 2024–2025, report **n** beside every metric, and treat a result as
directional until n is in the low hundreds.

### 4. Only then consider tuning

`TV_SLOPE`, `MEDIAN_TV`, `PLAYER_SIGMA_*` and the 1.2 depth cushion are all
hand-tuned. Fitting them without the harness above would be curve-fitting to
nothing. With it, each becomes testable.

### 5. Wire it into the gates

Add the harness to CI as a **reported, non-blocking** metric first — a Brier that
moves is information, not a build failure — and record each run in
`reports/`. Promote to blocking only once a stable baseline exists.

## Status — EXECUTED 2026-08-17

| Step | State |
|---|---|
| 1. Harness that exercises the real path | **DONE** — `scripts/backtest-valuation.ts`, `npm run backtest:valuation` |
| 2. Baseline + per-change attribution | **DONE** — before/after the anchor fix; see below |
| 3. Honest bar (report n) | **DONE** — n=50 team-seasons, 5 leagues, 2022–2025, cluster-bootstrap CIs |
| 4. Only then consider tuning | **DELIBERATELY NOT DONE** — see below |
| 5. Wire into the gates | **DONE as reported-not-blocking** — network-dependent, so it is a script, not a CI gate |

Full write-up: [`reports/2026-08-06/backtest-valuation.md`](../reports/2026-08-06/backtest-valuation.md).

### Result: the model FAILED

| Metric | Model | Climatology (p=0.60) |
|---|---|---|
| Brier | 0.3098 | 0.2400 |
| AUC | 0.3058, CI [0.1333, 0.4450] | 0.5 |
| Brier skill score | −0.2908, CI [−0.4588, −0.1320] | 0 |

Both CIs exclude the null **on the wrong side**: the chain is significantly worse
than forecasting the base rate, and its ranking is inverted.

### A unit error the harness found immediately

`starterWeeklyMean` mapped `trueValue = 50` — which is *replacement level* — onto
the average *starter's* points. Every real roster therefore floated above its own
field: measured, every team averaged 164 weekly points against a 115 field, so all
50 team-seasons predicted ~100% playoff odds (Brier 0.4000, AUC exactly 0.5000).

Fixed by anchoring at the average startable trueValue, derived in closed form from
the depth cushion (79.2 at cushion 1.2) rather than fitted. Pinned by
`src/lib/simulation.calibration.test.ts`.

**This is also the coverage proof the plan asked for.** The anchor fix moved
`backtest:valuation` from 0.4000 to 0.3098 while leaving `calibrate:season`
(0.0770) and `backtest:sleeper` (0.1657) bit-identical — direct evidence that
the old two never touched `runNexusSimulation`.

### Ablation: the transform, not the input

| Signal | AUC |
|---|---|
| Shipped chain | 0.3058 |
| Raw draft capital | 0.5033 |
| Early QB/TE share | 0.6725 |

Rank-ratio VBD's advantage term grows with position depth, so it systematically
under-values scarce positions (QB3 → 87.5 vs RB3 → 95.7 in a 10-team league). In
this sample, early QB/TE spend correlated with qualifying — so the model marked
down the teams that succeeded.

### Step 4 — why no tuning happened

No parameter was flipped or refitted to improve these numbers. With 5 effective
clusters that is curve-fitting to noise. The anchor fix was made because it
corrects an error provable from the definitions, not because it improved a score.

The indicated next change is **points-above-replacement instead of rank-ratio
VBD**, which needs projected points per player rather than ranks. That is a real
modelling change and belongs behind its own evidence.

### Standing conclusion

No statement of the form "the model is calibrated" is supportable for
`runNexusSimulation`. There is now positive evidence in the other direction, and
the simulation declares it in its own assumptions.
