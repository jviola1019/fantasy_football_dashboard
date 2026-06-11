# 04 — App Shell / Routes / UI-UX / A11y / Copy Audit

**Worker:** app_shell_uiux_auditor
**Branch:** audit/2026-06-09 (== origin/main = production)
**Date:** 2026-06-09
**Method:** read-only static audit (Read / Grep / Glob / git log). No dev server. file:line citations; severity S0–S3; confidence H/M/L.

---

## Scope recap

App shell (`(app)/layout.tsx`, `components/shell/*`), every route page, panels (`components/panels/*`), dashboard tiles (`components/dashboard/*`), governance components (`components/governance/*`), UI primitives (`PanelTabs`, `PanelCard`, `BackToDashboard`), topbar (`LeagueSwitcher`, `UserMenu`). Onboarding `/`, `/login`, `/mock-draft`, `/settings/*`.

---

## Strengths (verified, keep)

- **One governed envelope, one shell.** `(app)/layout.tsx:18` resolves `loadEnvelope()` once (React `cache()` in `load.ts:221`), every route page is a thin wrapper that re-uses it, and the shell (`AppShell.tsx`) wraps all routes identically. Chrome + governance never drift route-to-route. (H)
- **Always-on governance strip.** `GovernanceBanner.tsx` surfaces league format/season/draft-state + source · freshness · confidence · validation · missing-fields + assumptions drawer on *every* route, plus `DemoBanner` when `mode==="fixture"`. This is the backbone that lets most screens answer "is this live/demo, what data, can I trust it." (H)
- **Honest pool/mode model.** `derive.ts:42-51` swaps universe (pre-draft) vs free-agents (post-draft) vs roster pools per `draftState`; anonymous users get the labeled fixture envelope (`load.ts:179-184`, `publicDemoEnvelope`). Demo is never silently presented as live. (H)
- **Per-tab data-state gating done right.** `MarketIntelligence` Liquidity/Sentiment tabs, `PlayerUniverse` Watchlist/Projections, `WaiverWire` Edge column, `NexusSimulator` CI widening, `TeamConstruction` DEF grade — all degrade to `<DataUnavailable>` or "—" with an explicit "no integrated source" explanation instead of fabricating. `DataUnavailable.tsx` is visually distinct from loading (dot-grid, mono caption). (H)
- **Conditional probability is labeled as conditional.** `outcomeHeat.ts` + the Nexus Multiverse heatmap + MI "Outcome Probability Landscape" all render **P(outcome | wins)**, each column summing to 100%, with a plain-English caption (`outcomeHeat.ts:77-79`) explaining *why* conditional (avoids the 14-0-column-looks-dim misread). This is exemplary. (H)
- **PanelTabs a11y is excellent.** `PanelTabs.tsx` is a proper WAI-ARIA tablist: roving tabindex, ←/→/↑/↓/Home/End, wrapping, `aria-selected`, strong `focus-visible` ring, `useId()`-namespaced `layoutId`, and reduced-motion collapse of the pill slide (`PanelTabs.tsx:104-108`). (H)
- **Per-route `sr-only <h1>`** on all 9 in-app routes (`dashboard/page.tsx:11` and siblings); settings pages have real visible `<h1>`. Heading outline starts at h1 everywhere. (H)
- **Charts have text alternatives.** `Heatmap2D` (per-cell `aria-label`+`<title>`, caption), `PriceDiscoveryView` `role="img"` + per-point `<title>`, ReliabilityDiagram/Radar/Bar/Donut all carry aria. (H)
- **Dead code was actually removed.** `CommandCenter` is gone (only doc-comment references remain in re-homed sections); there is no `LineChart.tsx` (matches are doc files only). The deep CommandCenter sections were re-homed to analytically-appropriate routes (`RouteView.tsx:36`). (H)

---

## Issues — exact, with root cause

### S1 — Governance defect: fabricated "P10/P90" uncertainty band on Lineup Win Probability
**File:** `src/components/panels/sections/TeamSignals.tsx:36-61` (`LineupWinProb`)
**Confidence:** H

```ts
const mid = Math.min(100, Math.max(0, sim.playoffProbability));
const p10 = Math.round(Math.max(0, mid * 0.68) * 10) / 10;
const p90 = Math.round(Math.min(100, mid * 1.32) * 10) / 10;
```

The triangle chart labels these `P10` / `P90` — i.e. it presents them as the 10th/90th percentiles of a distribution. They are **not**: they are the point estimate multiplied by hardcoded 0.68 / 1.32 constants. This is a manufactured ±32% band with no basis in the sim's distribution. It directly violates the guardrail "Never hardcode probabilities" and "Probability output must show uncertainty or *real* limitations." The irony: `NexusSimulator.ConfidenceBands` computes a *real* bootstrap CI from 20 replicates (`NexusSimulator.tsx:275-296`) — so the app already knows how to do this honestly; TeamSignals just doesn't. A user reads "P10 = X%, P90 = Y%" as genuine percentiles. This is the single most important UX/governance defect in scope.
**Fix:** either derive p10/p90 from `sim.distribution`/a bootstrap (reuse the ConfidenceBands path), or relabel as "illustrative band — not a modeled percentile" and visually de-emphasize. Best: render the real CI.

