# Tiled /dashboard overview + audit fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audit's P2/P3 gaps (a11y, scenario-sim, polish, docs) and turn `/dashboard` into a tiled overview by decomposing CommandCenter and re-homing its deep sections — keeping every gate green.

**Architecture:** CommandCenter's sub-sections become standalone exported components. The `/dashboard` `RouteView` branch renders four tiles (LeagueHealth, LeaguePulse, TopInsights, NextBestActions); the deep sections move into the `/analytics`, `/draft`, `/players` branches. All components read from the existing `deriveAppData(envelope)` result — no new data, no governance change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, vitest, Playwright. Verify after every stage; free port 3000 via PowerShell before each Playwright run (bash `pkill` does not kill `next start` on Windows).

---

## File structure

**Stage 1 (a11y):**
- Modify: `src/app/(app)/{dashboard,players,analytics,draft,waivers,trades,reports}/page.tsx` — add one `<h1 className="sr-only">` per page.
- Modify: `src/components/charts/{BarChart,DonutChart,RadarChart}.tsx` — `role="img"` + `aria-label`.
- Verify `.sr-only` exists in `globals.css`; add if missing.

**Stage 2 (sim):**
- Modify: `src/lib/derivedMetrics.ts` — `BASE_PARAMS` → re-export `SIM_BASE`; scenarios from `baseline.params`.
- Modify/确认: `src/lib/derivedMetrics.test.ts` (or add) — scenario uses league format.

**Stage 3 (tiled overview + re-home):**
- Create: `src/components/dashboard/LeagueHealth.tsx`, `src/components/dashboard/LeaguePulse.tsx`, `src/components/dashboard/TopInsights.tsx`, `src/components/dashboard/SeasonNotice.tsx`.
- Create: `src/components/panels/sections/{LineupWinProb,NarrativeMomentum,IntelFeed,TeamConstructionScore,RosterFragilityXRay,StartSitEdge}.tsx` (extracted verbatim from CommandCenter).
- Delete: `src/components/panels/CommandCenter.tsx`.
- Modify: `src/components/app/RouteView.tsx` — dashboard→tiles; analytics/draft/players→add sections.
- Modify e2e: `e2e/15-sprint5-panels.spec.ts`, `e2e/01-dashboard.spec.ts`, `e2e/16-topbar-nav.spec.ts` (any `#command-center` assumptions).

**Stage 4 (polish):**
- Modify: `src/app/mock-draft/page.tsx` (source strip), `src/components/shell/RouteSidebar.tsx` (drop "all operational"), delete `src/components/charts/LineChart.tsx` (unused — confirm first).

**Stage 5 (docs):**
- Modify: `README.md`, `SPRINT5.md`, `TASKS.md`, `FINAL_AUDIT.md`, the plan file note.

---

## Stage 1 — Accessibility

### Task 1.1: Per-route `<h1 className="sr-only">`

**Files:** Modify each `src/app/(app)/<route>/page.tsx`.

- [ ] **Step 1:** Confirm `.sr-only` exists.
  Run: `grep -n "\.sr-only" src/app/globals.css`
  If absent, add to `globals.css`:
  ```css
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
  ```

- [ ] **Step 2:** In each route page, wrap the returned view with a fragment adding an `<h1>`. Example for `dashboard/page.tsx` (the others use their route name: "Players", "Analytics", "Draft", "Waivers", "Trades", "Reports"):
  ```tsx
  return (
    <>
      <h1 className="sr-only">Dashboard</h1>
      <RouteView view="dashboard" envelope={r.envelope} />
    </>
  );
  ```
  Reports uses `<ReportsView .../>`. Keep the existing `no-league` early return unchanged (NoLeagueCTA already has its own `<h1>`).

- [ ] **Step 3:** Add a Playwright assertion to `e2e/03-a11y.spec.ts` (after the axe loop) that every panel route exposes exactly one `<h1>`:
  ```ts
  test.describe("each app route has a single h1", () => {
    for (const path of ["/dashboard","/players","/analytics","/draft","/waivers","/trades","/reports"]) {
      test(`${path} has one h1`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("h1")).toHaveCount(1);
      });
    }
  });
  ```

