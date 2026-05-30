# RAE Dashboard — Comprehensive Audit Report

**Date:** 2026-05-29  
**Sprint:** 3 (complete)  
**Auditors:** Claude Opus 4.8 × 3 parallel agents + frontend-design skill

---

## Executive Summary

Sprint 3 shipped 9 features across real-data adapters (B2–B5), quantitative
calibration (C1–C5), design/a11y improvements (D1–D4), and a final UI/UX
polish pass (D5). This audit covers code quality, security, data integrity,
architecture consistency, and visual design.

**Net result:** All 11 security/data-integrity checks PASS. Two architecture
issues found and fixed (cron ordering comment, ReliabilityDiagram unconnected).
No fabrication, no secret leakage, no cross-user data leakage. 350 unit tests
passing. CI GREEN on head commit.

---

## 1. Code Quality Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `npx tsc --noEmit` | **PASS** | Exit 0, no errors |
| `npx vitest run` | **PASS** | 350 passed, 4 skipped (354 total, 38 files) |
| `npx next build` | **PASS** | 17 routes compile, exit 0 |
| `npx eslint .` | Not run in this session; previous sprint confirmed clean | — |
| Lighthouse perf ≥ 0.9 | Previous sprint: PASS; three.js removal is a net win | Bundle −54 pkgs |

### Issues resolved

- **vitest pool crash on Node v25.8.2** — fixed by adding `pool: "forks"` to
  `vitest.config.ts`. Without this fix, 38/38 test files fail to initialize
  under the default worker pool. With it: 350 passing.
- **e2e canvas wait timeout** — `03-a11y.spec.ts` and `01-dashboard.spec.ts`
  both waited for `<canvas>` (WebGL) elements. Canvas3D was removed in D4;
  updated to `waitForLoadState("networkidle")` and `svg, .multiverse-wrap`.
- **`applyTestSchema` drift** — the in-memory test DB (`resetDbForTests`)
  was missing `rankings_snapshots`, `ktc_snapshots`, `projections_snapshots`,
  and `news_snapshots`. Fixed in `src/db/index.ts`; the gap would have caused
  "no such table" errors in any future DB-backed snapshot tests.

---

## 2. Security Audit

All 11 checks PASS. Detailed findings:

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Password hashing | **PASS** | `src/lib/passwords.ts` — scrypt + 16-byte salt + `timingSafeEqual` |
| 2 | Credential encryption | **PASS** | `src/lib/crypto.ts` — AES-256-GCM, 12-byte IV, 32-byte key, authTag verified |
| 3 | Secret exposure | **PASS** | Zero `NEXT_PUBLIC_*` secrets; error paths use `redact()` helper |
| 4 | Account isolation | **PASS** | Every league-touching path calls `getLeagueForUser` before data access |
| 5 | CRON_SECRET gate | **PASS** | All 6 cron routes check `Authorization: Bearer ${expected}` → 403 |
| 6 | No module-level credential cache | **PASS** | `fetchLeagueLive` decrypts per-call, no memoization |
| 7 | No fabrication | **PASS** | All behavioral fields default to 0, listed in `missingFields` |
| 8 | Source metadata | **PASS** | `SourceMetaSchema` makes `missingFields` + `assumptions` required |
| 9 | FAAB extraction | **PASS** | `extractSleeperFaabRatio` handles null/used>total/non-numeric |
| 10 | Off-season projections | **PASS** | Cron returns `{skipped:true}` when `season_type !== "regular"` |
| 11 | ESPN news fallback | **PASS** | Priority: news → Sleeper proxy → 0 (declared missing) |

**One observation (not a finding):** `/api/admin/init-db` returns raw error
detail on failure. This is gated by `DB_INIT_TOKEN` and intentional for ops
use. Worth noting in a future hardening sprint if the token is weak.

---

## 3. Data Integrity Audit

No fabrication found. The pipeline is fully honest:

- **trendingMomentum**: ESPN news velocity (B5) → Sleeper proxy (G) → 0 + declared missing
- **opportunity**: always 0 + declared missing (no in-season source integrated)
- **fragility**: always 0 + DataUnavailable banner (CommandCenter, A3)
- **weeklyProjections**: only populated during regular season (B4 off-season guard)
- **FAAB**: extracted from Sleeper `settings.waiver_budget` vs `waiver_budget_used` (A2)

---

## 4. Architecture Inconsistencies Found & Fixed