### S2 — A11y: Framer-Motion animations ignore reduced-motion (only PanelTabs respects it)
**Files:** `src/components/panels/NexusSimulator.tsx:218-227` (`motion.path` `pathLength` tween in OutcomeMultiverse) and the REPLAY handler `:75-78` / button `:91-99`.
**Confidence:** H

`useReducedMotion` is consumed in exactly one file — `PanelTabs.tsx` (grep confirms: only `PanelTabs.tsx` + `globals.css`). The global CSS `@media (prefers-reduced-motion: reduce)` (`globals.css:139`, dup at `:1355`) only neutralizes **CSS** animation/transition; it does **not** stop **JS-driven Framer Motion** tweens. The Outcome Multiverse path-draw animation and the "REPLAY" re-trigger therefore animate for users who requested reduced motion. The SVG is `aria-hidden` so it's not announced, but motion-sensitive users still see it. Guardrail: "Reduced motion support (`useReducedMotion`)."
**Fix:** gate the `animate`/`transition` in NexusSimulator on `useReducedMotion()` (set `pathLength: 1` / `duration: 0`), and disable/relabel REPLAY under reduced motion.

### S2 — Dead component: shadcn Radix `tabs.tsx` is unused (the "second tab system" is a ghost)
**File:** `src/components/ui/tabs.tsx`
**Confidence:** H

The scope asks whether "the two tab systems behave consistently." In reality there is only **one** in-panel tab system in use — the custom `PanelTabs` (used by MarketIntelligence, NexusSimulator, PlayerUniverse, DraftIntelligence, TradeCenter). The shadcn `ui/tabs.tsx` (Radix `TabsList/TabsTrigger`) has **zero imports** anywhere (verified by grep). The "two tab systems" are actually *PanelTabs (in-panel)* + *the route sidebar/mobile-nav navigation* — different concerns, and they are consistent. The Radix tabs file is dead weight that invites future drift (someone could wire a panel to it and get a different keyboard model than PanelTabs).
**Fix:** delete `src/components/ui/tabs.tsx` (or document it as the canonical primitive and migrate PanelTabs onto it — but PanelTabs is richer, so delete is cleaner).

### S2 — Label collision: "Multiverse" means two different things
**Files:** `DraftIntelligence.tsx:17` (`TABS = [..., "Multiverse"]`) vs `NexusSimulator.tsx:26` (`TABS = ["Multiverse", ...]`).
**Confidence:** M

In NexusSimulator, the "Multiverse" tab is the **Outcome Multiverse** — a genuine probabilistic outcome landscape. In DraftIntelligence, the "Multiverse" tab renders the **"DRAFT RECOMMENDATION BOARD"** (`DraftIntelligence.tsx:91-92` → `DraftBoardView`), a static score-ranked list with **no simulation/probability** at all. Same word, two unrelated meanings — the draft one borrows "Multiverse" sci-fi flavor it doesn't earn, and a user who learned "Multiverse = probability landscape" on /analytics will misread the /draft tab. The tab content also doesn't match its title (board, not multiverse).
**Fix:** rename the DraftIntelligence tab to "Recommendation Board" (or "Board").

### S3 — Inconsistent no-envelope default: ready (optimistic) vs unavailable (honest)
**Files:** `NarrativeEngine.tsx:36-37` and `WaiverWire.tsx:30-32` default to `status: "ready"` when `envelope` is undefined; `MarketIntelligence.tsx:40-45` defaults to `"unavailable"`.
**Confidence:** M

When no envelope is passed, MI honestly assumes data is unproven (`unavailable`), but NarrativeEngine/WaiverWire assume `ready` and render behavioral signals as if verified. In the live app `RouteView` always passes `envelope`, so the practical blast radius is low — but it's a latent governance landmine (a future caller rendering these standalone would surface unverified hype/edge as real). The optimistic default contradicts the "default to honest" posture MI took deliberately (`MarketIntelligence.tsx:38-39` comment).
**Fix:** make the no-envelope default `unavailable` in NarrativeEngine and WaiverWire to match MI.

### S3 — Heatmap `role="img"` aria-label is generic and slightly misleading
**File:** `src/components/charts/Heatmap2D.tsx:57`
**Confidence:** H