- [ ] **Step 4:** `npx tsc --noEmit` → clean.

- [ ] **Step 5:** Commit: `git commit -am "a11y: per-route sr-only <h1> on the panel routes"`

### Task 1.2: Chart text alternatives

**Files:** Modify `src/components/charts/{BarChart,DonutChart,RadarChart}.tsx`.

- [ ] **Step 1:** For each chart, remove `aria-hidden="true"` from the `<svg>` and add `role="img"` + an `aria-label` summarizing the data. Derive the summary from the same props. Examples:
  - BarChart: `aria-label={\`Bar chart: \${items.map(i => \`\${i.label} \${i.value}\`).join(", ")}\`}`
  - DonutChart: `aria-label={\`\${centerLabel ?? "Distribution"}: \${segments.map(s => \`\${s.label} \${s.value}\`).join(", ")}\`}`
  - RadarChart: `aria-label={\`Metric profile: \${axes.map(a => \`\${a.label} \${a.value}\`).join(", ")}\`}`
  (Read each file's actual prop names first; match them.)

- [ ] **Step 2:** `npx tsc --noEmit` → clean; `npx eslint src` → clean.

- [ ] **Step 3:** Free :3000, run axe + new h1 spec:
  PowerShell: `Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue | %{Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue}`
  Run: `npx playwright test 03-a11y --project=chromium` → all pass.

- [ ] **Step 4:** Commit: `git commit -am "a11y: text alternatives (role=img + aria-label) on Bar/Donut/Radar charts"`

---

## Stage 2 — Scenario sim league-format consistency

### Task 2.1: Scenarios from baseline.params

**Files:** Modify `src/lib/derivedMetrics.ts` (lines ~6, ~160-161); `src/lib/envelope/derive.ts` (export `SIM_BASE` if not already).

- [ ] **Step 1:** In `derive.ts`, ensure `export const SIM_BASE = ...`. In `derivedMetrics.ts`, replace `const BASE_PARAMS = {...}` with `import { SIM_BASE } from "./envelope/derive";` — BUT check for an import cycle (derive.ts imports from derivedMetrics?). If a cycle exists, instead move `SIM_BASE` to a new `src/lib/simParams.ts` and import it in both. Verify: `grep -n "derivedMetrics" src/lib/envelope/derive.ts`.

- [ ] **Step 2:** In `deriveScenarioComparison`, change best/worst to derive from the baseline's real params:
  ```ts
  const best = runNexusSimulation(players, { ...baseline.params, riskTolerance: 0.9 });
  const worst = runNexusSimulation(players, { ...baseline.params, riskTolerance: 0.15 });
  ```
  (`baseline` is the existing baseline sim in that function; confirm its variable name.)

- [ ] **Step 3:** Add/extend `src/lib/derivedMetrics.test.ts`:
  ```ts
  it("scenarios use the baseline's league format, not a hardcoded default", () => {
    const players = /* small fixture roster */;
    const baseline = runNexusSimulation(players, { ...SIM_BASE, numTeams: 10, playoffTeams: 4, regularSeasonWeeks: 13 });
    const cmp = deriveScenarioComparison(players, baseline);
    expect(cmp.best.params.numTeams).toBe(10);
    expect(cmp.worst.params.regularSeasonWeeks).toBe(13);
  });
  ```
  (Adapt to the real `deriveScenarioComparison` signature.)

- [ ] **Step 4:** Run: `npx vitest run src/lib/derivedMetrics.test.ts` → pass. Then full `npx vitest run` → still green.

- [ ] **Step 5:** Commit: `git commit -am "fix(sim): scenario comparison uses the real league format (one canonical SIM_BASE)"`

---

## Stage 3 — Tiled /dashboard overview + CommandCenter re-home

### Task 3.1: Extract overview tiles

**Files:** Create `src/components/dashboard/{SeasonNotice,LeagueHealth,LeaguePulse}.tsx`.

- [ ] **Step 1:** Create `SeasonNotice.tsx` — move the `SeasonNotice` function (CommandCenter.tsx:78-100) verbatim, `export function SeasonNotice({ envelope, hasPlayers }: { envelope: RAEEnvelope; hasPlayers: boolean })`. Keep imports it needs (`RAEEnvelope`).

- [ ] **Step 2:** Create `LeagueHealth.tsx` — move `MetricStrip` (CommandCenter.tsx:102-171) verbatim, rename export to `LeagueHealth`, wrap in a `PanelCard id="league-health" titleId="lh-title" title="League Health"`. Props `{ metrics: CommandMetrics; missingFields: string[] }`.

- [ ] **Step 3:** Create `LeaguePulse.tsx` — move `LeaguePulse` + `PULSE_POS_COLOR` + `PULSE_MAX_ROWS` (CommandCenter.tsx:173-233) verbatim, `export function LeaguePulse`, wrap in `PanelCard id="league-pulse" titleId="lp-title" title="League Pulse"`. Keep the `.lp-board`/`.lp-row`/`.lp-bar`/`.lp-value` classes (e2e depends on them). Props `{ players; marketEdge }`.

- [ ] **Step 4:** `npx tsc --noEmit` → clean (these aren't imported yet; that's fine). Commit: `git commit -am "refactor(cc): extract SeasonNotice + LeagueHealth + LeaguePulse tiles"`

### Task 3.2: Top Insights tile

**Files:** Create `src/components/dashboard/TopInsights.tsx`.

- [ ] **Step 1:** Implement a tile showing the biggest market mispricings from the market pool, using the existing `reputationEdge` from `@/lib/models`:
  ```tsx
  "use client";
  import type { PlayerMarketRecord } from "@/lib/governance";
  import { reputationEdge } from "@/lib/models";
  import { PanelCard } from "../ui/PanelCard";

  export function TopInsights({ market }: { market: PlayerMarketRecord[] }) {
    const ranked = [...market]
      .map((p) => ({ p, e: reputationEdge(p) }))
      .filter((x) => Number.isFinite(x.e))
      .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
      .slice(0, 6);
    return (
      <PanelCard id="top-insights" titleId="ti-title" title="Top Insights" eyebrow="Biggest market mispricings.">
        {ranked.length === 0 ? (
          <p className="muted-note">No market data to surface insights.</p>
        ) : (
          <ul className="ti-list">
            {ranked.map(({ p, e }) => (
              <li key={p.id} className="ti-row" data-tone={e >= 0 ? "under" : "over"}>
                <span className="ti-name">{p.name}</span>
                <span className="ti-pos">{p.position}</span>
                <span className="ti-edge">{e >= 0 ? `Undervalued +${e}` : `Overvalued ${e}`}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    );
  }
  ```

- [ ] **Step 2:** Add `.ti-list/.ti-row/.ti-name/.ti-pos/.ti-edge` styles to `globals.css` (mirror the existing `.nba-*` style block; tone colors green for under, amber/red for over).

- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit: `git commit -am "feat(dashboard): Top Insights tile (market mispricings)"`

### Task 3.3: Extract the re-homed sections

**Files:** Create `src/components/panels/sections/{LineupWinProb,NarrativeMomentum,IntelFeed,TeamConstructionScore,RosterFragilityXRay,StartSitEdge}.tsx`.

- [ ] **Step 1:** Move each function verbatim from CommandCenter.tsx into its own file, exporting it, with the imports it needs:
  - `LineupWinProb` (316-358) — needs `SimulationResult`.
  - `NarrativeMomentum` (235-283) — needs `PlayerMarketRecord`, `narrativeVelocity`.
  - `IntelFeed` (285-314) — needs `RAEEnvelope`.
  - `TeamConstructionScore` (360-380) — needs `PositionGrades`.
  - `RosterFragilityXRay` (397-440) + `STATUS_RISK` (385-395) — needs `PlayerMarketRecord`.
  - `StartSitEdge` (442-472) — needs `deriveStartSitEdge` return type, `surname`.
  Each wraps its existing `.mini-panel` markup; no logic change.

- [ ] **Step 2:** `npx tsc --noEmit` → clean. Commit: `git commit -am "refactor(cc): extract the deep sections into standalone components"`

### Task 3.4: Rewire RouteView; delete CommandCenter

**Files:** Modify `src/components/app/RouteView.tsx`; delete `src/components/panels/CommandCenter.tsx`.

- [ ] **Step 1:** Replace the `CommandCenter` import with the new tiles + sections. Dashboard branch:
  ```tsx
  // dashboard — tiled OVERVIEW
  const marketEdge = Math.round(Math.min(99, Math.max(0, 50 + d.commandMetrics.reputationEdge * 1.4)));
  return (
    <>
      <SeasonNotice envelope={envelope} hasPlayers={d.players.length > 0} />
      <PanelGrid>
        <PanelRow cols={2}>
          <LeagueHealth metrics={d.commandMetrics} missingFields={envelope.sourceState.missingFields} />
          <LeaguePulse players={d.players} marketEdge={marketEdge} />
        </PanelRow>
        <PanelRow cols={2}>
          <TopInsights market={d.marketPool} />
          <NextBestActionPanel roster={d.players} market={d.marketPool} draftState={envelope.draftState} />
        </PanelRow>
      </PanelGrid>
    </>
  );
  ```

- [ ] **Step 2:** Analytics branch — append the re-homed sections inside the existing grid:
  ```tsx
  <PanelRow cols={2}>
    <LineupWinProb sim={d.sim} />
    <IntelFeed envelope={envelope} />
  </PanelRow>
  <PanelRow cols={1}>
    <NarrativeMomentum {...deriveNarrativeMovers(d.players)} unavailable={envelope.sourceState.missingFields.includes("trending_momentum")} />
  </PanelRow>
  ```
  (Import `deriveNarrativeMovers` from `@/lib/derivedMetrics`; `NarrativeMomentum` takes `gainers`/`decliners`/`unavailable` — spread `deriveNarrativeMovers(d.players)` which returns `{ gainers, decliners }`.) Wrap the mini-panels in a `PanelCard` if they need a titled container, or a lightweight section wrapper consistent with the route.

- [ ] **Step 3:** Draft branch — add `TeamConstructionScore`:
  ```tsx
  <PanelRow cols={1}>
    <TeamConstructionScore grades={derivePositionGrades(d.players)} fragilityMissing={envelope.sourceState.missingFields.includes("fragility")} />
  </PanelRow>
  ```

- [ ] **Step 4:** Players branch — add `RosterFragilityXRay` + `StartSitEdge`:
  ```tsx
  return (
    <PanelGrid>
      <PanelRow cols={1}><PlayerUniverse players={d.universePool} envelope={envelope} /></PanelRow>
      <PanelRow cols={2}>
        <RosterFragilityXRay players={d.players} />
        <StartSitEdge rows={deriveStartSitEdge(d.players)} hasData={d.players.length > 0} />
      </PanelRow>
    </PanelGrid>
  );
  ```
  (Import `derivePositionGrades`, `deriveStartSitEdge` from `@/lib/derivedMetrics`.) The bare `.mini-panel` sections need a `PanelCard` wrapper for visual consistency on these routes — wrap each re-homed section in `PanelCard` with a stable id (e.g. `lineup-win-prob`, `roster-xray`, `start-sit`, `team-construction`, `narrative-momentum`, `intel-feed`).

- [ ] **Step 5:** Delete `src/components/panels/CommandCenter.tsx`. Verify no remaining import: `grep -rn "CommandCenter" src e2e`.

- [ ] **Step 6:** `npx tsc --noEmit` → clean; `npx eslint src` → clean; `npm run build` → clean.

- [ ] **Step 7:** Commit: `git commit -am "feat(dashboard): tiled overview; re-home CommandCenter sections to analytics/draft/players"`

### Task 3.5: Re-point e2e

**Files:** Modify `e2e/15-sprint5-panels.spec.ts`, `e2e/01-dashboard.spec.ts`, `e2e/16-topbar-nav.spec.ts`.

- [ ] **Step 1:** In `15-sprint5`, replace the `command-center` PANELS entries with the new tile ids on `/dashboard`: `league-health`, `league-pulse`, `top-insights`, `next-best-actions`. Update the "League Pulse" interaction test to target `#league-pulse .lp-board` (was `#command-center .lp-board`).

- [ ] **Step 2:** In `01-dashboard`, replace `#command-center` assertions with `#league-health` + `#league-pulse`. In `16-topbar-nav`, the `/dashboard` anchor (`#command-center`) → `#league-health`.

- [ ] **Step 3:** Add render coverage for the re-homed sections on their routes (e.g. `#lineup-win-prob` on `/analytics`, `#roster-xray` on `/players`, `#team-construction` on `/draft`).

- [ ] **Step 4:** Free :3000 (PowerShell), run: `npx playwright test 15-sprint5-panels 01-dashboard 16-topbar-nav 03-a11y` → all pass. Fix selectors until green.

- [ ] **Step 5:** Commit: `git commit -am "test(e2e): re-point dashboard panel specs to the new tiles + re-homed sections"`

---

## Stage 4 — Polish

### Task 4.1: /mock-draft source strip
**Files:** `src/app/mock-draft/page.tsx`.
- [ ] **Step 1:** Add, near the existing meta line, a small strip: source ("FantasyPros consensus") + `fetchedAt` freshness + a note "Consensus rankings — not your league." Use the snapshot meta already in scope.
- [ ] **Step 2:** Commit: `git commit -am "feat(mock-draft): source/freshness strip + consensus-not-your-league note"`

### Task 4.2: Sidebar string + dead LineChart
**Files:** `src/components/shell/RouteSidebar.tsx`; delete `src/components/charts/LineChart.tsx`.
- [ ] **Step 1:** Confirm dead: `grep -rn "LineChart" src` → only its own file. Delete it.
- [ ] **Step 2:** In `RouteSidebar.tsx`, change the footer to drop "all operational" (keep route count, or a neutral build label).
- [ ] **Step 3:** `npx tsc --noEmit`; free :3000; `npx playwright test 03-a11y --project=chromium`. Commit: `git commit -am "chore: drop hardcoded 'all operational'; remove unused LineChart"`

---

## Stage 5 — Documentation

### Task 5.1: README + historical banners
**Files:** `README.md`, `SPRINT5.md`, `TASKS.md`, `FINAL_AUDIT.md`.
- [ ] **Step 1:** Re-run `npx vitest run`; read the exact "N passed | M skipped" + skipped-file count; set README badge + line 239 to match (438 passing; 3 skipped specs / 6 skipped tests, or whatever the run reports).
- [ ] **Step 2:** Prepend a one-line italic banner to `SPRINT5.md`, `TASKS.md`, `FINAL_AUDIT.md`: `> _Historical — predates the multi-route refactor (44e3c08); RaeApp.tsx / TopBar.tsx / AppSidebar.tsx were since removed._`
- [ ] **Step 3:** Commit: `git commit -am "docs: correct README test counts; mark historical sprint ledgers"`

---

## Final verification

- [ ] Free :3000 (PowerShell). Run full gates: `npx tsc --noEmit` · `npx eslint src e2e --max-warnings=0` · `npx vitest run` · `npm run build` · `npx playwright test` (both projects).
- [ ] All green. Capture a `/dashboard` + `/analytics` + `/players` screenshot for evidence.
- [ ] `git push origin final-sprint-draft-tabs-heatmap`.

## Self-review notes

- Spec coverage: a11y (1.1/1.2) ✓, sim (2.1) ✓, tiled overview + re-home (3.1-3.5) ✓, polish (4.1/4.2) ✓, docs (5.1) ✓.
- The re-homed `.mini-panel` sections get `PanelCard` wrappers with stable ids on their new routes (needed for e2e + heading consistency).
- Risk: import cycle when sharing `SIM_BASE` (Task 2.1 Step 1 handles via a `simParams.ts` fallback). Risk: `next start` stale server — every Playwright step frees :3000 first.
