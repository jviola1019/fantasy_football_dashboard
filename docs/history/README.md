# Historical documents — superseded, kept for provenance

Everything in this directory is a **point-in-time record**. None of it is
current, and none of it should be used to decide what the code does today.

They were moved out of the repository root on 2026-08-18 because six overlapping
audit and planning documents sat beside the README, with no indication of which
was authoritative, and at least one of them asserted a module that has never
existed.

## Where to look instead

| Question | Current source |
|---|---|
| What does the project do, how do I run it | [`README.md`](../../README.md) |
| What is the state of the remediation work | [`HANDOFF.md`](../../HANDOFF.md) |
| What did the 2026-08-06 audit find, and what was done | [`reports/2026-08-06/audit-p1-p2.md`](../../reports/2026-08-06/audit-p1-p2.md) |
| Is the model validated | [`reports/2026-08-06/backtest-valuation.md`](../../reports/2026-08-06/backtest-valuation.md) — **it is not** |
| How sensitive are the model assumptions | [`reports/2026-08-06/replacement-sensitivity.md`](../../reports/2026-08-06/replacement-sensitivity.md) |
| Project rules and guardrails | [`CLAUDE.md`](../../CLAUDE.md) |

## What is here

| File | Written | Status |
|---|---|---|
| `AUDIT.md` | 2026-06 | Superseded. Describes an earlier architecture. |
| `FINAL_AUDIT.md` | 2026-06 | Superseded. **Contained a false claim** — it listed a `lifecycle/trades` library that was planned and never built; corrected in place on 2026-08-18 rather than deleted, so the record of the error survives. Trade grading actually lives in `src/lib/trade/transactions.ts`. |
| `audit_report.md` | 2026-05 | Superseded. |
| `SPRINT5.md` | 2026-06 | Completed sprint log. |
| `TASKS.md` | 2026-05 | Completed task list. |
| `PLANS.md` | 2026-05 | Completed plan. |

## Why these were not deleted

They are the only record of what was believed true at the time, which is what
makes a later correction legible. The `lifecycle/trades` entry is the clearest
example: deleting the file would have removed the evidence that documentation
had drifted from the code, which is itself a finding worth keeping.

Superseded **screenshots** under `reports/audit-2026-06-09/` and
`reports/audit-2026-06-11-screens/` were removed from git tracking in the same
change (3.76 MB, 13 PNGs of UI that no longer exists). The written findings from
both audits were kept.