The SVG carries a fixed `aria-label="Heatmap showing probability distribution across risk and scenario dimensions"`. In every actual use it renders **P(playoff outcome | regular-season wins)** — not "risk and scenario dimensions." For a screen-reader user the `role="img"` aria-label *replaces* the rich content, and the accurate `caption` below is a separate node. So AT users get a vaguer (and wrong-domain) description than sighted users.
**Fix:** pass an accurate `ariaLabel` prop from the caller (it already passes `caption`), or default the aria-label to the `caption`.

### S3 — `BackToDashboard` default href is `/` but the label says "Dashboard"
**File:** `src/components/ui/BackToDashboard.tsx:9` (default `href = "/"`), used in `login/page.tsx:18` and `mock-draft/page.tsx:63`.
**Confidence:** M

The control reads "← Dashboard" but links to `/`, which is the **onboarding** surface for anonymous users (only redirects to `/dashboard` once signed in, `app/page.tsx:16`). From `/login` (anonymous) clicking "Dashboard" lands on the marketing page, not a dashboard — a small "what will this do" mismatch. From `/mock-draft` (often anonymous) same thing.
**Fix:** either pass `href="/dashboard"` at those call sites, or relabel the default to "Home" when href is `/`.

### S3 — `TradeCenter` is the lone client-fetch-on-mount panel (skeleton/SSR honesty)
**File:** `src/components/panels/TradeCenter.tsx:20-44`
**Confidence:** M

Every other route renders server-side from the shared envelope; `/trades` `TradeCenter` is `'use client'` and loads trade values via server actions in `useEffect` with a `"loading"` → `"ready"|"unavailable"` state. The loading text ("Loading trade values…") is honest and the `unavailable` branch refuses to fabricate (`:55-60`), so this is *acceptable*, not a defect — but it's the one route where first paint is empty and data is not SSR'd, so it's worth noting for consistency and for the "no public placeholder leak" concern (the empty/loading state is brief and labeled, so no leak). No governance/source badge is shown on the Trade Center panel header (see next).

### S3 — Governance is banner-only on most panels; per-panel source/freshness badge is absent
**Files:** `SourceFreshnessBadge.tsx` is used only in `mock-draft/page.tsx:6` and `ReportsView.tsx` (grep). Route panels (MarketIntelligence, NexusSimulator, PlayerUniverse, DraftIntelligence, WaiverWire, TradeCenter, NarrativeEngine, dashboard tiles) do **not** render a per-panel source/freshness/confidence badge.
**Confidence:** H

The global `GovernanceBanner` *does* carry source/freshness/confidence/validation for the whole route, and panels disclose their own *missing fields* inline — so the guardrail "source freshness visible" is met at route level. But the Quant-Governance rule says "**every model output** must expose source, freshness, confidence." A panel like Nexus (probabilities) or Market Intelligence (edges) shows neither its own confidence nor source in its header — the user must associate the top banner with each panel. On multi-panel routes (/analytics has 4 panels with different real sources: sim vs ECR vs trending) one banner can't honestly represent all of them. This is a surfacing gap, not a fabrication.
**Fix:** add a compact `SourceFreshnessBadge` (already built) to the `controls` slot of each model-output PanelCard, scoped to that panel's primary source.

### S3 — Redundant duplicated CSS block
**File:** `src/app/globals.css:139-141` and `:1355-1362` — two identical `@media (prefers-reduced-motion: reduce)` resets.
**Confidence:** H. Harmless but dead-weight; collapse to one.

---

## Information architecture — verdict

- **Nav consistency:** PASS. `navItems.ts` is the single source for both `RouteSidebar` and `MobileBottomNav`; `isActiveHref` shared; `aria-current="page"` on both. Sidebar numbers 1..9; mobile bottom nav numbers the *visible* primary subset 1..N sequentially (no gap when Waivers is skipped — `MobileBottomNav.tsx:51-54`). (H)
- **Two tab systems:** see S2 — only one in-panel system (PanelTabs) is live; route nav is the other "system" and is consistent. The dead Radix `tabs.tsx` is the only inconsistency risk.
- **Mobile targets:** `MobileBottomNav` items are `min-h-[54px]` (≥44px ✓) with `pb-[env(safe-area-inset-bottom)]`. `pb-16` shell spacer clears the bar (`AppShell.tsx:38`). (H)

---

## Wireframe / mockup guidance (3 most important routes)

