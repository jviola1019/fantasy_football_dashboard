# Protocol 7 — result: trees and boosting both lose. Keep the logistic.

**Executed** 2026-08-25, once, against
`reports/2026-08-20/brier-prospective.json.gz` (fingerprint **`bba1d103`**,
3,573 rows). Protocol frozen in `holdout-protocol-7.md` at commit `098f3c9`,
harness committed at `9a51dc8` **before** execution.

Reproduce: `npx tsx scripts/holdout-evaluate-7.ts` (and `--self-test` alone,
13/13, before it touches data).

---

## Verdict

**Nothing beat the baseline. Several arms lost significantly.**

Protocol 7 §6 pre-committed this outcome and its reading: *"nothing beats A →
the single-feature logistic is the right model. Say so and stop."*

| position | A logistic (proj only) | B logistic (11 feat) | C random forest | D boosting |
|---|---|---|---|---|
| QB | **0.2368** | 0.2405 | 0.2420 | 0.2692 |
| RB | **0.1969** | 0.1994 | 0.2077 | 0.2201 |
| WR | **0.2036** | 0.2069 | 0.2095 | 0.2154 |
| TE | **0.2059** | 0.2074 | 0.2140 | 0.2330 |

Brier, out-of-fold leave-one-week-out, lower is better. **Arm A wins every
position.** All twelve ΔBrier values are positive; seven are significant after
Holm–Bonferroni, and every one of those is significantly *worse*.

AUC degrades in the same order at every position — A > B > C > D — so this is not
a calibration artefact. The flexible models discriminate worse as well.

### The baseline is the shipped model, verified

Arm A reproduces `docs/brier-results.md` to four decimals at all four positions
(0.2368 / 0.1969 / 0.2036 / 0.2059). That is not a coincidence to be assumed —
it means the thing the new models were measured against is the model actually in
the product, not a reimplementation that resembles it.

---

## What the arms were for, and what they showed

The point of arm B was attribution. Without a logistic on the same expanded
features, a boosting loss could be blamed on trees and a boosting win could not
be credited to anything in particular.

**Arm B also lost.** So the answer is not "trees are the wrong model class here".
It is **the ten extra features carry no usable signal at this sample size**, and
the flexible models then lose *additionally* by spending capacity on them.

| effect | evidence |
|---|---|
| features add nothing | B ≥ A at all four positions (WR significantly so) |
| trees cost more on top | C > B at all four; D > C at all four |
| boosting is the worst | D worst everywhere, by 0.012–0.032 Brier |

### Why boosting failed hardest — the calibration collapses

| position | ECE arm A | ECE arm D |
|---|---|---|
| QB | 0.0331 | **0.1376** |
| RB | 0.0327 | 0.0891 |
| WR | 0.0175 | 0.0551 |
| TE | 0.0246 | **0.1128** |

Four to five times worse. 300 boosting rounds on 512 QB rows drives the margins
out, and the resulting probabilities are confidently wrong. This is the textbook
small-sample overfitting signature and the ECE column is where it shows.

**Honest limitation:** the configuration had **no early stopping**, and a
gradient-boosted model without it will overfit small data. That is a real
weakness of the arm as specified. Adding early stopping needs a validation split
carved out of the training folds, which is a different design and would have to
be pre-registered — tuning it now, against this evaluation, is exactly what §8
forbids. So the correct statement is narrow: *these hyperparameters, fixed in
advance, lose.* It is not proof that no boosted configuration could win.

---

## Why this is the expected result, in hindsight

Worth stating plainly, because a negative result is easy to write off as a
failed experiment when it is actually informative.

1. **The projection is already an ensemble.** Sleeper's `proj_pts_ppr` has
   consumed matchup, usage, injury status and role. The history features are
   largely *re-derived from the same underlying facts*, so they add variance
   without adding information.
2. **P(hit | projection) is monotone and roughly sigmoid.** That is precisely the
   shape a logistic assumes. A tree approximates the same curve with steps and a
   forest averages many step functions — strictly more parameters for a function
   the parametric form already nails.
3. **n is small where flexibility is expensive.** 512 QB rows, and the clustering
   is worse than that: those rows are ~30 quarterbacks observed 17 times. The
   effective sample is far below the row count, which is why the protocol
   bootstrapped on `player_id` rather than on rows.

---

## What this does not settle

- **QB is still weak.** Arm A's QB is AUC 0.618 and BSS +3.7%: barely better than
  forecasting the base rate. Protocol 7 did not fix that and was not designed to.
  The QB **rank→prob** model in `brier-results.md` remains *worse* than
  climatology (0.2716 vs 0.2458) and should be retired from that report rather
  than defended — the calibration arm beats it decisively.
- **The season simulator is untouched.** `docs/season-calibration.md` remains
  synthetic self-consistency, with the real-data backtest never run. Nothing here
  is evidence about playoff or championship probabilities.
- **One season, one projection source.** 2025 Sleeper. No claim generalises past
  that.
- **A null for QB is uninformative.** ~223 positives cannot detect a 2-point
  Brier move, as §7 said in advance.

---

## Disposition of the code

Protocol 7 §8 pre-committed: *"if the result is 'nothing beats the baseline' …
the code is deleted rather than kept as an unused alternative."*

**Flagging a tension in my own pre-commitment rather than quietly reinterpreting
it.** Deleting `trees.ts` would make this result unreproducible, and the stronger
standing norm in this repository is that *every protocol reproduces from a
committed archive* — which is why protocols 1–3's refuted machinery is still
here. The archive norm wins.

What §8 was actually protecting against is honoured: **nothing from this protocol
is wired into the product.** `trees.ts`, `weeklyFeatures.ts` and
`holdout-evaluate-7.ts` are reachable only from the protocol script, so
`audit-reachability.ts` classifies them alongside `pointsCurve` and
`seasonCalibration` as script-only — an executed-protocol archive, not a
shipped alternative.

`holmBonferroni` and `clusterBootstrap` are the exception and are genuinely
shared: they replace a `holm` helper that existed as four near-identical copies.

---

## Recommendation

**Keep the single-feature logistic.** It is the best model measured here by every
metric at every position, and it is the one already shipping.

If weekly forecasting is worth improving further, the evidence points at *better
inputs*, not better learners:

1. **A second projection source.** Two independent projections disagreeing is
   real information; ten features derived from one projection are not.
2. **Opponent-adjusted context** — defensive strength against the position, which
   nothing in the current feature set encodes and the projection may not fully
   price.
3. **Retire the QB rank→prob model** from `brier-results.md`. It is worse than
   climatology and the report already caveats it; a model that loses to the base
   rate should not share a page with one that beats it.
