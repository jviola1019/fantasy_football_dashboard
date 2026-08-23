# Remediation plan — audit-agent findings

**Created** 2026-08-22 · **Status** LIVE (updated as items land)

Five audit agents were dispatched across distinct areas. Four returned; the
design audit failed on a session limit and was re-dispatched. This plan tracks
every finding to a decision: **fix**, **defer with reason**, or **reject as a
non-issue**. Nothing is silently dropped.

## Triage principle

Ordered by *who is harmed and how invisibly*, not by reported severity:

1. **Users shown wrong data with no signal it is wrong** — highest. A visible
   error is self-correcting; a plausible wrong number is not.
2. **Machinery that cannot fail** — a guard, gate or test that passes without
   checking. This audit has now found five of these, so the class is assumed
   present until disproven rather than the reverse.
3. **Our own validation being unreliable** — a corrupt backtest misleads only
   the people reading it, but it is how every other decision gets made.
4. **Robustness and hygiene** — real, but nobody is currently harmed.

---

## P0 — fabricated data reaching users

| # | finding | status |
|---|---|---|
| P0-1 | DEF grade was a constant "B+" for every live user; `fragility` never declared missing so every guard was dead code | **FIXED** `97c6774` |
| P0-2 | Every ESPN trade graded "balanced, fairness 1.0" from an empty value map; half-priced trades graded "lopsided" | **FIXED** `97c6774` |
| P0-3 | `myRoster` silently falls back to **another manager's team** when identity resolution fails, stamped `validation: "valid"` | **NEXT** |
| P0-4 | Season-sim "confidence bands" are ~30× too narrow — they measure Monte-Carlo replication noise (<1pp) while measured ECE is 28–30pp, and are labelled "confidence interval" | **PLANNED** |
| P0-5 | Stale opportunity snapshot presented as current; `fetchedAt` dropped so age is never checked, and `opportunity` is removed from `missingFields` regardless | **PLANNED** |

P0-3 is the worst remaining item. A Sleeper user who omits `sleeperUsername`
(it is optional) or renames themselves gets **roster_id 0's players** — every
panel, simulation, trade grade and keeper price computed against a stranger's
team, with no banner and no degradation.

## P1 — silent wrongness and non-determinism

| # | finding | status |
|---|---|---|
| P1-1 | `listLeagues` has no `ORDER BY`; `leagues[0]` is the default active league. Stable on SQLite, arbitrary on Postgres, and an UPDATE relocates the row | **PLANNED** |
| P1-2 | `/api/leagues/[id]/refresh` returns **HTTP 200** with `teamCount: 0` when the fetch failed; docs tell callers to check `res.ok` | **PLANNED** |
| P1-3 | `normalizePpr` maps any reception value outside {0, 0.5, 1} to standard — a 0.25/0.75/1.5 PPR league is silently mis-scored throughout | **PLANNED** |
| P1-4 | Three-team trades collapsed into two sides; C's haul attributed to B | **PLANNED** |
| P1-5 | `news-refresh` writes an empty snapshot as success, resetting the freshness clock while the feature is dark | **PLANNED** |
| P1-6 | `createLeague` writes two rows with no transaction; a credential failure permanently bricks the league with a misleading error | **PLANNED** |

## P2 — our own validation is unreliable

These do not touch users. They are how *we* decide what is true, which is why
they matter more than their user impact suggests.

| # | finding | status |
|---|---|---|
| P2-1 | Brier backtest CSV path derives the forecast from the outcome it scores — AUC 1.0 by construction, written under the same headings as the legitimate path | **PLANNED** |
| P2-2 | `fitLogisticCV` returns 0.5 for every row with one fold; caller reports the result as "the projections' TRUE calibration error" | **PLANNED** |
| P2-3 | PAR curve pools season points across leagues with **different scoring formats** — positionally asymmetric distortion, the exact error `pointsCurve` was built to fix | **PLANNED** |
| P2-4 | `spearman` has no tie handling; degenerate zero-variance buckets inject an arbitrary rank ordering instead of being inert | **PLANNED** |
| P2-5 | Backtests fetch live data with no snapshot or input hash — "seeded and deterministic" is false across days | **PLANNED** |
| P2-6 | `betweenTeamSigma` includes within-team sampling variance, over-dispersing the simulated field ~14% | **PLANNED** |
| P2-7 | Leave-one-week-out is not leakage-free at player level; docstring claims it is | **PLANNED** |

## P3 — coverage gaps

Highest-value untested surfaces, from the coverage audit:

- `auth.ts` — NextAuth wiring; `auth.config.test.ts` tests a *different file*
- `requireUser.ts` — the single authorization choke point
- `timingSafe.ts` — constant-time compare used by all 7 cron routes + init-db
- `redact.ts` — strips secrets from error text; zero tests
- The shared cron-secret gate — **one parameterised test covers 7 routes**
- `toEnvelope.ts` — largest untested lib file, assembles the whole dashboard

## P4 — removal candidates ("remove any useless")

Verified dead, safe to delete:

- `SESSION_VERSION_CLAIM` (`auth/session.ts:39`) — declared, never referenced
- `espnRosterEntryToRecord` (`normalize.ts:45`) — sibling is used, this is not
- `src/lib/espn/index.ts` — barrel nothing imports; all consumers go direct
- 8 Sleeper API wrappers with no caller (`getLeagueDrafts`, `getUserDrafts`,
  `getDraftTradedPicks`, `getUserByName`, `getUserLeagues`, `getMatchups`,
  `getTradedPicks`, `getWinnersBracket`)

**Not deleted, deliberately:** ~21 over-exported internals (drop the `export`,
keep the function) and ~55 test-only exports. Several of the latter look like
research helpers staged for backtests — deleting them would be removing
scaffolding someone intended to use. `revokeAllSessions` in particular reads as
a security feature staged but not yet wired.

## Rejected / verified NOT defects

Recorded so they are not re-investigated:

- JSONB double-decode — guarded in both `snapshotStore.parsePayload` and
  `parseSettings`; correct on both drivers
- `bytea` vs `blob`, timestamp coercion, `RETURNING`, identifier case,
  `ON CONFLICT` — all verified dual-driver safe
- `Math.random` — zero occurrences reaching the UI; everything displayed uses
  seeded `mulberry32` with the seed surfaced to the user
- `new Date()` as a displayed timestamp — every instance is a real event time or
  an injectable comparison operand
- TODO/FIXME/HACK/XXX — **zero** in the codebase
- Fixture data, weather stadium table, chart axis coordinates — correctly
  classified as labelled demo data, reference data, and SVG geometry

## Method note

Every P0 was **reproduced before being fixed** — the DEF grade by executing
`derivePositionGrades`, the trade verdict by executing `evaluateTrade`. Agent
reports are treated as leads, not findings. Two claims in the reports have
already been narrowed on inspection, and any that fail verification will be
moved to the rejected section with the reason.