### /dashboard — overview (add per-tile lineage, keep tile hierarchy)
```
┌──────────────────────────────────────────────────────────────┐
│ [≡] RAE  Reputation Arbitrage Engine    [League ▾][User ▾][● LIVE · fresh]│  ← TopCommandBar
├──────────────────────────────────────────────────────────────┤
│ DEMO fixture (if mode=fixture)   |  League: PPR · 12-team · 2024→2025 · pre-draft (full universe) · Source… [Assumptions ▾]│
├──────────────────────────────────────────────────────────────┤
│ ⓘ Pre-draft 2025. These are your 2024 carryover players…  → Draft / Mock │  ← SeasonNotice
│ ┌───────────────── League Health ─────────────┐ ┌──── League Pulse ─────┐│
│ │ Rep Edge | Mkt Ineff | Narr Vel(—) | Adv 50%| │ │ 1 Player ███████ 92  ││  ← add tiny src badge
│ │ Chaos(—)                                     │ │ 2 …                   ││     per KPI strip
│ └──────────────────────────────────────────────┘ └───────────────────────┘│
│ ┌──── Top Insights ────┐ ┌──────── Next Best Actions ──────────┐          │
│ │ Undervalued +14 …    │ │ ⚠ Cover X (Out) → Waivers           │          │
│ │ Overvalued  -9  …    │ │ ↑ Sell high Y  → Trades             │          │
│ └──────────────────────┘ └─────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```
Guidance: 2×2 tile grid is good (progressive disclosure, one screen). Add a 1-line `SourceFreshnessBadge` into each PanelCard `controls` so each tile names its own source (S3 surfacing fix). "League Advantage 50%" needs a clearer sub than "vs League Median" (50% reads ambiguous — is it good?).

### /draft — board + audit + construction (fix tab name + add board legend)
```
┌──────────────── Draft Intelligence ───────────[12 mine·3 taken·…][Reset]┐
│ [ LIVE BOARD ][ RECOMMENDATIONS ][ TIER COLLAPSE ][ BOARD ]              │ ← rename "Multiverse"→"Board"
│ ┌── AVAILABLE (search all) ──────────────┐ ┌─ ON THE CLOCK ──────────┐  │
│ │ ★Player  Pos Team True Edge [+Mine][Tk]│ │ TopPick  92  VALUE      │  │
│ │  …                                     │ │ • reason • reason       │  │
│ └────────────────────────────────────────┘ └─ YOUR ROSTER (n)·taken ─┘  │
└─────────────────────────────────────────────────────────────────────────┘
┌──────────────── Pre-Draft Audit ────────────────────────────────────────┐
│ DETECTED LEAGUE SETTINGS (Source: detected/not provided)  | POOL GRADES  │
└─────────────────────────────────────────────────────────────────────────┘
┌──────────────── Team Construction ──────────────────────────────────────┐
│ Overall B+ | QB A · RB B · WR A- · TE C · K — · DEF —(fragility missing) │
└─────────────────────────────────────────────────────────────────────────┘
```
Guidance: rename the 4th tab to "Board"/"Recommendation Board" (S2 collision). Board legend (VALUE/NEED/RUN/STASH) is already present and good — surface it above the board too, not only as a footnote.

### /analytics — multi-source route most in need of per-panel lineage
```
┌──────────────── Market Intelligence ────────────────────────────────────┐
│ KPI row (Ineff·Liquidity·Arb·AggValue·Volatility·Regime)   [src: ECR·fresh]│ ← add badge
│ [Market Pulse][Liquidity*][Sentiment*][Arbitrage][Trends][Price Disc.]   │   (*=needs source→DataUnavailable)
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──── Nexus Simulator ────[SIMS 10,000][REPLAY]┐ ┌─ Narrative Engine ──┐ │
│ │ [MULTIVERSE][SCENARIOS][RISK]                 │ │ SELL-HIGH | BUY-LOW │ │
│ │ Heatmap P(outcome|wins) + 95% CI [real]       │ │ src: trending/ECR   │ │ ← real CI ✓
│ │  ↳ path anim must honor reduced-motion (S2)   │ │                     │ │
│ └────────────────────────────────────────────────┘ └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──── Team Signals ───────────────────────────────────────────────────┐  │
│ │ Lineup Win Prob (P10/P90 = FABRICATED band — S1) | Intel | Momentum  │  │ ← FIX S1
│ └──────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```
Guidance: this route has 4 panels with 3+ distinct sources — the single top banner cannot honestly speak for all. Add per-panel `SourceFreshnessBadge`. Fix the Lineup Win Prob band (S1). Gate Nexus path animation on reduced motion (S2).

---

## Open questions

1. Is `src/components/ui/tabs.tsx` (Radix) intentionally kept for a future migration, or is it abandoned? (Affects delete-vs-document for S2.)
2. `LineupWinProb` — is a real percentile band available from `sim.distribution`, or only the point estimate? If the distribution carries playoff-prob spread, S1 fix is a direct swap; if not, the band must be honestly relabeled.
3. Per-panel source badges: is the deliberate decision "one route banner is enough" (lower chrome) accepted by product, or should every model-output panel self-declare? Guardrail text ("every model output") favors the latter.
4. `/trades` client-side fetch: acceptable as-is, or should trade values be SSR'd from the envelope for first-paint honesty parity with other routes?
