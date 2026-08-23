# Out-of-sample backtest of the shipped valuation chain

**Date:** 2026-08-17 · **Harness:** `scripts/backtest-valuation.ts` ·
**Raw output:** [backtest-valuation.txt](./backtest-valuation.txt) ·
**Reproduce:** `npm run backtest:valuation`

This closes the gap recorded in [`docs/model-validation-plan.md`](../../docs/model-validation-plan.md):
the simulator that was validated was not the simulator the product uses.

## Headline

> **PARTIALLY SUPERSEDED 2026-08-20.** The calibration half of this headline
> replicated on an untouched external sample; the **inversion half did not**.
> On 160 team-seasons across 13 MyFantasyLeague leagues the model had never
> seen, AUC was **0.5569 [0.4630, 0.6300]** — straddling 0.5, not below it.
> The significant inversion measured here is now attributed to small-sample
> noise across 3-5 correlated clusters. Brier skill remained significantly
> negative. See [`reports/2026-08-20/holdout-result.md`](../2026-08-20/holdout-result.md).
> The numbers below are left exactly as they were measured.

**The shipped playoff-odds model failed out-of-sample validation.** It scores
*worse* than forecasting the league's base rate, and its ranking is inverted.

| Metric | Model | Climatology (p=0.60) | Uniform (p=0.50) |
|---|---|---|---|
| Brier | **0.3098** | 0.2400 | 0.2500 |
| Log loss | 0.8267 | — | — |
| ECE (10 bins) | 0.2999 | — | — |
| AUC | **0.3058** | 0.5 by construction | 0.5 |

| Quantity | 95% CI (cluster bootstrap over leagues) | Reading |
|---|---|---|
| Brier | [0.2717, 0.3501] | |
| AUC | **[0.1333, 0.4450]** | entirely **below** 0.5 → ranking significantly inverted |
| Brier skill score | **[-0.4588, -0.1320]** | entirely **below** 0 → significantly worse than a constant |

`n` = 50 team-seasons · 5 leagues · seasons 2022–2025. **Effective sample size is
nearer 5 than 50** — see *Why the statistics are clustered*.

## What the harness does

```
draft ADP → positional rank → positionReplacementRank → ecrToTrueValue
          → PlayerMarketRecord → runNexusSimulation → playoffProbability
```

scored against actual playoff qualification from the winners bracket. This is
the chain the dashboard renders, end to end, with no substitutions.

### Leakage controls — asserted in code, not promised

1. **Input is `pick_no` only.** A draft happens before week 1, so it cannot
   contain in-season information. A historical FantasyPros ECR snapshot is *not*
   retrievable (rankings snapshots prune after 7 days); draft ADP is the same
   quantity ECR approximates, measured on the day it mattered.
2. **Drafted roster only** — no waiver adds, no trades, no end-of-season roster.
3. **Weekly scores are the outcome label, never an input.** `weeklyProjections`
   is explicitly `null`, which also means the *offseason* trueValue path is
   exercised — the path a pre-draft user actually sees.
4. **League format from the platform**, not from the outcome.

The harness prints the observed qualification rate against the structural rate
(0.6000 vs 0.6000) and warns if they diverge, which would indicate a bracket
misread.

### Why the statistics are clustered

Within one league exactly 6 of 10 teams qualify, so the ten rows in a league are
strongly dependent — one team making it forces another out. Treating 50
team-seasons as 50 independent trials would badly overstate precision. All
confidence intervals come from a **cluster bootstrap that resamples whole
leagues**.

## A model defect found on the first run

The very first execution returned Brier exactly **0.4000**, AUC exactly
**0.5000**, ECE 0.0000 and *empty reliability bins* — the signature of every
team being predicted at 100%.

It was. Measured on the 2025 league: every team averaged **164 weekly points
against a 115 field**, i.e. every team in the league was 42% above average —
which cannot be true of every team simultaneously. Team spread was 159–172
(7.6%) versus a 42% gap to the field.

**Root cause, a unit error in one line.** `starterWeeklyMean` mapped
`trueValue = 50` onto `AVG_STARTER_PTS`, the average *starter's* points. But
`trueValue = 50` is **replacement level** (see `ecrToTrueValue`), and replacement
is by definition worse than an average starter. Every real roster floated above
the field by the entire replacement-to-starter gap.

**Fix**: anchor the transform at the average *startable* trueValue, derived in
closed form from the depth cushion:

```
mean trueValue over startable ranks 1..S, replacement R = S·c
  = 50 + 50·(1 − 1/(2c) − 1/(2R))   →   79.2 at c = 1.2
```

Pleasingly this is free of league size and position, because S and R scale
together. It is **derived from the replacement model, not fitted to the
backtest**, so the backtest remains a genuine holdout.