### WARN: Cron schedule ordering (fixed)

`vercel.ts` commented that `news-refresh` runs "before lifecycle-check so
trendingMomentum scores are ready for notifications." But `news-refresh` was
scheduled at 45 min past the hour and `lifecycle-check` at 30 — news ran
**after** lifecycle.

**Root cause:** The lifecycle cron does not currently consume news/trendingMomentum
(confirmed by audit — it only evaluates bye/FAAB/injury rules from roster data).
So the ordering was benign at runtime, but the comment was factually wrong.

**Fix:** Moved `news-refresh` from `45 9 * * *` to `20 9 * * *`. Correct order
is now: projections(15) → news(20) → lifecycle(30). The pipeline is ready for
when lifecycle eventually consumes news-derived trendingMomentum.

### FAIL: ReliabilityDiagram built but never wired (fixed)

`src/components/charts/ReliabilityDiagram.tsx` was created in C3 but never
imported by any consumer. The plan explicitly called for it in NexusSim's
"Risk Analysis" tab.

**Fix:** Added import to `NexusSimulator.tsx` and wired it into the Risk
Analysis tab with an honest "Awaiting backtest data" placeholder (rendered
by the component's built-in null-bins path).

---

## 5. Sprint 3 Feature Completion

| Feature | Status | Key files |
| --- | --- | --- |
| A1 Doc rot | ✅ | README, lifecycle-check comment, AUDIT.md |
| A2 FAAB extraction | ✅ | fetchLive.ts + lifecycle-check route |
| A3 Fragility banner | ✅ | CommandCenter.tsx |
| B1 trendingMomentum rename | ✅ | 24 files, 0 remaining `narrativePressure` |
| B2 Sleeper projections | ✅ | projections.ts, projectionsSnapshot.ts, cron route |
| B3 ESPN news adapter | ✅ | news.ts, newsSnapshot.ts, newsMatch.ts, cron route |
| B4 NexusSim projections wiring | ✅ | simulation.ts, page.tsx, NexusSimulator.tsx |
| B5 ESPN news → trendingMomentum | ✅ | enrich.ts, toEnvelope.ts, page.tsx |
| C1 nflverse probe | ✅ | 2025 data complete; script tries 2025→local→2024 fallback |
| C2 Brier score + Murphy decomp | ✅ | distribution.ts + 18 new tests |
| C3 ReliabilityDiagram component | ✅ | charts/ReliabilityDiagram.tsx, wired in NexusSim |
| C4 kFoldCV helper | ✅ | distribution.ts + 5 new tests |
| C5 brier-backtest.ts script | ✅ | scripts/brier-backtest.ts + docs/calibration.md update |
| D1 a11y coverage extension | ✅ | 3 new routes in 03-a11y.spec.ts |
| D2 a11y spot-fixes | ✅ | role=alert, aria-live, aria-describedby |
| D3 Heatmap2D component | ✅ | charts/Heatmap2D.tsx (~100 lines, SVG, accessible) |
| D4 3D → 2D swap + three.js removal | ✅ | 7 files deleted, −54 packages |
| D5 UI/UX palette redesign | ✅ | globals.css, TopBar, DataUnavailable, Heatmap2D |

---

## 6. UI/UX Design Changes (Sprint 3 D5)

**Design direction:** Neutral slate-blue ESPN/NFL analytics palette. Moves
away from pure graphite/amber toward a navy-slate base with slate-blue as the
primary interactive accent. Amber retained as `--accent-warm` for high-attention
elements (governance banner, position badges). Dark-only.

### Color system

| Token | Before | After |
| --- | --- | --- |
| `--bg` | `#0c0e12` graphite | `#0b1120` navy-slate |
| `--panel` | `#16191f` | `#111827` |
| `--panel-2` | `#1d212a` | `#18222f` |
| `--cream` | `#e9ebef` | `#f0ece4` warm-white |
| `--muted` | `#878f9c` | `#8898aa` blue-grey |
| `--blue` (primary accent) | `#4a8cf7` blue | `#4a8db7` slate-blue |
| `--amber` / `--accent-warm` | `#eaa53d` | `#d7a857` retained secondary |
| `--line` (borders) | `rgba(255,255,255,0.09)` | `rgba(74,141,183,0.12)` slate-tinted |
| `--panel-shadow` | dark glow | `0 2px 16px rgba(74,141,183,0.08)` |
| border-radius-lg | 8px | 10px |

### Shell improvements (TopBar)

- Mode badge: added `aria-label` and `aria-label` on container
- LIVE badge: subtle 2.5s pulsing dot (`live-dot` keyframe, opacity+scale only)
- System tabs: active state → slate-blue ring + 2px underline (was amber)
- Tab hover: `hover:bg-rae-blue/6` (was generic accent)

### Component improvements

- **DataUnavailable**: hatch pattern → dot-grid (14px, slate-blue, 40% opacity)
- **Heatmap2D**: `DEFAULT_COLOR` updated slate-blue → amber → coral (3-band, opacity-ramped)
- **mini-panel**: border-radius 6px + hover border/shadow transition (150ms)
- **run-sim-btn**: green → slate-blue palette
- **player-grid-card**: hover uses slate-blue tint
- **governance-banner**: `-webkit-backdrop-filter` added (Safari compat)
- **focus rings**: amber → 2px solid slate-blue, 2px offset (WCAG 2.1 AA)
- **`@media (prefers-reduced-motion: reduce)`**: already present, guards all keyframes

### Accessibility (WCAG 2.1 AA compliance)

- `button:focus-visible`: outline changed to `2px solid var(--blue)` with `outline-offset: 2px`
- All interactive states (hover/focus/active) remain ≥ 4.5:1 contrast for text
- No new color-only state encoding introduced
- New `aria-label` on mode badge wrapper and Badge element

---

## 7. Prioritized To-Do List (Sprint 4 Candidates)

**High value, low effort:**
1. **Lifecycle cron: consume news trendingMomentum** — the ordering is now correct; wire `getLatestNewsSnapshot` into `evaluateLifecycleRules` for richer notifications.
2. **`/api/admin/init-db` hardening** — rate-limit + log the call; consider stripping raw error detail from response body.
3. **E2E extended coverage** — `/settings/account` and `/settings/leagues` redirect to `/login` when unauthenticated; add signed-in flows for these routes.

**Medium value, moderate effort:**
4. **Lifecycle cron circuit-breaker** — under 100+ leagues the sequential decrypt+fetch loop will saturate the 60s window. Add per-league timeout + circuit-breaker for Pro-plan scaling.
5. **ReliabilityDiagram with real data** — run `npx tsx scripts/brier-backtest.ts` after 2025 nflverse data is confirmed; attach the resulting `docs/brier-results.md` bins to the NexusSim Risk Analysis tab.
6. **Weekly Briefing card** — "what should I do this week" above CommandCenter. Highest-impact product gap from earlier audit.
7. **Trade comparison UI** — head-to-head proposal A vs B in TradeCenter; depends on KTC (now live) and the existing `fetchTradeValues` chain.
8. **ESPN news sentiment** — current trendingMomentum uses article count velocity; replace with a lexicon-based sentiment score (VADER or simple positive/negative word count on headlines). Document as NLP-lite, not deep classification.

**Lower priority:**
9. **nflverse `stats_player_week_2025.csv`** — probe again in a few weeks; the 2025 season is complete but nflverse may not have published the per-week CSV yet. Update `brier-backtest.ts` to auto-detect.
10. **Yahoo Fantasy adapter** — OAuth; requires a registered Yahoo developer app. Unblocks a large user segment.
11. **`stats_player_week_2025.csv` fixture** — stash an anonymized 10-row fixture in `src/lib/stats/fixtures/` so `brierBacktest.test.ts` can run without network access.
12. **Inline-style migration in charts** — Heatmap2D, ReliabilityDiagram, BarChart use React inline styles for SVG positioning (linter warns). These are SVG idioms but could be moved to `globals.css` data attributes if the linter rule is enforced project-wide.

---

## 8. Test Coverage Summary

| Category | Count | Delta from Sprint 2 |
| --- | --- | --- |
| Vitest unit tests (passing) | 350 | +75 new in Sprint 3 |
| Vitest skipped (live integration) | 4 | unchanged |
| Test files | 38 | +8 new |
| New test topics | projections schema/fetch/build, ESPN news schema/match/recency weights, brierScore (Murphy decomp), reliabilityDiagram, kFoldCV, synthetic backtest, extractSleeperFaabRatio, panelState trendingMomentum | — |

---

*Report generated by Claude Opus 4.8 from security audit + architecture audit agent outputs + manual verification.*
