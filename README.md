# RAE — Reputation Arbitrage Engine

RAE is a fantasy football behavioral-market intelligence operating system. It is designed around perception asymmetry, narrative propagation, market inefficiency, volatility, uncertainty, fragility, survivability, leverage, chaos exposure, and reproducible simulation.

## Architecture overview

RAE uses Next.js, TypeScript, CSS variables, Zod validation, and deterministic simulation utilities.

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

League OAuth/private league connection is not implemented in this pass. Planned flow:
1. Server-side OAuth/token exchange.
2. Token refresh handled only on server routes.
3. Encrypted token storage in Postgres/Supabase.
4. Client receives derived, validated league state only.

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

## Mobile responsiveness

Breakpoints are implemented for:
- ultrawide/desktop default grid,
- laptop/tablet single-column fallback below 1280px,
- mobile controls and horizontally scrollable dense tables below 768px.

Mobile topology is preserved rather than reduced to generic cards.

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
- schema validation,
- fixture labeling,
- stale/missing/unavailable states,
- bounded cache key normalization,
- Sleeper adapter non-fabrication behavior,
- deterministic PRNG replay,
- deterministic Monte Carlo replay.

Planned tests:
- Playwright responsive and accessibility tests,
- route-level unavailable-state snapshots,
- adapter retry/rate-limit tests,
- topology render budget tests.

## Design philosophy

RAE pairs a graphite-and-cream institutional base with restrained neon accents that are only emitted by data-bright pixels — never used decoratively. Reference set: Bloomberg Terminal density discipline, Tremor-style information hierarchy, Awwwards-winning WebGL signal visualizations. The result is dense and operational with selectively dimensional 3-D where the metaphor (orbital topology, liquidity ribbons, volatility surface, multiverse paths) genuinely encodes signal.

Implementation rules:
- DOM owns KPI cards, tables, lists, gauges, and controls (a11y, copy, selection).
- WebGL (`react-three-fiber`) owns topology and surface visualizations only. One `<Canvas>` per scene, `frameloop="demand"` so idle GPU is zero.
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

## Known limitations

- ESPN cookies (`espn_s2`, `SWID`) expire periodically. When ESPN refresh starts returning `unavailable`, the user needs to paste fresh cookies into `/settings/leagues`. There is no programmatic refresh path.
- The Sleeper `/v1/players/nfl` payload is now ~19 MB (Next.js's per-item data cache cap is 2 MB). PR 5's planned cron snapshot path (`/api/cron/players-refresh` → Vercel Blob or Postgres `players_snapshots`) is not yet implemented; the route currently fetches on demand. Acceptable for dev; not for production traffic.
- No paid sentiment/news/injury adapters yet.
- Fixture data is not production intelligence.
- Monte Carlo calibration is structurally deterministic but not production-calibrated without real projections and league settings.
- Multi-tenant organizations / shared teams are out of scope in this pass — single user per account, per-user data isolation enforced by `userId` foreign key and verified by `src/lib/leagues.test.ts`.
- Automated screenshot, accessibility, and Lighthouse audits require a running browser workflow.