| | Brier | AUC | Median-roster odds |
|---|---|---|---|
| Before (anchor = 50) | 0.4000 | 0.5000 | ~100% |
| After (anchor = 79.2) | 0.3098 | 0.3058 | ≈ playoffTeams/numTeams |

Pinned by `src/lib/simulation.calibration.test.ts`, which asserts the property
(team mean == field mean for a median roster, in every scoring format and league
shape) rather than a magic number.

## Coverage proof — this harness actually covers the shipped path

The reason the old harnesses never caught any of this:

| Harness | Before anchor fix | After anchor fix |
|---|---|---|
| `calibrate:season` playoff Brier | 0.0770 | **0.0770** (unchanged) |
| `backtest:sleeper` pooled Brier | 0.1657 | **0.1657** (unchanged) |
| `backtest:valuation` Brier | 0.4000 | **0.3098** (moved) |

A model change that moves the new harness and leaves the old two bit-identical
is direct evidence that the old two do not touch `runNexusSimulation`.

## Ablation — is the input worthless, or is the transform?

A single Brier number cannot separate these, and they have opposite fixes.
Compared on AUC, which needs no calibration — only ranking.

| Signal | AUC | 95% CI |
|---|---|---|
| Shipped chain (trueValue → sim) | **0.3058** | [0.1333, 0.4450] |
| Raw draft capital (Σ totalPicks − pick_no) | 0.5033 | [0.4850, 0.5333] |
| Early QB/TE share of first 5 picks | 0.6725 | — |

**The transform is destroying signal, not the input.** Raw draft capital is
neutral (as expected — a snake draft equalises capital), yet the chain built on
top of it ranks significantly *worse* than chance.

### Mechanism

Rank-ratio VBD computes `50 + 50·(replacement − rank)/replacement`, so the
advantage at a given positional rank **grows with position depth**. In a 10-team
league replacement is QB 12 / TE 12 but RB 35 / WR 37:

| | rank 3 | rank 5 |
|---|---|---|
| QB | 87.5 | 79.2 |
| RB | 95.7 | 92.9 |

So the transform **systematically under-values scarce positions**. In this
sample, early QB/TE spend *correlates with qualifying* (AUC 0.67) — the model
marks down exactly the teams that went on to succeed. That is a coherent
explanation for an inverted AUC, and it indicts the **VBD transform** (rank
ratios are not points above replacement) rather than replacement level or the
simulator.

## What was deliberately NOT done

**No parameter was flipped, refitted or tuned to improve these numbers.** With 5
effective clusters that would be curve-fitting to noise, and inverting a model
because it scored badly on 5 leagues is how a small sample becomes a big
mistake. The anchor fix was made because it corrects a **unit error provable
from the definitions** — replacement ≠ average starter — not because it improved
a score.

The indicated next change is to replace rank-ratio VBD with genuine
**points-above-replacement**, which requires projected points per player rather
than ranks. That is a real modelling change and belongs behind its own evidence,
not bolted on at the end of an audit.

## Governance consequence

`CLAUDE.md`: *"If a model lacks calibration, do not present it as
production-safe."* There is now executed evidence of failure, so
`runNexusSimulation` states it in its own assumptions, which the governance
banner surfaces:

> NOT VALIDATED OUT-OF-SAMPLE: backtested on 50 team-seasons across 5 completed
> leagues (2022–2025), this chain scored Brier 0.310 against a 0.240 climatology
> baseline and AUC 0.306 — significantly worse than forecasting the league's base
> rate. Treat these odds as a structured scenario, not a prediction.

## Residual issues found but not changed

- **Variance does not scale with scoring format.** The field's
  `betweenTeamSigma` is proportional to the field mean and shrinks in STD, while
  a player's weekly sigma is an absolute points figure that does not move. The
  same mean edge against slightly less noise is worth slightly more, so STD and
  PPR odds differ by ~2pp for an identical roster. Second-order next to the
  anchor error; pinned to <4pp by `simulation.test.ts`.
- **`n` is still far too small.** 5 leagues from one manager group across four
  seasons are not independent — same players, correlated skill. Widening beyond
  the operator's own account needs a source of public completed leagues, which
  Sleeper does not expose as a directory.

## Limitations

- 50 rows / 5 clusters. Every interval here is wide, and the *point* estimates
  should not be quoted without them.
- Single platform (Sleeper), single scoring format in practice (all five leagues
  are 10-team PPR), so format generalisation is untested by this harness.
- Playoff qualification is a coarse label; it discards margin.
- `volatility` is held at the model median because draft order carries no
  dispersion signal. It is constant across teams, so it cannot create or destroy
  discrimination, but it does mean the sim's variance input is uninformative here.

---

# UPDATE 2026-08-18 — points-above-replacement built and scored

