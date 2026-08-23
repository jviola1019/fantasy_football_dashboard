# Two-way ANOVA — is the opportunity effect homogeneous?

**Executed** 2026-08-22T23:04:41.479Z

> **This is a DIAGNOSTIC, not a sixth protocol.** Protocols 4 and 5 established
> that usage adds information, on pre-registered out-of-sample tests. This asks
> whether that effect is *uniform* across positions and eras. It cannot promote
> or demote those findings, and nothing here licenses a product change.

Design: response **zOutcome** (rest-of-season points, standardised within season×position);
factors **position** (RB/WR/TE) × **usage quintile** (1–5, within season×position).

| quantity | value |
|---|---|
| observations | **1882** player-seasons |
| distinct players (clusters) | **689** |
| seasons | 2017–2024 |

## ANOVA table

| source | df | F | partial η² | p (cluster permutation) |
|---|---|---|---|---|
| position | 2 | 0.000 | 0.0000 | — (see note) |
| **usage quintile** | 4 | **412.47** | **0.4677** | **< 0.00050** |
| position × usage | 8 | 1.351 | 0.0031 | 0.2429 |
| error | 1867 | | | |

p-values from **2000 cluster permutations** — usage shuffled between whole
players within season×position strata, never between rows. The textbook F
distribution is NOT used: player-seasons are not independent, and assuming they
are would understate p exactly as protocol 3's textbook null did.

**Position has no main effect by construction** — the response is standardised
within season×position, so positional means are zero by definition. Its row is
shown for completeness and carries no information.

## Assumption check

Brown-Forsythe (median-centred Levene) F = **9.262** across the 15 cells.
Variance is **not** equal across cells, so the F statistic's nominal reference distribution would be unreliable — which is precisely why the p-values above come from permutation instead.

## Cell means — mean rest-of-season z by position × usage quintile

| position | Q1 (lowest usage) | Q2 | Q3 | Q4 | Q5 (highest) |
|---|---|---|---|---|---|
| RB | -0.784 (n=117) | -0.550 (n=113) | -0.001 (n=115) | +0.347 (n=113) | +1.024 (n=112) |
| WR | -0.854 (n=177) | -0.545 (n=175) | -0.135 (n=173) | +0.456 (n=175) | +1.117 (n=170) |
| TE | -0.734 (n=91) | -0.597 (n=89) | -0.126 (n=88) | +0.312 (n=89) | +1.215 (n=85) |

**Every position shows a monotone rise in outcome across usage quintiles** (within a 0.05 tolerance).

---

## Interpretation

### What it shows

Two findings, and the second is the one worth having.

**1. The usage effect is very large in raw terms.** F(4, 1867) = 412.47,
partial η² = 0.468, p < 0.0005 under a cluster-permutation null. Usage quintile
accounts for roughly 47% of the variance in rest-of-season scoring.

**2. It is HOMOGENEOUS across positions, which is what this analysis was for.**
The position × usage interaction is F = 1.351, p = 0.2429 — not significant. And
every position rises monotonically across all five quintiles:

| position | Q1 → Q5 |
|---|---|
| RB | −0.784 → **+1.024** |
| WR | −0.854 → **+1.117** |
| TE | −0.734 → **+1.215** |

So the pooled effect in protocols 4 and 5 is not carried by one position while
the others do nothing. That was a live possibility — it is exactly how protocol
3's quarterback "finding" turned out to be an artifact — and it is now ruled out
rather than assumed.

### The caveat that matters most

**η² = 0.468 is the TOTAL association between usage and outcome. It is NOT the
incremental value over points-to-date, and the two must not be confused.**

Protocols 4 and 5 measured the *incremental* quantity — what usage adds **beyond
what points already scored predict** — and got **+0.0137** and **+0.0195**
Spearman. Those small numbers and this large η² are both correct, and they
describe different things:

- Usage correlates strongly with future scoring (η² = 0.468, and touches alone
  reached Spearman 0.646 in protocol 5's D4).
- But **most of that overlaps with points already scored**. High-usage players
  are mostly the same players who have already scored highly.
- What is left after removing the overlap is small, real, and replicated.

Quoting the ANOVA without the overlap would overstate the finding by an order of
magnitude. The honest headline remains protocol 4 and 5's: **a small, reliable
increment**, not a 47% explanation of anything.

### Why permutation rather than the textbook F

Brown-Forsythe returns F = 9.262 across the 15 cells, so variance is clearly
unequal and the nominal F reference distribution would be unreliable. Beyond
that, player-seasons are clustered by player and are not independent at all.
Using the textbook null here would have understated p in exactly the way
protocol 3 was caught doing. The permutation shuffles usage between **whole
players within season × position strata**, preserving both the clustering and
the standardisation.

### Status

**Diagnostic, not confirmatory.** This was not pre-registered as a protocol and
it licenses no product change. It answers a question *about* an already
established effect — whether it is uniform — and the answer is that it is.
