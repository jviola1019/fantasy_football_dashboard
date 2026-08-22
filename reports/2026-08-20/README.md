# Audit 2026-08-20 — report index

Four holdout protocols ran during this audit and each left a protocol document
and a result document. Without this index the filenames are not self-explaining:
`holdout-result.md` and `holdout-result-corrected.md` are the *same* protocol,
and the numbered files are *different* protocols, not revisions of one.

## Start here

| document | what it is |
|---|---|
| [FINAL-REPORT.md](./FINAL-REPORT.md) | the audit's answer, section by section |
| [AUDIT-LEDGER.md](./AUDIT-LEDGER.md) | finding-by-finding evidence |
| [HANDOFF.md](./HANDOFF.md) | resume state for a future session |

## The four protocols, in order

Each protocol was **frozen and committed before any metric was computed**, and
each result names the commit that froze it.

| # | question | protocol | result | verdict |
|---|---|---|---|---|
| 1 | does the shipped season model hold out of sample? | [protocol](./holdout-protocol.md) | [result](./holdout-result.md) → [corrected](./holdout-result-corrected.md) | **FAILED** both criteria |
| 2 | does it hold on a larger external holdout? | [protocol-2](./holdout-protocol-2.md) | [result-2](./holdout-result-2.md) | **FAILED**; refuted our own "inverted" claim |
| 3 | does the reputation edge find mispriced players? | [protocol-3](./holdout-protocol-3.md) | [result-3](./holdout-result-3.md) | **FAILED**; within position, inverted |
| 4 | does in-season opportunity add over production? | [protocol-4](./holdout-protocol-4.md) | [result-4](./holdout-result-4.md) | **PASSED** all three, Holm-corrected |

**Why `holdout-result-corrected.md` exists.** Protocol 1's first write-up
contained a power calculation that used a 0.5 null while the test itself used
0.5661, which inverted the conclusion from "underpowered" to "adequately
powered". The correction is kept as a separate file rather than folded into the
original, so the error and its fix both remain visible. The confirmatory numbers
were byte-identical across both runs.

**Protocol 4 is the only one that passed**, and its result carries four limits
that must travel with it — the gain is +0.0137 out of fold, p<0.0002 is the
bootstrap floor, part of the effect is mechanical under PPR scoring, and the
scope is in-season only. See [result-4](./holdout-result-4.md).

## Supporting analyses

| document | what it establishes |
|---|---|
| [holdout-label-validation.md](./holdout-label-validation.md) | the outcome label was wrong for 33% of leagues (division winners) and was corrected to observed bracket participation |
| [holdout-diagnostics.md](./holdout-diagnostics.md) | why the model fails: every predictor is a monotone function of consensus rank |
| [par-dependence-analysis.md](./par-dependence-analysis.md) | points-above-replacement did not break that dependence |

## Raw evidence

Console captures (`*.txt`) and the archived datasets (`*.json.gz`,
`*.jsonl.gz`) are the inputs each result reproduces from. `nflverse-usage.json.gz`
backs protocol 4; `holdout-data.jsonl.gz` is pinned to protocol 1 and
`holdout-data-p2.jsonl.gz` to protocols 2–3.

Data is MyFantasyLeague public export and nflverse (CC-BY).
