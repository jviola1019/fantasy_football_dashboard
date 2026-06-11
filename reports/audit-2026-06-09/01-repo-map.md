# RAE Fantasy Football Dashboard — Repo Map
**Audit date:** 2026-06-09  
**Branch:** audit/2026-06-09 (identical to origin/main @ 0a5ac58)  
**Auditor:** repo_mapper worker

---

## 1. Directory Inventory

| Area | Path | ~Files | Description |
|------|------|--------|-------------|
| App routes | `src/app/` | 37 ts/tsx | Next.js App Router pages, API routes, layout, providers, globals |
| Components | `src/components/` | 61 ts/tsx | UI components split into sub-folders (see §1a) |
| Lib | `src/lib/` | ~75 source ts (+ 54 test files) | All business logic, adapters, models, utilities |
| DB | `src/db/` | 4 source ts (+ 3 test files) | Drizzle schema (SQLite + Postgres variants), snapshot store, index |
| Hooks | `src/hooks/` | 1 | `use-mobile.ts` — responsive breakpoint hook |
| Scripts | `scripts/` | 1 | `brier-backtest.ts` — manual Brier score calibration runner |
| E2E | `e2e/` | 10 spec files | Playwright + axe spec files |
| Docs | `docs/` | ~8 md | `account-isolation.md`, `brier-results.md`, `calibration.md`, `data-source-map.md`, `data-sources.md`, `season-sim.md`, `trade-calibration.md`, plus `superpowers/` subfolder |
| Reports | `reports/` | ~15 files | Audit reports, gate output files, design tokens, workflow summaries |
| GitHub CI | `.github/workflows/` | 1 | `ci.yml` — typecheck + lint + vitest + playwright + lighthouse on ubuntu/Node 20 |

### 1a. Components Sub-tree

| Sub-folder | Key files |
|-----------|-----------|
| `components/app/` | `RouteView.tsx`, `ReportsView.tsx` — top-level view wrappers per route |
| `components/panels/` | 8 panel components (`DraftIntelligence`, `MarketIntelligence`, `NarrativeEngine`, `NexusSimulator`, `PlayerUniverse`, `PreDraftAudit`, `TradeCenter`, `WaiverWire`) + `sections/` (RosterHealth, TeamConstruction, TeamSignals) + `trade/` (RecentLeagueTrades, TradeBuilder) |
| `components/shell/` | `AppShell.tsx`, `GovernanceBanner.tsx`, `MobileBottomNav.tsx`, `PanelGrid.tsx`, `RouteSidebar.tsx`, `TopCommandBar.tsx`, `navItems.ts` |
| `components/charts/` | `BarChart.tsx`, `DonutChart.tsx`, `Heatmap2D.tsx`, `RadarChart.tsx`, `ReliabilityDiagram.tsx` |
| `components/governance/` | `AssumptionsDrawer.tsx`, `AuditInfoTooltip.tsx`, `DataLineagePopover.tsx`, `GovernancePanel.tsx`, `ModeBanner.tsx`, `SourceFreshnessBadge.tsx` |
| `components/dashboard/` | `LeagueHealth.tsx`, `LeaguePulse.tsx`, `NextBestActionPanel.tsx`, `SeasonNotice.tsx`, `TopInsights.tsx` |
| `components/topbar/` | `DemoBanner.tsx`, `LeagueSwitcher.tsx`, `UserMenu.tsx` |
| `components/ui/` | `BackToDashboard.tsx`, `DataUnavailable.tsx`, `PanelCard.tsx`, `PanelTabs.tsx` + shadcn primitives (badge, button, card, dropdown-menu, input, separator, sheet, sidebar, skeleton, tabs, tooltip) |

---

## 2. Route Inventory

