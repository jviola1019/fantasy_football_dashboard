# Session 7 — the calibrated model, shipped

The audit of 2026-08-06 recommended shipping the weekly start/sit probability.
Every session since deferred it. `audit:reachability` has been reporting
`src/lib/stats/logistic.ts` as **"reached only by scripts"** the entire time —
a machine-checked statement that the one model in this repository with a
positive, replicated calibration result could not be reached by any user.

It is reached by the app now, and every number it displays is verifiable offline
from a committed snapshot.

---

## What ships, and what is claimed about it

A per-position logistic mapping a player's pre-game **PPR** projection to
P(they clear the position's start line), frozen as constants.

| position | line | n | intercept | coefficient | out-of-fold Brier | ECE | Brier skill |
|---|---|---|---|---|---|---|---|
| QB | 18 | 512 | −3.512944 | 0.165946 | 0.2368 | 3.3% | **+3.7%** |
| RB | 10 | 876 | −2.703363 | 0.225224 | 0.1969 | 3.3% | +21.2% |
| WR | 8 | 1470 | −2.461903 | 0.240923 | 0.2036 | **1.7%** | +18.5% |
| TE | 6 | 715 | −2.386355 | 0.317116 | 0.2059 | 2.5% | +17.6% |

Fitted on `reports/2026-08-20/brier-prospective.json.gz` — 3,573 startable
player-weeks across all 17 regular-season weeks of 2025, input fingerprint
`bba1d103`.

## Three distinctions the implementation is built around

**1. The coefficients and the skill come from different fits, deliberately.**
The shipped intercept and coefficient are fitted on **all** rows for a position:
a production model should use all the evidence it has, and throwing away 4/5 of
it to match a cross-validation fold would make the shipped model worse for no
reason. The Brier and ECE quoted are **leave-one-week-out** — every row scored by
a model that never saw its week. That is the honest estimate of performance on an
unseen week, and it is the only number quoted as this model's accuracy. Quoting
the full-fit model's in-sample Brier would measure how well it memorised, and it
would look better.

**2. The unit is PPR, explicitly, whatever the league scores.** The model was
fitted on Sleeper's `pts_ppr` against PPR thresholds. Feeding it a half-PPR
projection is the same class of mismatch audit 2026-08-20 §7 already had to fix
once, and it is invisible: the number stays plausible and means nothing. The
panel selects the PPR field by name, labels the column as PPR, and says why. A
player with no PPR projection gets no probability rather than a converted one.

**3. QB is not the others, and the code enforces that rather than trusting the
caller.** QB's skill is **+3.7%** against +21.2 / +18.5 / +17.6. That is a real
positive and small enough that listing it beside the others without comment would
imply an equivalence the data does not support (risk R5). `hasUsefulSkill()` puts
QB below a declared floor, the table marks the row inline where the number is
read, and QB's disclosure carries an extra sentence the others do not.

The floor is 10% and is **declared as a judgement call**, not derived: it is a
product decision about what is worth a reader's attention. It sits well above QB
and well below the other three, so no position is near enough to flip on noise —
asserted by a test.

## `verify:weekly-prob` — what makes "frozen constants" trustworthy

A frozen coefficient is a claim about a dataset that nobody can check by reading
it. `OPPORTUNITY_WEIGHT = 0.7613` has exactly this shape, and the only thing
between it and a typo is that somebody remembers the number.

`npm run verify:weekly-prob` needs **no network** — it replays the committed
snapshot — and asserts 43 things:

- the input fingerprint still reads `bba1d103`, so the rows are the rows the
  published results describe;
- every intercept and coefficient reproduces to **1e-9**;
- every out-of-fold Brier and ECE reproduces;
- each of those also matches the value **parsed out of `docs/brier-results.md`**
  rather than retyped, so the code and the published claim cannot drift apart
  silently;
- P(clear) increases with the projection at every position — a sign error there
  would leave every aggregate metric above looking plausible while the model
  ranked players backwards.

```
verify:weekly-prob: 43/43 checks passed.
```

### A shared fingerprint, because two implementations disagreed

The first version of the fit script computed its own row fingerprint and got
`84e66505` against the documented `bba1d103`. The data was identical; the hash
was not — the backtest uses FNV-1a and the new script had reached for SHA-256.

A comparability check that two callers compute differently is worse than none,
because it looks authoritative while comparing nothing. `fingerprintRows` and the
row-key format now live in `src/lib/stats/fingerprint.ts` and both callers import
them. The fingerprint then matched on the first run.

## Two product decisions the tests forced

**The display never claims certainty.** `sigmoid` saturates to exactly 1.0 in
float64 at a large enough projection, and `Math.round(p * 100)` would print
"100%". No weekly fantasy outcome is certain — a player can be inactive an hour
before kickoff, which is precisely why the fit scored 218 did-not-plays as
failures. So `formatWeeklyProb` caps at `>99%` and floors at `<1%` while the
probability itself stays unclamped: clamping the model would corrupt a calibrated
output to fix a presentation problem.

**The disclosure renders even with no projections.** It first sat behind the
tab's early return for missing data, so the evidence for the product's one
calibrated model was invisible in exactly the state CI runs in — and the wording
guard's canary caught it. The model is frozen; its measured calibration is as
true in June as in October. The table needs this week's input; the evidence does
not.

## D2 — the wording ban, widened before it was scoped

`e2e/20` bans "calibrated probability" and three sibling phrases. Two changes,
in that order:

**Widened.** The ban covered `/analytics`, `/reports` and `/dashboard` — three
routes of ten. The rule it encodes is a rule about the product, so a guard
covering three routes was narrower than its own reason: the same defect the
`mispric` ban was widened for on 2026-08-26. It now covers every route that
renders a model output, plus onboarding.

Note that `/players` — where this panel lives — was **not** previously covered.
Shipping the panel without widening the ban would have passed CI while quietly
proving nothing.

**Then scoped.** When the ban was written nothing here was calibrated, so a
blanket ban and the truth coincided. One thing now is, and forbidding it from
saying so would make the guard enforce a claim that has become false in the other
direction.

The exemption is an **earn**, not an allow-list: a block may use the phrase only
if it also prints its measured calibration error *and* its Brier skill. Confident
prose cannot satisfy that; only numbers can. The rest of every page — the DOM
with those blocks removed — is still banned, and a canary asserts at least one
block actually exercised the exemption, so the test cannot quietly revert to the
old blanket ban and stop testing D2's requirement.

## Evidence

| gate | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | compiled successfully |
| `npm run test` | **1,402 passed / 39 skipped, 0 failed** (1,310 → 1,402) |
| `npm run verify:weekly-prob` | **43/43 checks passed** |
| `npm run audit:reachability` | `src/lib/stats/logistic.ts` moved to **REACHED BY THE APP**; 0 unreachable |
| `e2e/20-model-failure-disclosure` | **34 passed**, both viewports |

## Remaining risk

- Fitted on **one season**. A rule change, or a scoring format unlike the PPR the
  fit saw, is outside what was measured. The disclosure says so.
- The model consumes Sleeper's projection and inherits whatever bias that
  projection carries. Its skill is measured *relative to climatology*, not
  against a better projection source.
- The populated table is covered by render tests, not by a live browser run: CI's
  database is empty, so Playwright only ever reaches the no-projection branch.
  This is the same structural gap S4 recorded, and the reason the render tests
  exist.
