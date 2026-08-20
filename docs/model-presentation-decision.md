# Product decision — how RAE presents an unvalidated season model

**Date** 2026-08-20 · **Audit** §3 · **Decision** Strategy B (demote the
percentages) · **Status** implemented

## The situation

`runNexusSimulation` drives every playoff and championship number in the
product. It has been backtested out of sample, and it failed.

| Sample | Brier | Climatology | AUC | AUC 95% CI (cluster bootstrap) |
|---|---|---|---|---|
| 50 team-seasons, 5 leagues, 2022-2025 | 0.3098 | 0.2400 | 0.3058 | [0.1333, 0.4450] |
| 30 team-seasons where PAR scores like-for-like | 0.3353 | 0.2400 | 0.2546 | [0.1333, 0.4450] |

Both AUC intervals lie **entirely below 0.5**. The model does not merely fail to
add skill — in the tested sample its ranking is significantly *inverted*. Its
calibration error is ECE 0.2999, i.e. wrong by tens of percentage points.
Evidence: [`reports/2026-08-06/backtest-valuation.md`](../reports/2026-08-06/backtest-valuation.md).

The sample is small (5 effective clusters), so the honest reading is "no
demonstrated skill, with evidence of harm" rather than "proven backwards". Either
reading forbids presenting the output as a forecast.

## What was actually on screen before

The disclosure existed — as `sim.assumptions[4]`. It reached the user like this:

| Surface | Rendered? |
|---|---|
| `ConfidenceBands`, default "Multiverse" tab, `Championship 12.4% [8.1 – 17.0]` under the heading **"95% Confidence Bands"** | **no warning at all** |
| `RiskOfRegret`, same tab | `assumptions.slice(0, 3)` truncated to 60 chars — the warning is index 4, so **cut out** |
| `RiskDetails`, "Risk Analysis" tab | full text, but **behind a tab** |
| `TeamSignals`, `/analytics` | a triangle chart with the percentage at 16px captioned **"ESTIMATE"**, flanked by LOW/HIGH legs |
| `ReportsView`, `/reports` | five outcome bars, caption "same inputs, same odds" |

So the numbers were everywhere and the warning was nowhere the numbers were.
The audit's phrasing is exact: *a warning hidden behind an assumptions drawer is
not equivalent to informed presentation*.

## The decision

**Strategy B.** The prominent decision-facing percentages are replaced with
qualitative scenario bands. Raw frequencies remain, one explicit disclosure away.

The operator delegated the choice with the constraint *"simplistic yet extremely
accurate and readable for a regular user, mobile and computer"*. Three things
followed from that.

### 1. The trustworthy number leads

The structural baseline — `playoffTeams / numTeams` for playoffs, `1 / numTeams`
for the title — is arithmetic about the league, not a model output. Exactly 6 of
12 teams make the playoffs every season, by construction, and on the same
backtest climatology (Brier 0.2400) **beat** the model (0.3353).

So the baseline is the big number on screen. It is the one figure that cannot be
wrong, and for a regular user it is also the more useful anchor: *this is what an
average team in your league faces.*

### 2. The model appears as a band, not a percentage

`12.4%` asserts a precision the model has not earned; the measured calibration
error is two orders of magnitude larger than the last displayed digit. Worse, a
percentage beside the word "probability" reads as a forecast, when the quantity
is a simulated frequency under model assumptions.

Bands are bucketed by **log-odds distance from the baseline**, not by a
probability ratio. A ratio saturates against the 100% ceiling: with a 60%
baseline the largest achievable ratio is 1.67, so the exact pathology this audit
trail began with — the pre-anchor-fix model predicting ~100% playoff odds for
*every* team — would have rendered as merely "above baseline". Log-odds is
symmetric, never saturates, and is the scale on which probability differences are
comparable across a 10% championship baseline and a 60% playoff baseline.

Boundaries, chosen before looking at any output:

| Odds ratio vs baseline | Band |
|---|---|
| < 1.5x either way | Near league baseline |
| 1.5x – 3x | Above / Below league baseline |
| ≥ 3x | Far above / Far below league baseline |

Two deliberate constraints on the labels, both test-enforced:

- **Every label names the baseline.** "Above league baseline" cannot be misread
  as a standalone likelihood claim the way "Likely" could.
- **Colour encodes distance, not good vs bad.** Both tails share a colour. An
  uncalibrated model has no standing to tell a user that above-baseline is good
  news.

### 3. Nothing is hidden

CLAUDE.md forbids hiding unavailable data and removing validation state. The raw
simulated frequencies, their Monte-Carlo intervals, the seed and the iteration
count all remain, inside a keyboard-reachable `<details>` labeled
"Show raw simulated frequencies (uncalibrated)", captioned *simulated frequency
under model assumptions, not a forecast probability*.

This is progressive disclosure, not concealment. A user who wants the number gets
it in one tap, having been told what it is.