### Page Routes (12 total)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `src/app/page.tsx` | Onboarding landing — redirects authenticated users to `/dashboard`, shows `Onboarding` component |
| `/login` | `src/app/login/page.tsx` | Email/password login form with `LoginForm` |
| `/mock-draft` | `src/app/mock-draft/page.tsx` | Standalone mock draft simulator using FantasyPros rankings |
| `/(app)/dashboard` | `src/app/(app)/dashboard/page.tsx` | Tiled overview dashboard — loads envelope, renders `RouteView` |
| `/(app)/players` | `src/app/(app)/players/page.tsx` | Player universe — all players, snap/opportunity data |
| `/(app)/analytics` | `src/app/(app)/analytics/page.tsx` | Analytics — season sim, Nexus, heatmaps, outcome probability |
| `/(app)/draft` | `src/app/(app)/draft/page.tsx` | Draft intelligence — tiers, recommendations, pre-draft audit |
| `/(app)/waivers` | `src/app/(app)/waivers/page.tsx` | Waiver wire — trending players, opportunity-based adds |
| `/(app)/trades` | `src/app/(app)/trades/page.tsx` | Trade center — evaluator, KTC/DynastyProcess values |
| `/(app)/reports` | `src/app/(app)/reports/page.tsx` | Reports — `ReportsView` (narrative engine, backtest summaries) |
| `/(app)/settings/account` | `src/app/(app)/settings/account/page.tsx` | Account settings — password change, session management |
| `/(app)/settings/leagues` | `src/app/(app)/settings/leagues/page.tsx` | League management — add/remove Sleeper/ESPN leagues, credentials |

### API Routes (12 total)

| Route | File | Purpose |
|-------|------|---------|
| `POST /api/admin/init-db` | `route.ts` | One-shot DB initializer; gated by `DB_INIT_TOKEN` |
| `GET/POST /api/auth/[...nextauth]` | `route.ts` | NextAuth v5 credential auth handler |
| `POST /api/cron/ktc-refresh` | `route.ts` | Cron: scrape KTC dynasty trade values; gated by `CRON_SECRET` |
| `POST /api/cron/lifecycle-check` | `route.ts` | Cron: evaluate waiver/injury lifecycle rules; emit notifications |
| `POST /api/cron/news-refresh` | `route.ts` | Cron: fetch ESPN player news snapshots |
| `POST /api/cron/opportunity-refresh` | `route.ts` | Cron: fetch nflverse snap/opportunity data |
| `POST /api/cron/players-refresh` | `route.ts` | Cron: refresh Sleeper player map snapshot |
| `POST /api/cron/projections-refresh` | `route.ts` | Cron: fetch Sleeper weekly projections snapshot |
| `POST /api/cron/rankings-refresh` | `route.ts` | Cron: scrape FantasyPros ECR rankings |
| `GET /api/health` | `route.ts` | Healthcheck: DB connectivity + row counts |
| `POST /api/leagues/[id]/refresh` | `route.ts` | Per-user league live-data refresh (Sleeper/ESPN) |
| `GET/DELETE /api/notifications` | `route.ts` | List and dismiss per-user lifecycle notifications |

---

## 3. Scripts

### package.json scripts

| Script | Command |
|--------|---------|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `eslint .` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `e2e` | `playwright test` |
| `e2e:install` | `playwright install --with-deps chromium` |
| `lighthouse` | `lhci autorun` |
| `deploy` | `next build` |

### scripts/ folder

| File | Purpose |
|------|---------|
| `scripts/brier-backtest.ts` | Manual runner for Brier score backtest against historical projections; results written to `reports/brier-backtest*.txt` |

---

## 4. Config Files

