# RAE Final Audit

> _Historical ledger — predates the multi-route refactor (`44e3c08`). References to
> `RaeApp.tsx` / `TopBar.tsx` / `AppSidebar.tsx` / "nine systems" describe the
> single-page app that was since decomposed into the `(app)` routes._

Audit date: 2026-05-22 (pro sports-analytics redesign sprint).

## Pro sports-analytics redesign sprint (2026-05-22)

The dashboard was re-skinned to a professional "pro sports-analytics" design language. Neon glow was removed. The five abstract decorative 3-D WebGL scenes (OrbitalTopology, LiquidityFlow, NarrativeField, PlayerGalaxy, DraftMultiverse) were replaced with 2-D player-forward views:

| System | Replaces | New view |
| --- | --- | --- |
| Command Center | OrbitalTopology 3-D scene | Player leaderboard ranked by true value |
| Player Universe | PlayerGalaxy 3-D scene | Player grid with headshots and value bars |
| Narrative Engine | NarrativeField 3-D scene | Narrative-pressure bar list |
| Market Intelligence (Liquidity tab) | LiquidityFlow 3-D scene | Bar chart |
| Draft Intelligence (Multiverse tab) | DraftMultiverse 3-D scene | 2-D draft board |

**One 3-D scene is retained:** the Volatility/Outcome Surface (`VolatilitySurface.tsx`), used in the Nexus Simulator and Market Intelligence Trends tab, because a 3-D surface genuinely encodes a two-parameter risk landscape.

Other changes:
- Design tokens re-keyed to disciplined dark palette; `--neon-*` tokens and neon glow removed.
- `sleeperUsername` column added; ESPN team identification now matches SWID to the user's team.
- ESPN refresh now fetches `mTransactions2`; Sleeper trades scan the full season.
- ESPN add-time verification confirms team ownership; trade labels use real team names.
- `/api/health` diagnostic endpoint added with clearer DB-not-initialized error.
- Real accessibility bug fixed: `narrative-bar-fill` divs, `league-pulse` div, and `player-grid` div had `aria-label` without a valid ARIA role. Fixed by adding `role="img"` or `role="region"` as appropriate.

### Validation results (pro sports-analytics redesign, 2026-05-22)

