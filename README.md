# RAE — Reputation Arbitrage Engine

RAE is a fantasy football behavioral-market intelligence operating system. It is designed around perception asymmetry, narrative propagation, market inefficiency, volatility, uncertainty, fragility, survivability, leverage, chaos exposure, and reproducible simulation.

## Architecture overview

RAE uses Next.js, TypeScript, Tailwind CSS v4 + shadcn/ui (Radix) for the shell, Zod validation, and deterministic simulation utilities. See **Design system** below for how the Tailwind layer coexists with the legacy CSS-variable theme.

Service boundaries:
1. **Frontend app** — five top-level systems only: Command Center, Market Intelligence, Player Universe, Narrative Engine, and Nexus Simulator.
2. **Data adapter layer** — adapter isolation begins with the Sleeper public players API boundary in `src/lib/sleeper.ts`.
3. **API abstraction/governance layer** — `src/lib/governance.ts` defines source metadata, freshness, missingness, confidence, validation state, and bounded cache key behavior.
4. **Simulation engine** — `src/lib/simulation.ts` provides seeded Monte Carlo primitives, parameter logging, replayability, and assumptions.
5. **Rendering pipeline** — `src/components/RaeApp.tsx` renders topology, liquidity, orbital, narrative, and multiverse systems from validated records only.
6. **Audit layer** — docs and UI banners expose stale, fixture, missing, unavailable, and validation states.

## Data sources

Preferred production adapters:
- Sleeper API for public identity/league data where permitted.
- NFLverse/nflfastR/nflreadr for historical and projection features.
- Weather, injury, RSS/news, and sentiment feeds where legal and available.

Current implementation:
- Sleeper identity adapter is implemented.
- RAE intentionally refuses to infer market values, ownership, sentiment, or rankings from identity records alone.
- Development fixtures exist only as clearly labeled dev/test fixtures. Enable with `RAE_ALLOW_FIXTURES=true`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | Yes (prod/dev) | Auth.js session signing key. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `DATABASE_URL` | No (defaults to `file:.data/rae.sqlite`) | SQLite for dev, Postgres URL for production (Vercel Marketplace Postgres / Neon). |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Base64-encoded 32 bytes. Encrypts ESPN cookies and OAuth tokens at rest with AES-256-GCM. |
| `RAE_ALLOW_FIXTURES` | No | `true` to render clearly labeled dev/test fixture records. Defaults to unavailable/missing states. |
| `RAE_LIVE_TESTS` | No | `1` to enable live API round-trip vitest specs. |
| `RAE_LIVE_SLEEPER_LEAGUE_ID` | No | Public Sleeper league for live tests. |
| `ESPN_S2`, `ESPN_SWID`, `ESPN_LEAGUE_ID`, `ESPN_SEASON` | No | Live ESPN private-league round-trip tests. |

Secrets and API keys must remain server-side. Do not expose league tokens or paid data credentials through `NEXT_PUBLIC_*` variables.

## Auth and league connection

RAE ships multi-user authentication via Auth.js (NextAuth v5) with the Drizzle adapter (SQLite locally, Postgres in production).

- Passwords are hashed with scrypt (`src/lib/passwords.ts`) — plaintext is never stored.
- ESPN private-league cookies (`espn_s2` + `SWID`) are encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`) and never returned to the browser after creation. They are decrypted only inside the server-only `/api/leagues/[id]/refresh` route.
- Sleeper integration uses public endpoints (no auth required).
- Visit `/login` to sign up, `/settings/leagues` to add leagues, and `POST /api/leagues/[id]/refresh` to pull the live envelope for a specific league.
- Sign-in errors never echo Auth.js internals — `src/lib/auth/errors.ts` maps every failure class to a friendly string.
- Per-account isolation is enforced at the query layer; `e2e/07-no-shared-data.spec.ts` and `docs/account-isolation.md` are the regression gate.

The topbar shows the signed-in user's avatar + email + sign-out when authenticated, and a "Sign in" CTA when not. A persistent **DEMO DATA** banner sits above the dashboard whenever the envelope is fixture-mode, so a signed-in user is never confused about whether the tiles reflect their own league.

The full Sleeper and ESPN adapter surfaces are in `src/lib/sleeper/` and `src/lib/espn/` and produce records that pass `PlayerMarketRecordSchema` via `src/lib/normalize.ts`. Behavioral-market metrics still default to zero (unavailable) — RAE refuses to fabricate them from identity records alone.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Exact run commands

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
npm run deploy
```