| File | Purpose |
|------|---------|
| `next.config.mjs` | Minimal Next.js config; disables `X-Powered-By`; allowlists `sleepercdn.com` + `a.espncdn.com` for `next/image`; `experimental: {}` (empty) |
| `tsconfig.json` | Target ES2022; strict mode; `@/*` alias to `./src/*`; `moduleResolution: bundler`; incremental builds |
| `drizzle.config.ts` | SQLite dialect; schema `./src/db/schema.ts`; output `./drizzle`; DB URL defaults to `file:.data/rae.sqlite` |
| `vitest.config.ts` | `environment: node`; includes `src/**/*.test.ts` only; `pool: forks`; `testTimeout: 20_000ms` |
| `playwright.config.ts` | `testDir: ./e2e`; single worker; chromium + mobile-chrome projects; webServer launches `npm run start`; per-CI timeout 45s / local 90s |
| `lighthouserc.json` | Runs on `/` and `/login`; perf ≥0.70 (warn), a11y ≥0.90 (error), best-practices ≥0.85 (warn), seo ≥0.85 (warn) |
| `eslint.config.mjs` | Standard Next.js ESLint config |
| `postcss.config.mjs` | `@tailwindcss/postcss` plugin |
| `tailwindcss` | v4.3.0; no separate `tailwind.config.ts` (config via CSS `@theme`) |
| `components.json` | shadcn/ui component config |
| `vercel.ts` | Vercel config source (not `vercel.json`); type-checked via `@vercel/config` |
| `.github/workflows/ci.yml` | 3-job CI: quality (typecheck+lint+vitest), e2e (playwright), lighthouse; Node 20, ubuntu-latest; triggers on push/PR to main |

---

## 5. Environment Variables

All 15 distinct `process.env.*` references found in `src/`:

| Variable | Used In | Required / Optional |
|----------|---------|---------------------|
| `AUTH_SECRET` | `src/lib/auth.ts` (NextAuth) | **Required** — app won't authenticate without it |
| `CREDENTIAL_ENCRYPTION_KEY` | `src/lib/crypto.ts` | **Required** — encrypts stored ESPN credentials |
| `CRON_SECRET` | All `src/app/api/cron/*/route.ts` | **Required** in prod — gates all cron endpoints via `safeEqual` |
| `DATABASE_URL` | `src/db/index.ts`, `drizzle.config.ts` | Optional — defaults to `file:.data/rae.sqlite` |
| `DB_INIT_TOKEN` | `src/app/api/admin/init-db/route.ts` | Optional — gates one-shot DB init endpoint |
| `ESPN_LEAGUE_ID` | `src/lib/espn.ts` | Optional — ESPN private league ID |
| `ESPN_S2` | `src/lib/espn.ts` | Optional — ESPN `espn_s2` session cookie |
| `ESPN_SEASON` | `src/lib/espn.ts` | Optional — ESPN season year |
| `ESPN_SWID` | `src/lib/espn.ts` | Optional — ESPN `SWID` cookie |
| `NODE_ENV` | Various — standard Next.js usage | Set by runtime |
| `RAE_ALLOW_FIXTURES` | `src/lib/fixtures.ts`, `src/lib/envelope/load.ts` | Optional — enables fixture/demo data mode |
| `RAE_ENABLE_LIVE_HOMEPAGE` | `src/app/page.tsx` or onboarding | Optional — feature flag for live homepage mode |
| `RAE_LIVE_SLEEPER_LEAGUE_ID` | `src/lib/sleeper.live.test.ts` | Optional — gating live integration tests |
| `RAE_LIVE_SLEEPER_USERNAME` | `src/lib/sleeper.live.test.ts` | Optional — gating live integration tests |
| `RAE_LIVE_TESTS` | `src/lib/sleeper.live.test.ts`, `src/lib/leagues/integration.live.test.ts` | Optional — enables live network tests (`RAE_LIVE_TESTS=1`) |

No secret values are present in source. All ESPN credential vars are stored encrypted in DB and loaded at runtime.

---

## 6. DB / Migrations

**No `drizzle/` migrations folder exists** (not yet generated; schema managed via `db push` or `init-db` API endpoint).

