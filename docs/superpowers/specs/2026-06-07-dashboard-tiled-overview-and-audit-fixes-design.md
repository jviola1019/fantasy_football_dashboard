# Design — Tiled `/dashboard` overview + audit-driven fixes

Date: 2026-06-07
Branch: `final-sprint-draft-tabs-heatmap`
Status: approved (scope + Approach B confirmed by user)

## Context

A three-agent read-only audit of the multi-route RAE dashboard (against `CLAUDE.md`
rules + the approved plan `~/.claude/plans/spicy-booping-steele.md`) found **no P1
issues** — data honesty, governance visibility, seeded-sim reproducibility,
security (no secret/`NEXT_PUBLIC` leak, ESPN cookies encrypted + server-only), and
plan/component conformance all hold; the old single-page architecture is fully
removed with no dead code. All gates are green (tsc/eslint, vitest 438, build,
Playwright 128 across chromium + mobile-chrome).

The audit surfaced a set of **P2/P3 gaps the green gate misses** (the axe e2e only
fails on `serious`/`critical`, so moderate heading-order and `aria-hidden` chart
issues slip through) plus one plan gap (`/dashboard` thinner than specified). The
user approved the broadest scope: fix all P2/P3 **and** enrich `/dashboard` to a
tiled overview (Approach B).

## Goals

1. Close the `CLAUDE.md`-mandated a11y gaps (semantic headings; chart text
   alternatives).
2. Make the season-scenario sim apples-to-apples with the baseline (real league
   format, one canonical param source).
3. Enrich `/dashboard` into a tiled overview that surfaces the plan's elements
   (League Health, League Pulse, Top Insights, Next Best Actions) by decomposing
   the monolithic CommandCenter and re-homing its deep sections to the routes
   where they are analytically at home.
4. Polish + reconcile documentation.
5. Keep every gate green at each stage (no failing gates; no governance/data-honesty
   regression).

## Non-goals

- No new data sources, model changes, or fabricated values.
- No change to the governance contract (`RAEEnvelope`/`sourceState`) or the seeded
  sim seed/iterations.
- No rewrite of historical sprint/audit ledgers (only add a "historical" banner).

## Design

### A. Accessibility (CLAUDE.md "semantic headings" + "charts must have text alternatives")

- **Per-route `<h1>`**: each `(app)` panel route (`/dashboard`, `/players`,
  `/analytics`, `/draft`, `/waivers`, `/trades`, `/reports`) gets exactly one
  route-level `<h1>` (visually-hidden `sr-only` is acceptable) so the heading
  outline starts at h1; PanelCard titles stay `<h2>`. Cleanest home: render the
  `<h1>` in `(app)/layout.tsx` from the active route (or per page). Settings/
  onboarding/login already have an `<h1>` — leave them.
- **Chart text alternatives**: `BarChart`, `DonutChart`, `RadarChart` currently set
  the whole SVG `aria-hidden="true"`. Give each `role="img"` + a descriptive
  `aria-label` summarizing the series/values (the pattern `Heatmap2D` +
  `ReliabilityDiagram` already use). Minimal, consistent, no layout change.

### B. Scenario sim consistency

- `src/lib/derivedMetrics.ts`: replace the hand-duplicated `BASE_PARAMS`
  (`{ seed, iterations, rosterSlots: 6, riskTolerance: 0.58 }`) with a re-export of
  the canonical `SIM_BASE` (from `src/lib/envelope/derive.ts`), and derive the
  best/worst scenarios from `baseline.params` (`{ ...baseline.params,
  riskTolerance: 0.9 }` / `0.15`) so all three scenario columns use the real league
  format (numTeams/playoffTeams/regularSeasonWeeks/weeklyProjections), not a default
  12-team/6-starter/14-week league. Still seeded + reproducible.

### C. `/dashboard` tiled overview (Approach B)

New overview = a 2×2 tile grid:

```
[ League Health (KPI strip) ]   [ League Pulse (leaderboard) ]
[ Top Insights (mispricings) ]  [ Next Best Actions ]
```

- Decompose `CommandCenter.tsx`: extract `MetricStrip` → a reusable **LeagueHealth**
  tile and `LeaguePulse` → a reusable **LeaguePulse** tile (exported components fed
  by the existing `commandMetrics` / `players` / `marketEdge`). Keep `SeasonNotice`
  on the overview (answers "what is this").