`npm run deploy` currently aliases build validation. Wire it to Vercel, Docker, or another deployment target once production infrastructure is selected.

## Production deployment

Recommended production path:
1. Configure server-side API credentials in the hosting provider secret manager.
2. Keep `RAE_ALLOW_FIXTURES=false`.
3. Add persistent cache/database storage if adapter throughput exceeds in-memory or platform cache limits.
4. Run `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` in CI.
5. Deploy through Vercel or a containerized Next.js host.

## League connection

Private-league connection is implemented (see **Auth and league connection** above):
1. ESPN private-league cookies (`espn_s2` + `SWID`) are pasted by the user at `/settings/leagues`.
2. They are encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`) in the `leagueCredentials` table.
3. Decryption happens only server-side, only after the per-user ownership check, inside `src/lib/leagues/fetchLive.ts` and the `/api/leagues/[id]/refresh` route.
4. The client only ever receives derived, validated league state — never the credentials.

Sleeper leagues need no credentials (public API). Yahoo is the one platform still deferred — it requires a registered Yahoo developer app for OAuth.

## Simulation methodology

The Nexus Simulator uses:
- deterministic Mulberry32 PRNG,
- explicit seed and parameter logging,
- bounded iteration counts,
- risk tolerance controls,
- assumptions attached to every result.

Current probabilities are development-calibration outputs when fixture mode is enabled. Production calibration requires validated projections, schedule, roster, injury, and scoring settings. RAE does not claim fixture probabilities are live production forecasts.

## Draft systems

Draft Intelligence is the sixth top-level system (`src/components/panels/DraftIntelligence.tsx`). It ships with:
- Live Board — click rows to draft to your roster.
- Recommendation Queue — categories (`Value`, `Need`, `Stash`, `Run`) with a deterministic scoring function in `src/lib/draft/recommend.ts`.
- Tier Collapse Forecast — per-position tier breaks and intensity, from `src/lib/draft/tiers.ts`.
- Multiverse — 3-D branching path scene driven by branch probability and projected roster delta.

Recommendation and tier logic are pure functions with unit tests in `src/lib/draft/*.test.ts`. Live draft ingestion can be wired by calling `getDraftPicks(draftId)` (Sleeper) or `getDraft(client, { leagueId, season })` (ESPN) and feeding the result into the panel.

## Stale-data handling

Every source envelope exposes:
- source,
- fetched timestamp,
- TTL,
- freshness state,
- confidence,
- validation status,
- missing fields,
- assumptions,
- failure conditions.

Freshness states are `fresh`, `stale`, `missing`, `unavailable`, and `fixture`.

## Design system

The shell, navigation, panel grid, and shared panel chrome are built on **Tailwind CSS v4 + shadcn/ui** (Radix primitives, `new-york` style). The data internals — KPI strips, dense tables, charts, and the WebGL canvases — stay on the original `globals.css` classes, which already match the blueprint's data-dashboard density.

- **Token bridge** — the legacy `:root` CSS variables (`--bg`, `--panel`, `--cream`, `--muted`, the neon ramp) remain the single source of truth. The shadcn tokens are defined alongside them in a Tailwind `@theme` block as a separate `--color-*` namespace, so the two systems share colors without collision (notably legacy `--muted` is a text color, shadcn `--color-muted` is a surface).
- **Coexistence** — `globals.css` prepends `@import "tailwindcss"`, then keeps the legacy rules below it. Tailwind utilities and legacy classes render side by side; Tailwind's Preflight sits in `@layer base` so the unlayered legacy CSS still cascades on top.
- **shadcn components** — `Sidebar`, `Card`, `Tabs`-style `PanelTabs`, `Button`, `DropdownMenu`, `Tooltip`, `Input`, `Badge`, `Separator` live in `src/components/ui/`. The dashboard shell composes them via `AppSidebar`, `TopBar`, `PanelGrid`, and `PanelCard`.
- **What stayed on legacy CSS** — `.kpi-row`, `.table-wrap`, `.section-label`, chart primitives, and every WebGL/keyframe rule. The dead shell/grid/tab rules (`.system-panel`, `.dashboard-grid`, `.tab-row`, etc.) were pruned.

## Mobile responsiveness

The dashboard grid reflows through Tailwind breakpoints in `PanelGrid` — a responsive 1 → 2 → 3 column layout with one consistent `gap` and `padding` scale, replacing the old ad-hoc pixel gaps. Dense data internals (KPI strips, sub-grids) keep their legacy media queries; tables and the system tab strip scroll horizontally inside their own clipped containers so the document never overflows.

`playwright.config.ts` runs both a `chromium` (Desktop Chrome) and a `mobile-chrome` (Pixel 5) project, and `e2e/01-dashboard.spec.ts` asserts zero horizontal document overflow at 1440 / 1024 / 768 / 390 px. Mobile topology is preserved rather than reduced to generic cards.

## Accessibility

Implemented accessibility features:
- semantic landmarks and headings,
- keyboard-visible focus states,
- `aria-label` on topology visualizations,
- `aria-live` operational status,
- `prefers-reduced-motion` support,
- high-contrast graphite/cream theme with restrained status colors.

Manual screen-reader and automated axe/Playwright audits should be added before production release.

## Testing strategy

Current tests cover:
- schema validation, fixture labeling, stale/missing/unavailable states,
- bounded cache-key normalization,
- Sleeper + ESPN adapter non-fabrication behavior,
- deterministic PRNG + Monte Carlo replay,
- statistical property tests on every derived metric (bounds, determinism, sensitivity),
- bootstrap CI / Welch t-test / Cohen's d helpers,
- AES-256-GCM crypto round-trip and tamper rejection,
- scrypt password hashing, per-user league + notification isolation,
- headshot URL resolution (Sleeper-primary, ESPN-fallback) and the wrong-id regression,
- friendly auth-error mapping (no Auth.js internals leak).

End-to-end (Playwright, `e2e/`): public dashboard render, login form, axe accessibility
scan, draft + lifecycle tabs, register → settings flow, per-account isolation, and a
responsive viewport sweep asserting no horizontal overflow at 1440 / 1024 / 768 / 390 px.
`vitest` holds 151 unit/integration tests; CI runs typecheck + lint + vitest + Playwright +
Lighthouse on every push (`.github/workflows/ci.yml`).

## Design philosophy

RAE pairs a graphite-and-cream institutional base with restrained neon accents that are only emitted by data-bright pixels — never used decoratively. Reference set: Bloomberg Terminal density discipline, Tremor-style information hierarchy, Awwwards-winning WebGL signal visualizations. The result is dense and operational with selectively dimensional 3-D where the metaphor (orbital topology, liquidity ribbons, volatility surface, multiverse paths) genuinely encodes signal.

Implementation rules:
- DOM owns KPI cards, tables, lists, gauges, and controls (a11y, copy, selection).
- WebGL (`react-three-fiber`) owns topology and surface visualizations only. One `<Canvas>` per scene; `frameloop="always"` (Three.js draws the scene on its own cadence) — each scene checks `useReducedMotion()` and skips per-frame animation for reduced-motion users so the canvas still renders a static image.
- Every animation responds to `prefers-reduced-motion` via Framer Motion's `useReducedMotion()` — including the canvas auto-rotation in `OrbitalTopology`, `LiquidityFlow`, `NarrativeField`, `PlayerGalaxy`, `VolatilitySurface`, and `DraftMultiverse`.
- Neon palette is restricted to cyan/lime/magenta tokens used inside WebGL scenes; the DOM layer stays on the original cream/amber/green/red/blue tokens.

## Motion philosophy

Motion is restrained and data-encoded. Topology nodes, liquidity flows, narrative waves, and scenario branches animate from variables such as volatility, opportunity, narrative pressure, confidence, and fragility. Reduced-motion users receive suppressed animation.

## No-synthetic-data philosophy

RAE does not fabricate production intelligence. If live data is unavailable, the UI exposes unavailable, missing, stale, or fixture states honestly. Development fixtures are labeled and gated by `RAE_ALLOW_FIXTURES=true`.

## Troubleshooting

- **UI says unavailable:** this is expected without production behavioral-market adapters. Set `RAE_ALLOW_FIXTURES=true` only for local visual development.
- **Sleeper request fails:** check network access and Sleeper API availability.
- **Build fails on missing dependencies:** run `npm install`.
- **Lint command fails in newer Next.js:** use `npx eslint .` until the framework lint wrapper is restored or replaced.

## Continuous integration

Every push and pull request runs three GitHub Actions jobs in parallel:

1. **`quality`** — `npm ci && npx tsc --noEmit && npx eslint . && npx vitest run`.
2. **`e2e`** — `npx playwright install --with-deps chromium && npx next build && npx playwright test`. Includes an axe accessibility scan (`e2e/03-a11y.spec.ts`) that fails the build on any `serious` or `critical` violation.
3. **`lighthouse`** — `npx next build && npx lhci autorun`. Asserts Accessibility ≥ 90 (fail) and Performance ≥ 70, Best Practices ≥ 85, SEO ≥ 85 (warn).

Workflow file: `.github/workflows/ci.yml`. Lighthouse config: `lighthouserc.json`. Playwright config: `playwright.config.ts`.

To run the suite locally:

```bash
npm install
npx playwright install --with-deps chromium  # one-time
npm run build
npm run e2e           # playwright
npm run lighthouse    # lhci against next start
```

## Statistical validation

The dashboard's derived metrics are now backed by 39 property-based statistical tests in `src/lib/derivedMetrics.stats.test.ts` and `src/lib/simulation.calibration.test.ts`. Every metric is asserted for determinism, range bounds, and sensitivity. The Monte Carlo simulation's response to `riskTolerance` is hypothesis-tested via Welch's t-test (p < 0.001) with Cohen's d effect size (|d| ≥ 0.5). The 95% bootstrap confidence interval for championship probability is surfaced in the Nexus Simulator side column.

See `docs/calibration.md` for the production calibration plan (Brier-score targets, reliability diagrams, k-fold cross-validation against historical seasons, parameter tuning procedure).

## Known limitations

- ESPN cookies (`espn_s2`, `SWID`) expire periodically. When ESPN refresh starts returning `unavailable`, the user needs to paste fresh cookies into `/settings/leagues`. There is no programmatic refresh path.
- The Sleeper `/v1/players/nfl` payload is ~19 MB. Solved via the daily Vercel cron at `/api/cron/players-refresh` which snapshots into the `players_snapshots` Postgres table; `loadRAEEnvelope` reads the snapshot first and only falls back to a live fetch when the snapshot is older than 36h or missing. Vercel Cron Jobs are gated by the `CRON_SECRET` env var.
- Yahoo Fantasy adapter is deferred (OAuth requires a registered Yahoo developer app).
- Paid feeds (FantasyPros projections, paid injury/sentiment) are not implemented. Free-tier adapters (open-meteo weather, public NFL RSS) are wired and respect the same governance envelope contract.
- The lifecycle cron at `/api/cron/lifecycle-check` runs once daily (09:00 UTC) and pulls each user's roster live via `src/lib/leagues/fetchLive.ts` (decrypts ESPN cookies / hits Sleeper, normalizes through `PlayerMarketRecordSchema`) before running the rules engine. The daily cadence is the Vercel Hobby-plan cap of one run per cron per day; Pro plans can tighten the interval in `vercel.ts`. FAAB ratio is not yet extracted from league settings, so the FAAB-depleted rule remains dormant until that field is parsed.
- The Sleeper `user_id ↔ RAE userId` mapping is not yet captured at league-add time, so the cron currently scores the first roster in each Sleeper league as "yours." A one-form-field follow-up on `/settings/leagues` resolves this.
- No paid sentiment/news/injury adapters yet.
- Fixture data is not production intelligence.
- Monte Carlo calibration is structurally deterministic but not production-calibrated without real projections and league settings.
- Multi-tenant organizations / shared teams are out of scope in this pass — single user per account, per-user data isolation enforced by `userId` foreign key and verified by `src/lib/leagues.test.ts`.
- Automated screenshot, accessibility, and Lighthouse audits require a running browser workflow.