| File | Description |
|------|-------------|
| `src/db/schema.ts` | Primary SQLite schema: `users`, `accounts`, `sessions`, `verificationTokens`, `leagues`, `players_snapshot`, `rankings_snapshot`, `projections_snapshot`, `ktc_snapshot`, `news_snapshot`, `opportunity_snapshot`, `notifications`, `league_snapshots` |
| `src/db/schema-pg.ts` | Postgres-compatible variant (used by `init-db` API on Vercel/Neon) |
| `src/db/index.ts` | `getDb()` / `getDriver()` — runtime DB driver selection (SQLite vs Postgres based on `DATABASE_URL`) |
| `src/db/snapshotStore.ts` | Generic snapshot insert/prune helpers shared by all cron routes |
| `src/db/schemaDrift.test.ts` | Verifies SQLite and Postgres schemas stay in sync |
| `src/db/schemaPg.test.ts` | Validates Postgres schema structure |
| `src/db/snapshotStore.test.ts` | Unit tests for snapshot store helpers |

---

## 7. Dependencies

### Notable runtime dependencies

| Package | Version | Flag |
|---------|---------|------|
| `next` | `latest` | **Unpinned** — floats to latest Next.js; risk of surprise breaking changes |
| `react` | `latest` | **Unpinned** — floats to latest React |
| `react-dom` | `latest` | **Unpinned** |
| `framer-motion` | `latest` | **Unpinned** |
| `clsx` | `latest` | **Unpinned** |
| `zod` | `latest` | **Unpinned** |
| `better-sqlite3` | `^12.10.0` | Native module — requires platform-specific prebuilt; blocks Node 20 local build on Windows (no MSVC prebuilt for node-v115) |
| `next-auth` | `^5.0.0-beta.31` | **Beta** — NextAuth v5 is still in beta as of this audit |
| `@next/env` | `latest` | **Unpinned** |
| `postgres` | `^3.4.9` | Postgres client for Neon/Vercel Postgres deployment |

### Notable devDependencies

| Package | Version | Flag |
|---------|---------|------|
| `eslint` | `latest` | **Unpinned** |
| `typescript` | `latest` | **Unpinned** |
| `vitest` | `latest` | **Unpinned** |
| `@types/react` | `latest` | **Unpinned** |
| `@testing-library/react` | `latest` | **Unpinned** |
| `@testing-library/jest-dom` | `latest` | **Unpinned** |
| `@lhci/cli` | `^0.15.1` | Lighthouse CI |
| `@playwright/test` | `^1.60.0` | Pinned minor |
| `@axe-core/playwright` | `^4.11.3` | Axe a11y testing in e2e |

**Summary:** ~10 packages use `latest` with no upper bound. `better-sqlite3` is a native module requiring careful node version management. `next-auth@beta.31` is pre-stable.

---

## 8. Branch & Commit Map

### All branches — ahead/behind origin/main