## Where the numbers were kept, and why

`ReportsView`'s five-row outcome distribution was **not** demoted to bands. The
Strategy B demotion targets prominent *single-number* "probabilities" that read
as forecasts. A full distribution, explicitly labeled as simulated frequency,
with the failure notice adjacent, is a legitimate scenario output whose shape is
the information — collapsing five rows to five bands would destroy that and gain
nothing. The caption was rewritten (it previously implied reproducibility meant
correctness), and the notice was added.

## What was removed, and why

`TeamSignals`' triangle chart was deleted rather than re-pointed at the baseline.
Every element of it — the centred percentage captioned "ESTIMATE", the LOW and
HIGH legs — asserted a calibrated point forecast with quantified error. The
interval was Monte-Carlo *sampling* error, which shrinks with iteration count and
says nothing about whether the model is right. With a fixed structural baseline
the legs carry no information at all, so keeping the shape would have made it
decoration, which CLAUDE.md rules out ("no meaningless charts"). The Wilson
interval survives, correctly scoped, inside the raw disclosure.

## Usability tradeoff — stated honestly

**What is lost.**

- Precision. A user who wants to know whether they are at 44% or 48% must open
  the disclosure, and when they do they are told the number is not calibrated.
  For a user who understood the caveat already, this is pure friction.
- Comparability at a glance. Bands do not sort. Two rosters both reading "Near
  league baseline" cannot be ranked without expanding.
- A visual. The triangle chart was distinctive; its replacement is text.

**What is gained.**

- The default screen no longer answers "can I trust it?" with an unqualified
  number. Per CLAUDE.md's five-second test, the honest answer is now visible
  first.
- The failure notice cannot be missed: it renders on first paint, on every
  simulation surface, on mobile and desktop, enforced by
  `e2e/20-model-failure-disclosure.spec.ts`.
- Mobile legibility improves. Two short text rows survive 320px; a
  number-plus-interval column did not.

**The judgement.** The lost precision was not real precision. A number with ECE
0.2999 does not become more informative by being displayed to one decimal place,
and the risk of a user staking a waiver claim or a trade on an inverted ranking
is a concrete harm against a convenience cost. If a candidate model later
demonstrates positive external skill on untouched data, this decision should be
revisited — the bands are a response to *this* model's measured record, not a
permanent stance on numeric display.

## What this decision does NOT do

- It does not weaken or reword the existing disclosure. `sim.assumptions` still
  carries the full out-of-sample failure statement, now with both sample scopes
  and both AUC intervals rather than one rounded pair.
- It does not flip production to the PAR candidate. See audit §4.
- It does not claim the model is calibrated, validated, predictive, or
  production-safe. `scenarioBand.test.ts` asserts those words are absent, and
  `e2e/20-model-failure-disclosure.spec.ts` asserts it across `/analytics`,
  `/reports` and `/dashboard`.

## Implementation

| Concern | Location |
|---|---|
| Baseline + band logic, disclosure text (single source of truth) | `src/lib/models/scenarioBand.ts` |
| Unit tests incl. wording guards | `src/lib/models/scenarioBand.test.ts` |
| Visible notice | `src/components/model/ModelScenarioNotice.tsx` |
| Baseline-led presentation + raw disclosure | `src/components/model/ScenarioOutlook.tsx` |
| Applied | `NexusSimulator.tsx`, `sections/TeamSignals.tsx`, `app/ReportsView.tsx` |
| Visibility enforcement | `e2e/20-model-failure-disclosure.spec.ts` |

## Accessibility

- axe: green on all 11 scanned routes, desktop and mobile (38 assertions).
- One serious violation was introduced and fixed during this work: the notice
  paints a 7% red tint over `--panel-2`, lifting the effective background to
  `#272632`, where `--red` (#eb5f54) measures **4.46:1** — below AA. Dedicated
  tokens were added against that measured ground: `--notice-red` #f0736a at
  **5.23:1** and `--band-extreme` #9d90e8 at **5.80:1** (the previous `--purple`
  gave 4.59:1, no margin). `--red` itself was left alone; it is tuned for the
  flat panel and other components depend on it.
- `role="note"`, not `role="alert"` — this is a persistent property of the model,
  not a transient event, so it must not interrupt a screen reader on every render.
- The disclosure `<summary>` has a visible focus ring and a 24px minimum target.
- Screenshots at 320 / 390 / 768 / 1440: `reports/2026-08-20/screens/`.

### Pre-existing issue found, not introduced

`/analytics` overflows horizontally at 320px (`scrollWidth` 372 vs `clientWidth`
320). Measured on the pre-change tree at the same viewport and it is **identical**
— the culprits are the top command bar's right-hand cluster, the panel tab strip,
and a data table, none of them touched by this work. Recorded in the audit ledger
as a separate finding rather than silently absorbed here.
