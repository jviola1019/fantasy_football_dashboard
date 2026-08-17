# Replacement-level sensitivity — executed evidence (audit P2 §9, §10)

**Date:** 2026-08-17 · **Script:** `scripts/replacement-sensitivity.ts` ·
**Raw output:** [replacement-sensitivity.txt](./replacement-sensitivity.txt) ·
**Reproduce:** `npm run sensitivity:replacement`

## The claim being retracted

An earlier revision of `src/lib/fantasypros/enrich.ts` said, of the 1.2 depth
cushion:

> *"RB lands almost exactly on the old value, which is the evidence that the 1.2
> cushion is calibrated sensibly."*

and a unit test was titled *"stays calibrated against the retired 12-team RB
constant"*.

**That is not calibration.** It is agreement with the previous hand-tuned guess,
on one position, in one league shape. No observed outcome was involved. Both the
comment and the test title are corrected, and the parameters are relabelled
**model assumptions**.

## What was swept

| Parameter | Values | Meaning |
|---|---|---|
| `depthCushion` | 1.00, 1.10, 1.20, 1.30, 1.40 | how far past the last forced starter replacement sits |
| `superflexQbOccupancy` | 0.80, 0.90, 0.95, 1.00 | P(a SUPERFLEX slot is filled by a QB) |

Across **48 league shapes**: 8/10/12/14 teams × STD/HALF/PPR ×
1QB / SUPERFLEX / 2QB / 2TE. Pool of 230 players (QB 40, RB 70, WR 90, TE 30).

## Method note — where the effect can and cannot appear

`ecrToTrueValue` computes `50 + ((replacement - posRank) / replacement) × 50`.
For a fixed position that is **monotonic in `posRank`**, so changing replacement
level *cannot* reorder players within a position. Only **cross-position** order
can move. That is the number that matters: the draft board, the waiver ranking
and trade grades all read this one ordering.

Reported as `inversionRate` — the fraction of ordered pairs whose relative order
flips (0 = identical board), plus churn in the top 12 and top 24.

## Result 1 — depth cushion

Worst case over the entire 48-shape × 4-alternative matrix, versus the 1.2 baseline:

| Metric | Worst observed | Where |
|---|---|---|
| Ordering inversion rate | **0.0423** (4.2% of pairs) | 8T PPR 1QB and 8T HALF 1QB @ cushion 1.00 |
| Top-12 churn | **1 player** | 8T PPR/HALF 1QB, 8T STD 2TE @ 1.00 |
| Top-24 churn | **1 player** | same |
| Max abs ΔtrueValue | **20** (of 100) | @ 1.00 |

Moving the cushion a full ±0.2 from baseline disturbs at most ~4% of
cross-position pairs and moves **at most one player** in or out of the top 24.
The parameter is real but **not decision-dominant** at the top of the board,
which is where draft value concentrates. Sensitivity rises as leagues get
smaller (8-team worst, 14-team least), because the same cushion multiplies a
smaller starter count.

Illustrative levels, 12-team PPR 1QB:

| cushion | QB | RB | WR | TE |
|---|---|---|---|---|
| 1.00 | 12 | 29 | 31 | 12 |
| 1.20 (baseline) | 14 | 35 | 37 | 14 |
| 1.40 | 17 | 41 | 43 | 17 |

## Result 2 — SUPERFLEX QB occupancy

| Metric | Worst observed |
|---|---|
| Ordering inversion rate | **0.0169** (1.7% of pairs) @ occupancy 0.80 |
| Top-12 churn | **0** — in every superflex shape, at every level |

QB replacement depth moves about 10% across the tested range (12-team superflex:
29 at occupancy 1.00 → 26 at 0.80).

Two structural properties were asserted, not assumed:

- **Inert where there is no SUPERFLEX slot** — 0 violations across all 1QB, 2QB
  and 2TE shapes. A 2QB league uses `starters.QB = 2` and is untouched.
- **Demand is moved, not destroyed** — the leftover `1 - occupancy` is
  redistributed onto the flex weights, so total startable demand is conserved
  (64 ± 1 at 8-team, 80 ± 1 at 10-team; the ±1 is integer rounding). Without
  this, lowering the coefficient would have quietly shrunk the league.

### Decision (audit §10 offers A or B)

**Option A — keep occupancy at 1.0, disclosed, with this sensitivity record.**

The audit's own instruction is *"do not add complexity unless it changes
decision outputs materially."* A maximum of 1.7% pair inversions and **zero**
top-12 churn is not material. Deriving an occupancy coefficient from historical
lineup data (Option B) would add an upstream dependency and a fitted parameter
to move nothing a drafter would notice. The parameter is now injectable, so if a
lineup-data source ever lands, Option B is a one-line change with this sweep as
its before/after baseline.

## What is NOT claimed

- Neither parameter is **calibrated**. No observed-outcome target exists for
  either, and none was manufactured.
- No **external decision-relevant target** (roster/start rates, waiver
  availability, historical weekly startability, observed replacement-player
  performance) was reachable as free, licensable data at audit time. That gap is
  reported rather than papered over with a proxy.
- This sweep measures **parameter influence**, not predictive accuracy. Whether
  the resulting `trueValue` predicts anything is the separate, still-open
  question tracked in [`docs/model-validation-plan.md`](../../docs/model-validation-plan.md)
  — the shipped `runNexusSimulation` chain has no out-of-sample validation.

## Downstream reach

Both parameters feed `positionReplacementRank` → `trueValue`, and `trueValue`
feeds the season simulation, draft board, trade grades and waiver rankings. So
the ordering figures above bound all four simultaneously: they are the same
ordering, read by different panels. The season simulation additionally consumes
`trueValue` as a magnitude, where the ΔtrueValue ≤ 20 bound applies.
