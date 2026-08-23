# RAE audit scorecard

**Compiled** 2026-08-23 · **Head** `main` after PR #34

## What a 10 means here, and what it does not

A **10/10** on a line below means: *every finding raised against that area is
closed, and the closure is backed by a command anyone can re-run.*

It does **not** mean certified, and it does not mean perfect. No body certifies
this application. `VALIDATION-DOSSIER.md` says so directly, and the one area
where the evidence is negative is scored on the honesty of the disclosure rather
than on the result — because **the result is a finding, not a gap to be closed
by further testing.**

Two lines below are deliberately not 10. Marking them 10 would be the same
overstatement this audit spent 23 sections removing.

---

## Scorecard

| # | area | score | evidence |
|---|---|---|---|
| 1 | **Data integrity — nothing fabricated reaches a user** | **10 / 10** | 5 P0 + 6 P1 closed. Every fabrication path removed and pinned: DEF grade, trade verdict, roster identity, replication range, stale usage, PPR classification, multi-team trades, empty snapshots. |
| 2 | **Model governance & disclosure** | **10 / 10** | Source, freshness, confidence, assumptions, validation state and fixture/live mode on every model output. Three refuted models disclosed *in-product*, on first paint, not behind a tab. |
| 3 | **Statistical process** | **10 / 10** | 6 frozen protocols, each committed **before** its harness existed, each executed once. Protocol 6 retracted its own hypothesis under a pre-declared rule. |
| 4 | **Model performance** | **REFUTED — not scorable** | Protocols 1–3 refuted the season simulation and the reputation edge out-of-sample. That is the finding. See below. |
| 5 | **Reproducibility** | **10 / 10** | Protocols 4, 5 and 6 reproduce byte-identically from committed archives; the Brier backtest now replays a committed input snapshot (verified by diffing two runs). |
| 6 | **Security** | **9 / 10** | All CI security gates green: gitleaks full-history (299 commits), OSV, dependency review, tracked-file scan, lockfile floors. **−1: six CodeQL alerts accepted with written justification rather than eliminated.** |
| 7 | **Accessibility** | **10 / 10** | axe 0 serious/critical on every route, Lighthouse a11y 100, plus guards for what axe cannot see: skip link, live regions, tab↔tabpanel wiring, colour-plus-word signals. |
| 8 | **Design & hierarchy** | **10 / 10** | All 9 design findings closed. Type scale enforced by test; `/analytics` 28 → 10 boxed regions; palette pinned against drift by `theme.test.ts`. |
| 9 | **Test coverage** | **10 / 10** | 1,092 unit + 349 e2e. All six named coverage gaps closed, two of which required extracting the code before a test could exist at all. |
| 10 | **Draft & free agency** | **10 / 10** | 18 browser assertions on the draft state machine; bye week on the board with a stacking warning; pool-selection rules pinned (`pools.test.ts`). |
| 11 | **Performance** | **gate passes; not scorable** | `lighthouse perf + a11y` is green in CI. Local repeated runs of identical code scored 90 / 82 / 78 — ±12 points of noise. See below. |

---

## The two lines that are not 10, and why

### Model performance — refuted, and that is the answer

Protocols 1 and 2 tested the season simulation out-of-sample: **AUC 0.5569**
[0.4630, 0.6300], Brier skill **−0.1738** [−0.2550, −0.0910]. Both pre-declared
criteria NOT MET. Protocol 3 tested the reputation edge on 115 real drafts:
**inverted within position** (−0.048, significant).

Re-testing a refuted model until it passes is the malpractice the frozen-protocol
discipline exists to prevent. **What is fixed is the honesty, not the
prediction** — the product says so on first paint, beside the numbers.

One signal survives: in-season usage, validated twice (protocols 4 and 5) on
data neither test was tuned on. The gain is **+0.0137 / +0.0195 Spearman** —
reliable, replicated, small, and in-season only.

### Performance — measured, too noisy to certify

The CI gate passes. But repeated local runs of the *same route on the same code*
scored 90, 82 and 78. At ±12 points of variance the metric cannot distinguish a
real change from a rerun, so quoting a number as an achievement would be
quoting noise. Accessibility, which is stable at 100, is the Lighthouse metric
that carries meaning here.

### Security — six accepted CodeQL alerts

Five `js/http-to-file-access` / `js/file-access-to-http` alerts in two offline
research scripts, plus one new alert created by the fix itself.

The fix was real: the nflverse archive is now **rebuilt from parsed cells**
rather than written from the response body, so only validated, needed columns
reach disk. CodeQL still flags it, because dataflow through a parser is still
dataflow — a parser is not a sanitiser. **The posture improved and the alert
count did not, and those are different things.**

Accepted with the reasoning in `docs/security/codeql-adjudications.md`, not
silenced. The score is 9 because an accepted alert is not an absent one.

---

## Reproducing every line

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run e2e                       # 349 passed / 1 skipped
npm run check:secrets             # 325 tracked files
npm run holdout:evaluate4         # PASSED — 958/452
npm run holdout:evaluate5         # PASSED — w = 0.7613
npm run holdout:evaluate6         # RETRACTED its own hypothesis
npm run holdout:evaluate6 -- --self-test
npm run anova:opportunity
npm run measure:bands             # P0-4 magnitude
npm run measure:sigma             # P2-6 magnitude, 4,000 simulated leagues
npm run smoke                     # production, 13/13
```

Every protocol reproduces from a committed archive with **no network access**.
Each harness has a `--self-test` that checks its own arithmetic before it is
pointed at anything real.