| Branch | Last Commit | Ahead | Behind | Status / Purpose |
|--------|-------------|-------|--------|-----------------|
| `origin/main` | 2026-06-08 | 0 | 0 | Production HEAD @ 0a5ac58 (PR #15 merge) |
| `audit/2026-06-09` | 2026-06-08 | 0 | 0 | Current audit branch; identical to origin/main |
| `ui/tab-polish` | 2026-06-08 | 1 | 0 | **Merged via PR #15** — tab system elevation + favicon/SVG fixes; safe to delete |
| `final-sprint-draft-tabs-heatmap` | 2026-06-08 | 9 | 0 | **Behind** — long-running feature branch; PRs #8–#14 merged from it; 9 commits not in main (docs/plan commits); effectively stale |
| `main` (local) | 2026-06-03 | 29 | 0 | Local `main` lags `origin/main` by 29 commits — **stale local tracking branch** |
| `opus48-reverification` | 2026-05-30 | 65 | 0 | Sprint 4 reverification work; 65 commits behind origin/main — **stale** |
| `redesign/pro-sports-analytics` | 2026-05-23 | 107 | 0 | Pro-sports visual redesign spike; 107 commits behind — **stale** |
| `fix/mobile-viz-and-desktop-layout` | 2026-05-21 | 128 | 0 | Mobile/desktop layout fixes; 128 commits behind — **stale** |
| `feature/trade-value-simulator` | 2026-05-21 | 131 | 0 | Trade value simulator feature; 131 commits behind — **stale** |
| `origin/claude/redesign-output-dashboard-Homgq` | 2026-05-17 | 4 | 159 | Claude-generated redesign; 159 commits behind + 4 unique — **stale** |
| `origin/codex/inspect-repository-and-enter-plan-mode` | 2026-05-13 | 0 | 164 | Codex inspection branch; 164 commits behind — **stale** |
| `origin/codex/inspect-repository-and-enter-plan-mode-a6arz2` | 2026-05-13 | 0 | 161 | Codex inspection variant; 161 commits behind — **stale** |

**Stale branches (≥60 commits behind, no recent activity):** `opus48-reverification`, `redesign/pro-sports-analytics`, `fix/mobile-viz-and-desktop-layout`, `feature/trade-value-simulator`, both `codex/` remote branches, `origin/claude/redesign-output-dashboard-Homgq`. All are candidates for deletion.

### Last 30 commits on origin/main (condensed)

| Hash | Message |
|------|---------|
| 0a5ac58 | Merge pull request #15 from jviola1019/ui/tab-polish |
| ba9f26e | feat(ui): elevate both tab systems; fix favicon + svg console errors |
| 62a3735 | Merge pull request #14 from jviola1019/final-sprint-draft-tabs-heatmap |
| 6f50ea5 | docs(tasks): file optional external-adapter circuit-breaker follow-up |
| 016fca5 | perf: self-host fonts and guard against external font imports |
| 0d8d16e | Merge pull request #13 from jviola1019/final-sprint-draft-tabs-heatmap |
| 7a939bf | fix(nav)+docs: sequential mobile bottom-nav numbering; refresh data-source-map |
| a82d901 | Merge pull request #12 from jviola1019/final-sprint-draft-tabs-heatmap |
| 2f95ecb | docs: README test count 439 + accurate live-spec wording; historical banners |
| da60929 | polish: mock-draft source strip, sidebar string, remove dead LineChart |
| da21a81 | feat(dashboard): tiled overview; re-home CommandCenter sections |
| a19bca2 | fix(sim): scenario comparison uses baseline's real league format |
| 2f4c446 | a11y: per-route sr-only h1 + chart text alternatives |
| b911cec | docs(plan): implementation plan for tiled /dashboard + audit fixes |
| d4d384e | docs(spec): tiled /dashboard overview + audit-driven a11y/sim/docs fixes |
| 4695a28 | Merge pull request #11 from jviola1019/final-sprint-draft-tabs-heatmap |
| 24af654 | fix(ia+continuity+docs): settings into shell, shared sim for MI Trends |
| f9facb6 | feat(governance+a11y): governance components, error boundary, tokens |
| ebe9728 | feat(ia): overview dashboard + /reports + next-best-actions |
| 61d2adc | Merge pull request #10 from jviola1019/final-sprint-draft-tabs-heatmap |
| 44e3c08 | feat(ia): multi-route app shell — onboarding home + per-route pages |
| bf844f7 | refactor(envelope): extract request-cached loadEnvelope() |
| 4c7e35b | style(tabs)+docs: roomier system tabs + CLAUDE.md guardrails |
| c66390e | fix(topbar+narrative): joined season pill, real market hype + outcome odds |
| 6c9b70a | Merge pull request #9 from jviola1019/final-sprint-draft-tabs-heatmap |
| 2169c5b | redesign(narrative+xray): Hype-vs-Value boards + status-driven X-Ray |
| d2c634b | feat(cc)+test(live): completed-season notice + Sleeper integration |
| fdb9ed9 | feat(market+cc): replace clustered heatmap with Value×Usage Board |
| 9c9a592 | feat+fix: remove panel/sidebar icons, show league season-year |
| 41e3d16 | Merge pull request #8 from jviola1019/final-sprint-draft-tabs-heatmap |

---

## 9. Test Inventory

### Unit Tests (54 files in `src/**/*.test.ts`)

| Area | Files |
|------|-------|
| DB | `schemaDrift.test.ts`, `schemaPg.test.ts`, `snapshotStore.test.ts` |
| App | `fonts.test.ts` |
| Lib core | `activeLeague.test.ts`, `crypto.test.ts`, `governance.test.ts`, `headshots.test.ts`, `leagues.test.ts`, `outcomeHeat.test.ts`, `panelState.test.ts`, `passwords.test.ts`, `seasonSim.test.ts`, `simulation.test.ts`, `simulation.calibration.test.ts`, `users.test.ts`, `utils.test.ts`, `visualContract.test.ts`, `derivedMetrics.stats.test.ts` |
| Auth | `auth/errors.test.ts` |
| Draft | `draft/recommend.test.ts`, `draft/tiers.test.ts` |
| ESPN | `espn.test.ts`, `espn.live.test.ts`, `espn/news.test.ts`, `espn/newsMatch.test.ts` |
| Sleeper | `sleeper.test.ts`, `sleeper.live.test.ts`, `sleeper/projections.test.ts`, `sleeper/snapshot.test.ts`, `sleeper/trendingProxy.test.ts` |
| KTC | `ktc/match.test.ts`, `ktc/scrape.test.ts` |
| Leagues | `leagues/buildUniverse.test.ts`, `leagues/draftState.test.ts`, `leagues/fetchLive.test.ts`, `leagues/fetchLive.espn.test.ts`, `leagues/integration.live.test.ts`, `leagues/mirrorLeague.test.ts`, `leagues/scoringPoints.test.ts` |
| Lifecycle | `lifecycle/byes.test.ts`, `lifecycle/notifications.test.ts` |
| nflverse | `nflverse/opportunity.test.ts` |
| Stats | `stats/brierBacktest.test.ts`, `stats/distribution.test.ts`, `stats/logistic.test.ts` |
| Trade | `trade/backtest.test.ts`, `trade/evaluate.test.ts`, `trade/format.test.ts`, `trade/transactions.test.ts`, `trade/values.test.ts`, `trade/values.live.test.ts`, `trade/verify.test.ts` |
| Weather | `weather/openmeteo.test.ts` |

**Live/integration tests** (skipped without gate vars): `sleeper.live.test.ts`, `espn.live.test.ts`, `leagues/integration.live.test.ts`, `leagues/fetchLive.espn.test.ts`, `trade/values.live.test.ts`

### E2E Tests (10 spec files in `e2e/`)

| File | Focus |
|------|-------|
| `01-dashboard.spec.ts` | Dashboard route smoke + panel render |
| `02-login.spec.ts` | Auth flow, login form |
| `03-a11y.spec.ts` | axe accessibility scans on key routes |
| `04-draft-and-lifecycle.spec.ts` | Draft intelligence + lifecycle check |
| `05-auth-flow.spec.ts` | Full auth flow (register/login/logout) |
| `07-no-shared-data.spec.ts` | Cross-user data isolation |
| `14-wrong-password-error.spec.ts` | Auth error handling |
| `15-sprint5-panels.spec.ts` | Sprint 5 nine-panel smoke tests |
| `16-topbar-nav.spec.ts` | Top command bar + navigation |
| `17-account-flows.spec.ts` | Account settings flows |

---

## Summary Counts

| Metric | Count |
|--------|-------|
| Page routes | 12 |
| API routes | 12 |
| Env vars referenced | 15 |
| Unit test files | 54 |
| E2E spec files | 10 |
| Local branches | 7 |
| Remote-only branches | 5 |
| Stale branches (≥60 behind) | 7 |
| Packages with `latest` pin | ~10 |
| Native modules | 1 (`better-sqlite3`) |
| Beta dependencies | 1 (`next-auth@5.0.0-beta.31`) |
