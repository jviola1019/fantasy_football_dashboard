# RAE Task Board

## Phase 1 — Foundation
- [x] Inspect repository and detect stack.
- [x] Scaffold Next.js + TypeScript application.
- [x] Establish institutional visual system.
- [x] Enforce five top-level navigation systems.

## Phase 2 — Data governance
- [x] Define source metadata, freshness, confidence, missingness, and stale states.
- [x] Add Zod validation for data envelopes and player records.
- [x] Implement Sleeper adapter boundary with bounded caching contract.
- [x] Ensure fixture data is explicitly labeled and never presented as live production data.

## Phase 3 — Simulation
- [x] Add deterministic seeded simulation engine.
- [x] Log assumptions, seed, parameters, confidence, and reproducibility metadata.
- [x] Add deterministic replay tests.

## Phase 4 — Product systems
- [x] Command Center.
- [x] Market Intelligence.
- [x] Player Universe.
- [x] Narrative Engine.
- [x] Nexus Simulator.
- [x] Contextual Draft Intelligence.

## Phase 5 — Validation and docs
- [x] README complete.
- [x] FINAL_AUDIT complete.
- [x] Unit/schema/stale/missing/determinism tests pass.
- [x] Lint passes.
- [x] Typecheck passes.
- [x] Build passes.
- [x] Desktop screenshot captured locally and excluded from git as a binary artifact.
- [x] Mobile screenshot captured locally and excluded from git as a binary artifact.
- [x] npm audit high-severity gate passes; moderate advisory remains upstream in Next/PostCSS.

## Phase 6 — Quant upgrade (PRs 1–5)
- [x] PR 1 — shared HTTP envelope, expanded Sleeper, ESPN client + league + schemas, normalize.ts, live tests gated by env.
- [x] PR 2 — Auth.js v5 + Drizzle + SQLite/Postgres schema, hashed passwords, AES-256-GCM cookie storage, `/login`, `/settings/leagues`, `/api/leagues/[id]/refresh`.
- [x] PR 3 — react-three-fiber Canvas3D + scenes (OrbitalTopology, LiquidityFlow, VolatilitySurface, PlayerGalaxy, NarrativeField) wired into all five core panels.
- [x] PR 4 — Draft Intelligence as sixth top-level system (Live Board, Recommendation Queue, Tier Collapse, 3-D Multiverse) with pure recommend/tiers unit tests.
- [x] PR 5 — README rewrite, .env.example, drizzle.config.ts, FINAL_AUDIT update.

## Phase 7 — Hardening sprint (PRs 0–5, shipped)
- [x] Cron-backed daily Sleeper players-snapshot pipeline (`/api/cron/players-refresh` → Postgres `players_snapshots`).
- [x] Free-tier weather (open-meteo) + NFL RSS news adapters; `next/image` headshots.
- [x] Statistical validation of every derived metric + Monte Carlo calibration plan (`docs/calibration.md`).
- [x] Season lifecycle: Pre-Draft Audit + Waiver Wire + Trade Center panels; lifecycle cron + notifications.
- [x] Playwright e2e suite + GitHub Actions CI + axe a11y + Lighthouse CI.

## Phase 8 — Polish sprint (PRs 6–9, shipped)
- [x] PR 6 — Sleeper-primary headshots, verified player ids, wrong-id regression fixed + tested.
- [x] PR 7 — Blueprint-grade WebGL: bloom + Environment + atmosphere + custom flow/surface shaders + in-scene headshot billboards; overflow-clip removed.
- [x] PR 8 — Friendly auth-error map, signed-in UserMenu + sign-out, DemoBanner, inline login validation.
- [x] PR 9 — Per-account isolation e2e gate + `docs/account-isolation.md`.

## Phase 9 — Real season Monte Carlo + honesty/UX pass (shipped)
- [x] Replaced the uncalibrated Nexus heuristic with a real **season Monte Carlo** (`src/lib/seasonSim.ts`): round-robin schedule, sampled weekly matchups, re-seeded single-elimination bracket with byes. Calibration contract enforced by tests (avg roster ≈ playoffTeams/numTeams, monotonic, favorite-variance, live-projection-driven).
- [x] Outcome heatmaps (Nexus + Market Intelligence) now render the real **joint wins × playoff-outcome distribution** (`src/lib/outcomeHeat.ts`, grid sums to 100%), replacing the dead-flat risk-tolerance sweep.
- [x] Mock-draft draft pool plumbed to the **full FantasyPros consensus** (`draftPool` on the envelope) so any player — including incoming rookies — can be drafted.
- [x] FAAB-ratio extraction from Sleeper league settings (`extractSleeperFaabRatio`); the FAAB-depleted lifecycle rule is live end-to-end.
- [x] Sleeper team identity captured at league-add time (optional **Sleeper username** field → `resolveSleeperRosterId`); the cron/envelope score the user's actual roster.
- [x] Tab systems modernized (sliding-underline TopBar nav + segmented PanelTabs, Framer Motion `useReducedMotion`); security hardening (timing-safe token checks, sanitized add-league errors).

## Phase 10 — Sprint 5: league-universe data model, model accuracy & total QA (shipped)
See `SPRINT5.md` for the plan and `reports/audit-sprint5.md` for the ledger.
- [x] **Season-mirror data model** (`draftState.ts`, `mirrorLeague.ts`, `buildUniverse.ts`): import a league → completed season + an empty-roster upcoming mirror; rosters refresh on every account load so a finished draft flips pre→post automatically. Market panels show the **whole league universe pre-draft / free agents post-draft** (universe − ∪ all rosters); works for any account, all 12 teams. Verified live on jviola's 2025 league.
- [x] **Scoring formats** PPR / Half / Standard threaded through rankings selection + the in-season projection field (`pickProjectionPoints`) + value/sim/tiers; surfaced in the governance banner.
- [x] **FREE nflverse opportunity** (`src/lib/nflverse/`): snap-share → real `opportunity` via `/api/cron/opportunity-refresh` snapshot, dropped from `missingFields`. Narrative / Liquidity / Waiver now run on free data.
- [x] **Panel reworks**: Command Center League Pulse (fixed-grid bars + aligned values); Market Intelligence (universe set, Price Discovery line→scatter, all 6 tabs audited); Player Universe (5 working tabs + grid cap/search); Nexus (real points-for/against + pts/week drivers); Draft (per-round/kicker-late recs + "+ Mine"/"Taken by opponent" buttons); Waiver (value-driven importance + search); Trade Center verified.
- [x] **UI/UX**: TopBar +10px breathing room; roomier segmented PanelTabs.
- [x] **QA**: security re-audit (SAFE TO SHIP, no cross-account/credential leak); `e2e/15-sprint5-panels.spec.ts` (all 9 panels, every tab, new interactions, junk-text + overflow at 4 viewports); 417 vitest + 78 e2e; live 2025 Brier backtest reproduces exactly.

## Still deferred (genuine future work)
- [ ] Yahoo Fantasy adapter (needs a registered Yahoo developer app for OAuth).
- [ ] ESPN FAAB-ratio extraction (Sleeper FAAB is wired; ESPN's `acquisitionBudget`/`waiverRank` path needs an ESPN-FAAB league to fixture-pin).
- [ ] In-season (current-week) opportunity: today's `opportunity` is last-season snap share (off-season role proxy); wire the current-season snap feed once games are played.
- [ ] Auto-load the signed-in user's first league on the homepage (the DemoBanner + `RAE_ENABLE_LIVE_HOMEPAGE` flag bridge the gap for now).
