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
| `RAE_ALLOW_FIXTURES` | No | Set to `true` to render clearly labeled dev/test fixture records. Defaults to unavailable/missing states. |

Secrets and API keys must remain server-side. Do not expose league tokens or paid data credentials through `NEXT_PUBLIC_*` variables.

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

Draft Intelligence is contextual, not a sixth top-level tab. It appears inside operational workflows and is designed to support:
- live draft board,
- recommendation categories,
- tier collapse forecasts,
- draft fragility,
- league meta detection,
- multiverse draft simulation,
- draft heat topology.

This pass implements the contextual drawer and governance language. Live draft ingestion remains a planned adapter extension.

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

RAE intentionally avoids cyberpunk, gamer, neon, and decorative sci-fi patterns. The UI uses graphite surfaces, cream contrast, amber highlights, restrained red/green status semantics, blue telemetry accents, asymmetrical density, and operational whitespace.

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

- No database persistence yet.
- No league OAuth/private league sync yet.
- No paid sentiment/news/injury adapters yet.
- Fixture data is not production intelligence.
- Monte Carlo calibration is structurally deterministic but not production-calibrated without real projections and league settings.
- Automated screenshot, accessibility, and performance audits require a running browser workflow.
