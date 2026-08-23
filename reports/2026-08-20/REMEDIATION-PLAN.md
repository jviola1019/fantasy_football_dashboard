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

---

## Design audit (re-dispatched after the first attempt hit a session limit)

### Fixed — `a40e1d7`

| # | finding | why it mattered |
|---|---|---|
| D-1 | **`.btn-primary` was undefined** — used at `LeagueSettingsForm.tsx:181`, defined nowhere | With the global `button` reset (`background:none; border:none; padding:0`), the Save action for every connected league rendered as **bare inline text**. A functional break, not a style issue. Defined from tokens matching `.login-submit`. |
| D-2 | **Four concurrent live regions** on `/dashboard` | `GovernanceBanner` was `role="status"` on a paragraph mounted on every route whose content changes on every navigation — a screen reader read the **entire governance paragraph** aloud on each route change. `ModeBanner` was permanently mounted with `aria-live` and a per-request freshness string (and triple-labelled). `SeasonNotice` had `role="status"` on a static explainer. All standing context, not events. |
| D-3 | **Two colour-only signals** (WCAG 1.4.1) | `DraftIntelligence` tier-collapse Intensity showed a bare `62%` with severe/moderate/mild carried by red/amber/green alone. `LeagueHealth` "League Advantage" flipped pos/neg at 50 with a static "vs League Median" sub-label — so above/below was colour-only **and the threshold was never stated**. |
| D-4 | **No skip link** | axe passes without one (landmarks satisfy its `bypass` rule), but keyboard users traversed the sidebar trigger, a 9-item route sidebar, the league switcher and the user menu before reaching content, on every route. Added with a real `<main id="rae-main">`; verified it is the **first tab stop**. |

Every one of these was **green under axe throughout**. An automated scan bounds
the problem; it does not close it. Three e2e tests now cover what axe cannot.

### Deferred — larger refactors, tracked not dropped

| # | finding | why deferred |
|---|---|---|
| D-5 | **Systematic token drift** — ~40 off-token colour literals across 12 files. A full *pre-repaint* palette survives in `rgba()` form (`#77d7b0` for green, `#d9866f` for red, `#f5c566`/`#eaa53d` for amber, `#4a8cf7` for blue), plus two undeclared text colours (`#d8dece` ×5, `#e8d9b0` ×3) and a chart series palette in `NexusSimulator.tsx:181-185` where only 1 of 5 colours is a current token | A mechanical but wide sweep touching every chart. Needs its own visual-diff pass — a colour regression is invisible to every gate we have. |
| D-6 | **No type scale exists.** `@theme` defines `--space-1..8` and `--radius-*` but **no `--text-*`**. Four unreconciled systems in use: 154 CSS `font-size` declarations across 12 px values, 43 Tailwind defaults, 14 arbitrary `text-[Npx]`, 53 inline `fontSize`. **76% of CSS type is ≤11px** | Defining the scale is easy; migrating 264 sites is not, and doing it badly would regress legibility that currently passes AA. |
| D-7 | **`/analytics` renders ~21 boxed regions** at first paint (4 cards + ~12 bordered sub-panels + 5 KPI tiles) — the "dense spreadsheet with neon panels" silhouette CLAUDE.md rules out | A layout redesign, not a fix. Needs a product decision about what to demote. |
| D-8 | **7 of 8 app routes have ZERO primary CTA**, while the loudest amber object on `/dashboard` is a **non-interactive season chip** (`LeagueSwitcher.tsx:102-114`). UX question 2 ("what should I do next?") is answerable only if you already know where to look | Needs a product decision about what the primary action on each route *is*. Not something to invent unilaterally. |
| D-9 | `role="tab"` with **no `role="tabpanel"` and no `aria-controls`** anywhere — a screen-reader user activates a tab, hears the selection change, then tabs into unlabelled content with no relationship to the control | Mechanical, but touches every tabbed panel; worth doing as one deliberate change with its own test. |

### The five UX questions on `/dashboard`

Scored by the audit: **1 clean pass, 4 partials.**

- ✅ **Is this live or demo?** — mode pill + full-width demo banner.
- ⚠️ **What is this?** — the only `<h1>` is `sr-only`; a sighted user gets no visible route title, and the product subtitle is `md:`-only so it is hidden on mobile.
- ⚠️ **What should I do next?** — the Next Best Action panel exists but is the bottom-right of four equal tiles with 10px ghost-pill actions (see D-8).
- ⚠️ **What data is driving this?** — route-level governance banner is thorough, but **not one of the four dashboard panels passes `source` to `PanelCard`**, so the per-panel freshness badge never renders. `/analytics` does wire it; `/dashboard` is the outlier.
- ⚠️ **Can I trust it?** — confidence, validation and assumptions are all present, and honest, but delivered as an 11px run-on sentence in a low-contrast strip.

The audit's own summary is the fair one: **the information is almost always
present — the failure is hierarchy, not honesty.** This is the opposite of the
model problem, where the numbers were wrong. Here the governance content is
good and the visual system simply does not rank it.

---

## Record-keeping note

The commit message for `a40e1d7` is **truncated** — it was passed through
`printf`, which consumed the `%` in "62%" and cut the body at that point. The
fixes themselves are complete and verified; only the message is short. It is not
being rewritten because that would require a force-push, which this audit's brief
forbids without explicit approval. This section is the complete record.
