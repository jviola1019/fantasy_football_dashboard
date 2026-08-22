# Model direction — what the evidence says to build next

**Date** 2026-08-21 · **Author role** quant / data analyst / full-stack ·
**Status** recommendation, nothing shipped

Three frozen protocols have now been executed against real, untouched data. This
document reads them together, states the structural diagnosis they point to, and
directs one option.

---

## 1. What the evidence actually establishes

| protocol | what was tested | sample | verdict |
|---|---|---|---|
| 1 | season odds, inferred label | 13 clusters / 160 rows | NOT VALIDATED |
| 1c | same, ground-truth label | 13 clusters / 160 rows | NOT VALIDATED, unchanged |
| 2 | season odds, enlarged | 68 clusters / 800 rows | NOT VALIDATED |
| 3 | the reputation edge | 1,211 player-seasons | NOT DEMONSTRATED |

Read together, four findings matter more than the verdicts:

**a. The failure is calibration, not information.** Protocol 2 D1: reliability
0.0381 against resolution 0.0093 — miscalibration is **4×** informativeness.
D2: out-of-fold recalibration recovers Brier skill −0.1632 → −0.0076, closing
~95% of the gap to climatology. The model is badly *scaled*, and there is very
little underneath the scaling.

**b. The ceiling on draft-only information is near zero.** Protocol 2 D3: a
logistic regression fitted **directly to the outcome** on draft-only features
reaches AUC 0.5379 and skill −0.0391. **Even a model fitted to the answer cannot
beat the base rate** from draft data.

**c. Within position — the actual decision — the valuation is inverted.**
Protocol 3 H2: −0.0480, CI [−0.0757, −0.0197]. Same-position concordance 0.5097,
chance. And H2 is the *only clean test in protocol 3*, because the cross-position
tests are confounded by positional scoring level (see the retraction in
`holdout-result-3.md`).

**d. The arbitrage step subtracts value.** Protocol 3 D4: `trueValue` alone
correlates 0.0628 with beating draft cost; `trueValue − perceivedValue`
correlates 0.0579.

---

## 2. The structural diagnosis

Every predictor in RAE's valuation is a **monotone function of consensus rank**:

```
perceivedValue = f(overall ECR rank)
trueValue      = g(positional ECR rank, replacement rank)
edge           = trueValue − perceivedValue
```

`ecrToTrueValue` takes `rank_ecr` as a parameter **and does not use it** — it
depends only on positional rank and replacement rank. So both sides of the
"arbitrage" are the same consensus, re-expressed twice.

**A model built only from the market's own opinion cannot beat the market. It
*is* the market, with a positional re-weighting applied.** That is not a bug in
the transform; it is a property of the input set, and it explains every result
above at once — including why fixing the transform (PAR) did not help and why a
model fitted directly to the outcome still fails.

The corollary is the useful part: **the only way out is information the consensus
has not already priced.**

---

## 3. RAE already collects such information — and does not use it

| signal | collected? | used in valuation? |
|---|---|---|
| **nflverse opportunity** (snap share, 0–100) | **yes**, daily cron, CC-BY | **NO** — stamped onto records, never enters `trueValue` |
| ESPN news momentum | yes | only `trendingMomentum` |
| Sleeper trending adds/drops | yes | only the waiver hype axis |
| Weekly Sleeper projections | yes | simulation only, and §7b showed that path was dead until this audit |

`opportunity` is the strongest of these and the one that is genuinely
*independent* of preseason consensus: **ADP is frozen the moment the draft ends,
while usage keeps updating every week.** That gap is where an edge can exist at
all.

Verified reachable 2026-08-21: nflverse `player_stats` and `snap_counts`
(HTTP 200 for the 2023 release assets).

---

## 4. Options considered

| option | verdict | why |
|---|---|---|
| Fix the season simulator's transform | **reject** | Protocol 2 D3 puts the draft-only ceiling below the base rate. Better transforms of the same input cannot clear a ceiling that low. |
| Ship the PAR candidate | **reject** | Still draft-only, so subject to the same ceiling; and its apparent advantage flipped under a defensible dependence treatment. |
| Tune `depthCushion` / `TV_SLOPE` / the anchor | **reject** | Forbidden by every frozen protocol, and with the effective sample sizes measured it would be fitting noise. |
| Chase the QB anomaly | **reject** | Retracted — it was an artifact of a position-blind cost curve, not a market inefficiency. |
| **Use in-season opportunity to beat a stale ADP** | **RECOMMEND** | Independent of consensus, already ingested, free, and it is the product's most actionable surface. |

---

## 5. Recommendation — protocol 4

> **Does in-season opportunity predict rest-of-season production better than the
> frozen draft position it would replace?**

### Why this is the right question

1. **It is the waiver/trade use case**, which is where RAE gives the most
   actionable advice and where a stale ADP is weakest.
2. **The baseline is honest and strong**: draft position, which is what the
   product currently ranks on.
3. **It is well-powered.** The unit is player-week or player-season-half, not
   team-season. Protocol 2's D4 failure — 68 clusters could not resolve a 0.02
   effect — does not recur at this scale.
4. **It can fail cleanly.** If usage-to-date does not beat draft position at
   predicting the rest of the season, then RAE has no independent signal
   anywhere, and the product should say so and compete on governance and UX
   rather than on prediction.

### Sketch, to be frozen properly before any scoring

- **Unit** player-season-half: features from weeks 1–8, outcome weeks 9–17.
- **Predictors** snap share, target share, carries, points-to-date — all
  observed, none consensus-derived.
- **Baseline** preseason draft position / ADP alone.
- **Primary test** does adding opportunity beat the baseline out-of-fold, on
  Spearman against rest-of-season points, with **clustering on player-season**?
- **Guards carried forward from this audit**: cluster on the repeated unit, not
  the convenient one; fit expected-value curves **within position**; use the
  permutation null rather than a textbook constant; pre-register the family with
  Holm correction and require all of it.

### Model changes this would justify — *only if it passes*

None of these ship before validation. Listed so the plan is concrete:

1. `trueValue` gains an in-season term from `opportunity`, replacing the current
   situation where the field is collected and ignored.
2. The season simulation takes points-to-date as its in-season anchor rather than
   a draft-derived `trueValue`.
3. The Waiver Wire priority formula re-weights toward `opportunity` — currently
   `trueValue` carries weight 1.0 and `opportunity` 0.4, which is backwards if
   opportunity is the only independent signal.

---

## 6. What to do about the product in the meantime

The audit has already applied the honest-disclosure rule to both the season
simulator (§3) and the edge (protocol 3). That is the correct interim state:
**RAE keeps a genuinely strong consensus baseline and stops claiming an edge it
cannot demonstrate.**

That is not a weak position. Consensus ECR is hard to beat, the governance
surfacing is real and unusual, and the product's actual differentiator — source,
freshness, assumptions and validation state on every number — survives all of
this intact. What does not survive is the word *arbitrage*, and it has been
removed from the surfaces that used it.

---

## 7. Honest limits of this direction

- Opportunity data is **in-season only**, so it does nothing for the draft-day
  use case. Draft rankings would remain consensus-based, correctly.
- nflverse snap data needs a name join to Sleeper/MFL ids; joins leak errors, and
  the match rate must be reported, not assumed.
- A positive result would be evidence about *rest-of-season points*, not about
  winning a league. Aggregating from player value to team outcome is the step
  protocol 2 D3 showed is lossy.