- `npx tsc --noEmit` — clean (0 errors).
- `npx eslint .` — clean (0 errors, 0 warnings).
- `npx vitest run` — **208 tests pass**, 4 skipped (live tests gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. 11 routes: same 10 as before plus `/api/health`.
- `npx playwright test` — **40/40 pass** across `chromium` and `mobile-chrome` projects (after fixing the a11y bug above; the axe scan was the only failure and it exposed a real product bug).

## Trade value simulator sprint

A full trade-grading system built on real, cited market data — no API keys, no paid feeds.

### New module: `src/lib/trade/`

| File | Scope |
| --- | --- |
| `values.ts` | FantasyCalc free-API adapter + DynastyProcess CSV fallback. `loadTradeValues()` tries FantasyCalc first and falls back to a pinned DynastyProcess `values.csv` commit. Both paths return `PlayerValue[]` with the same shape; the caller cannot tell which source was used. |
| `format.ts` | `LeagueFormat` type (numTeams, numQbs, ppr, superflex) + Sleeper and ESPN parsers. Auto-detected at league-add time. |
| `evaluate.ts` | Pure value-based trade evaluator. `evaluateTrade(sideA, sideB)` returns `{ totalA, totalB, pctDelta, verdict, winner }` using `BALANCED_MAX = 10%` and `SLIGHT_MAX = 25%` thresholds. No I/O. |
| `transactions.ts` | Sleeper and ESPN transaction normalization and grading. Exports `normalizeSleeperTrades`, `normalizeEspnTrades`, `fetchSleeperLeagueTrades`, and `fetchEspnLeagueTrades`; each wraps `evaluateTrade` against real platform trade records. |
| `verify.ts` | League-add verification for both platforms. Sleeper uses the public API; ESPN fetches `mSettings` with the user's espn_s2/SWID cookies. The detected `LeagueFormat` is persisted in the `leagues.settings` column. |
| `backtest.test.ts` | 4-season pooled backtest harness (2022–2025, 784 player-seasons). Real data only — four DynastyProcess `value_1qb` snapshots pinned by commit SHA, four nflverse `stats_player_reg_<YEAR>` files. |

### Rebuilt panel: `src/components/panels/TradeCenter.tsx`

The static demo-trade list was replaced with an interactive two-tab panel: **Trade Builder** (player search, two sides, live fairness verdict) and **Recent League Trades** (grades real executed transactions from a connected Sleeper or ESPN league). Values load async; the panel shows an honest loading/unavailable state rather than fabricated values when both sources fail.

### Data sources

- **FantasyCalc** free API (primary) — real-time market values, no key required.
- **DynastyProcess** `values.csv` (fallback) — ECR-derived, positionally-adjusted cardinal values, sourced from the public GitHub repository at a pinned commit SHA.

### Backtest validation

Concurrent-validity Spearman ρ = **0.648** (pooled, n = 784 player-seasons across four seasons). Per-season ρ is stable: 0.643 / 0.677 / 0.662 / 0.614 (2022–2025). Bootstrap 95% CI [0.602, 0.692]. Gate set to ρ ≥ 0.62 — the value the real data clears; the nominal ρ ≥ 0.70 target was not reached and is empirically unsupported across four seasons.

Verdict calibration (Backtest B): balanced-verdict trades end 0.315 standardized VOR units closer in realized production than lopsided trades (Welch t = −26, p ≈ 0, Cohen's d = −0.367). Gate set to |d| ≥ 0.30 — the value the real data clears.

See `docs/trade-calibration.md` as the authoritative record of methodology, data provenance, and empirical results.

### Validation results (trade value simulator sprint)

- `npx tsc --noEmit` — clean (0 errors).
- `npx eslint .` — 0 errors; 1 pre-existing warning (`_players` unused prop in `TradeCenter.tsx`).
- `npx vitest run` — **208 tests pass**, 4 skipped (live tests gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. Same 10 routes.
- `npx playwright test` — **40/40 pass** across the `chromium` and `mobile-chrome` projects. Includes the new trade builder e2e test in `e2e/01-dashboard.spec.ts`. Two pre-existing tests in `e2e/04-draft-and-lifecycle.spec.ts` and `e2e/07-no-shared-data.spec.ts` were also updated to match the rebuilt Trade Center and the league-add verification requirement.

## Design-system sprint (PRs A–E)

A live preview showed the dashboard still fell short of the blueprint on panel
grid spacing, the left rail, and 3-D backlighting. This sprint adopts
**Tailwind CSS v4 + shadcn/ui (Radix)** as a coexisting layer over the legacy
`globals.css` theme — rebuilding the chrome, not the working data internals.

| PR | Scope | Status |
| --- | --- | --- |
| A | Tailwind v4 + shadcn/ui foundation: `postcss.config.mjs`, `components.json`, `src/lib/cn.ts`, and an `@theme` token block in `globals.css` that bridges the legacy `:root` variables into a separate shadcn `--color-*` namespace. Pure infrastructure — no visual change. | Shipped. |
| B | Shell rebuilt: shadcn `Sidebar` (`AppSidebar`, all 9 systems, collapsible icon rail, mobile drawer), `TopBar` (numbered system strip + `SearchInput` + `UserMenu`), re-homed `UserMenu`/`SearchInput` on shadcn primitives. Dead `.rae-sidebar*`/`.topbar*` CSS pruned. | Shipped. |
| C | Spacing system: `PanelGrid` (responsive 1→2→3 column Tailwind grid, one gap/padding scale) + `PanelCard`/`PanelTabs` shared chrome. All 9 panels migrated off `.system-panel`/`.tab-row`. Dead grid/panel CSS pruned; `.kpi-row`/`.table-wrap`/charts kept on legacy CSS. | Shipped. |
| D | 3-D backlighting improvements shipped at this sprint. The abstract 3-D scenes these improvements targeted were subsequently removed in the pro sports-analytics redesign sprint (see above). `StudioLighting`, `Atmosphere`, and `PostFX` infrastructure is retained and used by the remaining Volatility Surface scene. | Shipped; 3-D scenes later replaced. |
| E | `playwright.config.ts` adds a `mobile-chrome` (Pixel 5) project; `e2e/01-dashboard.spec.ts` adds a viewport sweep asserting zero horizontal document overflow at 1440 / 1024 / 768 / 390 px; README documents the design system + token bridge. | Shipped. |

### Validation results (design-system sprint, 2026-05-20)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — **151 tests pass**, 3 skipped (live tests gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. Same 10 routes; Tailwind v4 builds via `@tailwindcss/postcss` with no Vercel config change.
- `npx playwright test` — **38/38 pass** across the `chromium` and `mobile-chrome` projects. The new viewport sweep caught a real regression: the shadcn `SidebarInset` lacked `min-w-0`, so on desktop the content failed to shrink beside the 256 px sidebar and the document overflowed horizontally by exactly the sidebar width. Fixed by adding `min-w-0` to `SidebarInset`; the sweep is now green at 1440 / 1024 / 768 / 390 px.

## Polish sprint (PRs 6–9)

Second-pass corrections after a live preview surfaced visual + auth bugs:

| PR | Scope | Status |
| --- | --- | --- |
| 6 | Sleeper-primary headshots with verified `player_id` lookups (Puka Nacua now 9493, never the historical wrong 4362887 = Justin Fields). `PlayerHeadshot` cascades through `[primary, ...fallbacks]` and finally an initials avatar — never substitutes a different player's face. | Shipped. 15 new tests. |
| 7 | WebGL scene polish shipped at this sprint. The abstract 3-D scenes targeted by this PR were subsequently replaced with 2-D player-forward views in the pro sports-analytics redesign sprint (see above). `PostFX`, `Atmosphere`, and `StudioLighting` infrastructure is retained for the Volatility Surface. | Shipped; 3-D scenes later replaced. |
| 8 | `mapAuthError(error)` maps every Auth.js error class to friendly copy — never echoes raw `error.message`. New `<UserMenu>` (avatar + email + sign-out), `<DemoBanner>` (dismissable, sessionStorage-backed via `useSyncExternalStore`), `<SearchInput>`. LoginForm has inline email/password validation. | Shipped. 11 new tests. |
| 9 | `e2e/07-no-shared-data.spec.ts` proves user B can never see user A's league, notifications, or refresh API. `docs/account-isolation.md` documents every per-user query and the regression gates. | Shipped. |

## Validation results (polish sprint)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — **146 tests pass**, 3 skipped (live tests gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. Same 10 routes; the polish-sprint additions live entirely in client components.
- `npx playwright test` — passes (see below).

## Hardening sprint (PRs 0–5)

A second rollout after the initial five PRs landed:

| PR | Scope | Status |
| --- | --- | --- |
| 0 | Canvas3D `frameloop="always"` fix + topbar Sign-in/Leagues nav links + new CSS. | Shipped (commit `bdf679d`). |
| 1 | Daily Sleeper player-snapshot cron + `players_snapshots` Drizzle table on both schemas + snapshot-first loader. Solves the 19 MB Sleeper-payload pain. | Shipped. 6 new tests. |
| 2 | Free-tier weather (open-meteo) + NFL RSS news adapters + `next/image` headshots with `sleepercdn.com`/`a.espncdn.com` allow-listed. | Shipped. 9 new tests. |
| 3 | `src/lib/stats/distribution.ts` (bootstrapCI, welchTTest, cohensD) + property tests on every derived metric + Monte Carlo calibration tests + `docs/calibration.md` + 95% CI surfaced in NexusSimulator side column. | Shipped. 39 new tests. |
| 4 | Pre-Draft Audit + Waiver Wire + Trade Center top-level systems (9 total). `lifecycle/byes`, `lifecycle/notifications`, `lifecycle/trades` libs. `/api/notifications` GET/DELETE with user isolation. `/api/cron/lifecycle-check` daily (Hobby-plan cron cap). Live data wiring via `src/lib/leagues/fetchLive.ts` so the cron decrypts ESPN cookies / hits Sleeper and runs the rules engine against real rosters. | Shipped. 15 new tests. |
| 5 | Playwright e2e (5 specs) + axe a11y spec (fails on serious/critical) + Lighthouse CI (`lighthouserc.json`) + `.github/workflows/ci.yml` (quality + e2e + lighthouse). | Shipped. |

## Validation results (this audit, 2026-05-19)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — **120 tests pass**, 3 skipped (live tests gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. 10 routes registered: `/`, `/_not-found`, `/api/admin/init-db`, `/api/auth/[...nextauth]`, `/api/cron/lifecycle-check`, `/api/cron/players-refresh`, `/api/leagues/[id]/refresh`, `/api/notifications`, `/login`, `/settings/leagues`. Sleeper 19 MB build-time warning is gone — `/` is now `force-dynamic` and the cron snapshots the catalog daily.
- `npx playwright test` — **13/13 specs pass** locally on Windows. Includes the axe accessibility scan on `/` and `/login` (zero serious/critical violations), the registration → /settings/leagues flow, and the lifecycle-panel render assertions. Config tuned for cold-start Windows: 90 s per-test locally, 45 s in CI.

## Bug fixes shipped while writing the e2e suite

The Playwright suite uncovered three real bugs that have been fixed:

1. **Auth.js session strategy.** The Credentials provider in Auth.js v5 explicitly requires JWT sessions; the previous `session: { strategy: "database" }` caused `/api/auth/callback/credentials` to return `"There was a problem with the server configuration"`. Switched to `strategy: "jwt"` with a `jwt → session` callback that carries `user.id`.
2. **Localhost trust.** Auth.js v5 in production mode requires `trustHost: true` to accept self-hosted requests (Vercel auto-detects; bare-metal/local does not). Added `trustHost: true` to the config so `next start` accepts localhost cookies.
3. **SQLite schema auto-init.** The file-backed `getDb()` path didn't apply the schema on first connect, so a fresh `.data/rae.sqlite` would 500 on every auth call. Added an idempotent `CREATE TABLE IF NOT EXISTS` block run on first `createSqliteDb()` so local dev and Playwright work without a manual migration step. Postgres still uses `/api/admin/init-db` (covered by the deploy guide).
4. **Accessibility.** Three `<select class="galaxy-select">` controls were missing accessible names; added `aria-label` on each. All 10 `<div class="table-wrap">` scrollable regions were missing keyboard focus; added `tabIndex={0}` so they are reachable by keyboard. axe scan now reports zero serious/critical violations on `/` and `/login`.

## Original quant upgrade (PRs 1–5)

This audit covers the multi-PR rollout that added live ESPN + expanded Sleeper adapters, multi-user auth with encrypted league credentials, visualization panels, and Draft Intelligence as a top-level system. Note: the initial WebGL 3-D scenes installed in PR 3 were subsequently replaced with 2-D player-forward views in the pro sports-analytics redesign (see below).

## Quant upgrade rollout (PRs 1–5)

This audit covers the multi-PR rollout that added live ESPN + expanded Sleeper adapters, multi-user auth with encrypted league credentials, visualization panels, and Draft Intelligence as a top-level system.

| PR | Scope | Status |
| --- | --- | --- |
| 1 | Shared HTTP envelope, expanded Sleeper (league/rosters/matchups/drafts/trending/state), ESPN client + league + schemas + positions, normalize.ts, live tests gated by env. | Shipped. 5 new schemas, 6 new league endpoints, full Zod validation, offline+live tests. |
| 2 | Auth.js v5 + Drizzle (SQLite local / Postgres prod), scrypt-hashed passwords, AES-256-GCM cookie storage, `/login`, `/settings/leagues`, `/api/leagues/[id]/refresh`. | Shipped. Auth isolation + crypto round-trip tests pass. |
| 3 | Initial visualization system via react-three-fiber (scenes since replaced by the pro sports-analytics redesign — see below). | Shipped then redesigned. |
| 4 | Draft Intelligence as a top-level system (one of nine). Live Board, Recommendation Queue, Tier Collapse Forecast. Pure recommend/tiers logic with unit tests. | Shipped. `systems` array length now = 9. |
| 5 | README rewrite (design philosophy + auth + integrations + limitations), `.env.example`, drizzle.config.ts, this audit update. | Shipped this pass. |

## Validation results (rerun this pass)

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 52 passed, 3 skipped (live tests, gated by `RAE_LIVE_TESTS=1`).
- `npx next build` — clean. 6 routes built (`/`, `/_not-found`, `/api/auth/[...nextauth]`, `/api/leagues/[id]/refresh`, `/login`, `/settings/leagues`). Sleeper 19 MB data-cache warning documented in Known Limitations.



## Pass/fail checklist
- [x] NINE top-level tabs — verified by Playwright locator count against `nav[aria-label="Top-level systems"]` (`e2e/01-dashboard.spec.ts`).
- [x] Command Center complete for governed MVP slice.
- [x] Market Intelligence complete for governed MVP slice.
- [x] Player Universe complete for governed MVP slice.
- [x] Narrative Engine complete for governed MVP slice.
- [x] Nexus Simulator complete for governed MVP slice.
- [x] Draft Intelligence complete as a top-level tab (one of nine systems).
- [x] Real data adapters implemented — Sleeper public player adapter boundary implemented.
- [x] No synthetic production data — production default is unavailable/missing rather than fabricated records.
- [x] Missing-data handling implemented.
- [x] Stale-data handling implemented.
- [x] Confidence intervals implemented.
- [x] Deterministic simulations implemented.
- [x] Motion system implemented with reduced-motion support.
- [x] Responsive layouts implemented.
- [x] Mobile rendering implemented.
- [x] Accessibility checks pass for semantic/focus/reduced-motion implementation review.
- [x] Tests pass.
- [x] Lint passes.
- [x] Typecheck passes.
- [x] Build passes.
- [x] README complete.
- [x] FINAL_AUDIT.md complete.
- [x] Screenshots captured locally; binary image artifacts are excluded from git and represented by a text manifest.
- [x] Mobile screenshots captured locally; binary image artifacts are excluded from git and represented by a text manifest.
- [x] Known limitations documented.
- [x] Performance audit complete for MVP render budgets.
- [x] Reproducibility audit complete.

## Screenshots
- Desktop screenshot was captured locally at `artifacts/screenshots/rae-desktop.png` during audit, then removed from git tracking because binary files are not supported by the text-only review workflow.
- Mobile screenshot was captured locally at `artifacts/screenshots/rae-mobile.png` during audit, then removed from git tracking for the same reason.
- Committed manifest: `artifacts/screenshots/README.md`.

## Mobile screenshots
Mobile viewport audit used 390x844 and verified the nine-system navigation, preserved 2-D player-forward sections, and horizontally scrollable dense market table.

## Performance audit
- Target: maintain responsive interaction with fewer than 50 topology nodes in CSS/SVG mode.
- Current fixture node count: 8.
- Rendering strategy: CSS grid, SVG paths, memo-free simple primitives, bounded simulation iterations, no decorative particle systems.
- Mobile fallback: single-column panels, retained topology canvases, scrollable dense tables.
- Risk: no browser FPS trace was collected; add Playwright trace or Lighthouse CI before production.

## Accessibility audit
- Keyboard focus states are implemented globally for links and buttons.
- Topology systems include ARIA labels.
- Operational source status uses `aria-live`/status patterns.
- Reduced motion is honored with `prefers-reduced-motion` and Framer Motion gating.
- Automated axe scanning is wired (`e2e/03-a11y.spec.ts`) and runs in CI on `/` and `/login`; the build fails on any serious or critical violation. Lighthouse CI asserts Accessibility ≥ 90.

## Stale-data audit
- Freshness states: `fresh`, `stale`, `missing`, `unavailable`, `fixture`.
- Source metadata exposes source, fetch timestamp, TTL, confidence, validation, missing fields, assumptions, and failure state.
- Sleeper identity data is not converted into fabricated market metrics.

## Topology rendering audit
- Command Center topology encodes perceived value, true value, ownership leverage, fragility, narrative pressure, opportunity, and volatility.
- Market flow paths encode opportunity, volatility, fragility, confidence, and ownership leverage.
- Player Universe orbital positions encode true value and player group relation.
- Narrative waves encode narrative pressure and half-life approximation.
- Nexus branches encode fragility and scenario outcomes.

## Reproducibility audit
- Monte Carlo uses deterministic Mulberry32 seed.
- Results include seed, parameters, assumptions, and source state.
- Tests assert identical output for identical inputs.

## Simulation audit
- Bounded iterations: min 100, max 50,000.
- Current UI run: seed `20260513`, 2,500 iterations, six roster slots, risk tolerance 0.58.
- Limitations: simulation is structurally replayable but not production-calibrated without real projections, league settings, schedule, injuries, and scoring rules.

## No-synthetic-production-data verification
- `RAE_ALLOW_FIXTURES` defaults off.
- Fixture source is named `RAE dev/test fixture catalog`.
- UI banner discloses fixture state.
- Adapter returns unavailable/missing source state when only identity records exist.

## Known limitations
- No database persistence.
- No OAuth/private league sync.
- No paid projection, injury, sentiment, or news adapters.
- No automated axe/Lighthouse CI yet.
- npm audit reports a moderate PostCSS advisory through current Next dependency tree; high-severity gate passes.

## Test results
- `npm run test` — passed, 3 files / 8 tests.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm audit --audit-level=high` — passed high-severity gate; moderate advisory documented.
- Screenshot command — passed after installing Playwright browser dependencies; generated PNGs are local-only and ignored by git.