- **Top Insights** = NEW tile: the top market inefficiencies (biggest
  |reputationEdge| / true-vs-market gaps) computed from the same `marketPool` /
  `marketMetrics` the MI panel uses. No new data.
- **Next Best Actions** = unchanged.
- Removing whole-CommandCenter from the overview also resolves the
  3-redundant-mode-pills finding (banner + tiles, no in-panel mode badge).

**Re-home CommandCenter's deep sections** (verbatim logic, new location):

| Section | New route | Rationale |
|---|---|---|
| `LineupWinProb` | `/analytics` | sim win-probability output (with Nexus) |
| `NarrativeMomentum` + `IntelFeed` | `/analytics` | narrative/news (with NarrativeEngine) |
| `TeamConstructionScore` | `/draft` | roster construction |
| `RosterFragilityXRay` | `/players` | roster availability X-ray |
| `StartSitEdge` | `/players` | lineup edges |

Each moves as an exported component; the target route's `RouteView` composition adds
it. Verify no duplication with existing route content before placing. All keep their
governance/`DataUnavailable`/missing-field behavior unchanged.

### D. Polish

- `/mock-draft`: add a small source/freshness strip + a "consensus rankings, not
  your league" note (it renders model output with no mode/source today).
- `RouteSidebar` footer: drop the hardcoded "all operational" reassurance (keep the
  route count, which is real).
- Remove the unused `LineChart` (dead, no a11y) — confirm zero imports first.
- Reliability diagram: keep the honest "Awaiting backtest data" placeholder (it is
  correct DataUnavailable behavior; wiring live `brier-results.md` bins is out of
  scope).

### E. Documentation

- README: correct the live-spec wording to match the real run (438 passing; 3
  skipped specs / 6 skipped tests; verify exact breakdown from `vitest run`).
- Add a one-line "Historical — predates the multi-route refactor (44e3c08);
  `RaeApp.tsx`/`TopBar.tsx`/`AppSidebar.tsx` were since removed" banner to
  `SPRINT5.md`, `TASKS.md`, `FINAL_AUDIT.md` (do not rewrite bodies).
- Reconcile the plan's `EnvelopeProvider` (replaced by request-cached
  `loadEnvelope()`) + dropped old-anchor redirects (client-only hashes) — note as
  intentional deviations.

## Testing

- Update `15-sprint5` (and any `command-center` assertions) to the new tile ids on
  `/dashboard` and add coverage for each re-homed section on its new route.
- Keep the axe scan green on every route; the new `<h1>`s improve heading-order.
- Run the full gates fresh (free :3000 first) after each stage: tsc, eslint, vitest,
  build, Playwright (both projects).

## Build sequence (each stage ends green + is committed)

1. a11y: per-route `<h1>` + chart `role="img"`/`aria-label`.
2. sim: scenario params from `baseline.params` + `SIM_BASE` re-export.
3. `/dashboard` tiled overview: decompose CommandCenter → tiles, add Top Insights,
   re-home deep sections, update e2e.
4. polish: mock-draft strip, sidebar string, remove LineChart.
5. docs: README + historical banners + plan reconciliation.

## Risks

- **Re-homing is the largest surface change** — mitigate by moving each section as a
  verbatim exported component, verifying no duplication on the target route, and
  re-pointing e2e in the same stage so CI never goes red.
- **CommandCenter decomposition** could regress the overview — mitigate by extracting
  (not rewriting) `MetricStrip`/`LeaguePulse` and keeping their markup/classes
  (`lp-board` etc.) so existing selectors/tests still match where reused.
- **Stale `next start` on :3000** has masked e2e before on Windows (bash `pkill`
  doesn't kill it) — always free the port via PowerShell before each e2e run.

## Acceptance criteria

- tsc + eslint clean; vitest still green (count re-derived); build clean; Playwright
  green on both projects; axe green on every route with a route-level `<h1>` present.
- `/dashboard` renders the four tiles; each re-homed section renders on its new
  route; no section silently dropped.
- Bar/Donut/Radar charts expose an accessible `role="img"` summary.
- Scenario columns use the real league format.
- No fabricated data; governance metadata still visible on every route; docs accurate.