> **SUPERSEDED 2026-08-20 — read this section as a historical record.**
>
> The conclusion below ("PAR's interval **includes 0.5**. Replacing the transform
> removes a measurable defect.") does not survive the dependence analysis in
> [`reports/2026-08-20/par-dependence-analysis.md`](../2026-08-20/par-dependence-analysis.md).
>
> Two things changed. First, the curve fit had no player identity, so repeated
> player-seasons across leagues were counted as independent evidence; under the
> cluster-weighted treatment chosen on a-priori statistical grounds, PAR's AUC CI
> becomes [0.3750, 0.4583] — **entirely below 0.5**, the same verdict as the
> shipped model. Second, and more fundamentally, the PAR interval is a percentile
> of **nine distinct bootstrap values** (3 clusters), so whether it straddles 0.5
> is an artifact in either direction.
>
> The operative conclusion is unchanged and, if anything, firmer: **PAR is not
> shipped.** The numbers below are left exactly as they were measured.

The indicated fix from the section above was implemented and backtested. Both
forecasters run through the **identical** production simulation, so the only
difference between them is the valuation transform.

## Result

Like-for-like on the 30 team-seasons PAR can score (2023-2025; 2022 has no prior
season to fit a curve on):

| | Brier | AUC | AUC 95% CI |
|---|---|---|---|
| RANK (shipped rank-ratio VBD) | 0.3353 | **0.2546** | **[0.1333, 0.4450]** |
| PAR (candidate) | **0.3338** | **0.4398** | **[0.3750, 0.5417]** |
| climatology (p=0.60) | 0.2400 | 0.5 | — |

**The difference that matters:** rank-ratio's AUC interval lies entirely below
0.5, so its ranking is *significantly inverted*. PAR's interval **includes 0.5**.
Replacing the transform removes a measurable defect.

**What is still not true:** AUC did not cross 0.5, which was the success
criterion set for this work. Neither forecaster beats a constant on Brier
(PAR skill CI [-0.6824, -0.1958]). PAR is *less wrong*, not *right*.

## The curve, and the temporal split

Expected season points by positional draft rank, fitted by **isotonic regression
(pool-adjacent-violators, non-increasing)**. That smoother was chosen because
the only constraint the data genuinely supports is that expected points must not
*rise* with draft rank; a moving average would invent a smoothness the data has
not earned and would still permit rank inversions. Raw single-season means
violate monotonicity constantly — one real league had QB1/2/3 at 320/180/114
while QB4 scored 254.

Each league's curve is fitted on **strictly earlier seasons only**, and the
harness asserts it:

| league | season | curve fitted on | observations |
|---|---|---|---|
| Joe V | 2022 | (none) | — no PAR forecast |
| Creamy Les Coot | 2022 | (none) | — no PAR forecast |
| Creamy Les Coot | 2023 | 2022 | 290 |
| Creamy Les Coot | 2024 | 2022, 2023 | 428 |
| Creamy Les Coot 4.0 | 2025 | 2022, 2023, 2024 | 568 |

A league whose curve contained its own season would throw rather than score.

## A second scale error, found the same way

The first PAR attempt anchored the trueValue scale on the **best** player in the
pool (best PAR → 100). Measured on the 2025 league with a 2024 curve:

| | mean starter trueValue | Brier | AUC |
|---|---|---|---|
| simulation anchor | **79.2** | — | — |
| RANK starters | 77.1 | 0.3353 | 0.2546 |
| PAR starters (best-anchored) | **71.4** | **0.5530** | 0.4329 |

Discrimination improved while calibration collapsed — the signature of a level
error, not a signal error. Every team sat below the simulation's field baseline,
so every team looked weak against a 60% base rate.

Fixed by anchoring on the **average startable player** instead, which is the
contract the simulation actually imposes: PAR = 0 → 50, and the average startable
player's PAR → 79.2. Both anchors are structural, computed from the curve and the
league format, with no outcome data from the season being scored. Brier recovered
0.5530 → 0.3338 with ordering unchanged.

## Why this is NOT shipped as the production default

PAR needs a points curve at runtime, and the application has no source for one.
The only curve available is fitted on five leagues from a single manager group,
all 10-team PPR — too thin and too unrepresentative to bake in as a production
parameter, especially on the strength of a comparison that still loses to a
constant.

So `src/lib/models/pointsCurve.ts` ships as a tested, evidence-backed library and
the harness scores it; production remains on rank-ratio with its failure declared
in the simulation's own assumptions. Flipping the default is a one-line change
once a broader curve source exists — the concrete blocker to record is *curve
data*, not modelling work.

## Limitations unchanged from above

30 rows across 3 clusters for PAR. One platform, one scoring format in practice,
one manager group. Playoff qualification is a coarse label that discards margin.
