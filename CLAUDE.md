# CLAUDE.md — RAE Fantasy Football Dashboard Guardrails

## Product Identity

RAE is a fantasy football analytics and model-governed decision platform.

RAE must feel like:

- a professional sports-quant command center,
- a trustworthy model-governance dashboard,
- a responsive SaaS product,
- a clean fantasy decision engine.

RAE must not feel like:

- a generic Tailwind template,
- a fake betting dashboard,
- a Claude-generated card grid,
- a dense spreadsheet with neon panels,
- a black-box recommendation app.

## Mandatory Project Rules

- Never fabricate data.
- Never hardcode player rankings.
- Never hardcode projections.
- Never hardcode probabilities.
- Never hardcode chart values.
- Never hardcode timestamps.
- Never hardcode live/fixture mode.
- Never hide unavailable data.
- Never remove source metadata.
- Never remove model assumptions.
- Never remove validation state.
- Never expose secrets.
- Never expose private league credentials.
- Never suppress failing tests.

If a metric cannot be traced, show unavailable.

If data is fixture/demo, label it.

If data is stale, label it.

If assumptions matter, show them.

If a model lacks calibration, do not present it as production-safe.

## Required Commands

Run these after meaningful code changes:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Run these when available:

```bash
npm run e2e
npm run lighthouse
```

Do not finish with failing gates.

Live-network integration tests are gated behind `RAE_LIVE_TESTS=1` (Sleeper) and
ESPN/FantasyCalc credential env vars; they are correctly skipped in CI. Run them
locally with the gate set when verifying real integrations.

## Design Principles

- Onboarding first.
- **At most** one primary CTA per view — never invent one.
  Amended 2026-09-01 (redesign decision D4). This read "one primary CTA per
  view", which a reader can fairly take as a requirement that every view have
  one. `RouteHeader.tsx` already refused that, and its reasoning is the stronger
  one: most routes here are analytical surfaces whose content IS the thing you
  came for, a button that scrolls the page you are already on is noise, and
  inventing an action for a route that has none is *fabricating an affordance* —
  the interface equivalent of fabricating a number, which the rules above
  forbid outright. The gate in `e2e/27-ui-audit.spec.ts` enforces **at most**
  one, and `/mock-draft` legitimately has zero.
- Progressive disclosure.
- Clear KPI hierarchy.
- Fewer simultaneous panels.
- Mobile-first.
- Accessible by default.
- Source freshness visible.
- Model assumptions visible.
- Fixture/live state visible.
- Strong RAE visual identity.
- No generic template aesthetic.

## Information Architecture

Preferred top-level structure:

- Home
- Dashboard
- League
- Players
- Analytics
- Draft
- Waivers
- Trades
- Reports
- Settings

Adapt only if existing architecture demands it. (Implemented: a multi-route shell
— route group `src/app/(app)/{dashboard,players,analytics,draft,waivers,trades,reports}`
plus settings/leagues + settings/account, all under an onboarding `/`. Wrapped by a
collapsible numbered route sidebar (`RouteSidebar`) + a sticky `TopCommandBar` + a
mobile bottom nav. The nine "systems" are distributed across these routes; `/dashboard`
is a slim overview. One request-cached `loadEnvelope()` + `deriveAppData()` feed every
route via `RouteView`.)

## Visual System

Use a controlled design system:

- navy background,
- elevated slate panels,
- amber primary CTA,
- blue informational accent,
- green success,
- red risk,
- yellow warning,
- restrained glow,
- consistent typography (IBM Plex Sans / Bricolage Grotesque / IBM Plex Mono),
- consistent spacing,
- accessible contrast.

Do not overuse:

- neon glow,
- tiny text,
- dense tables,
- decorative cards,
- meaningless charts.

## Quant Governance

Every model output must expose:

- source,
- freshness,
- confidence,
- assumptions,
- validation status,
- fixture/live/unavailable mode.

Simulation output must remain reproducible (seeded `mulberry32`; never
`Math.random` for displayed data).

Backtest output must remain documented.

Probability output must show uncertainty or limitations. Conditional/joint
distributions must be labeled so they cannot be misread (e.g. the Outcome
Multiverse shows P(outcome | wins), each column summing to 100%).

## UX Rules

Default screen must answer:

1. What is this?
2. What should I do next?
3. Is this live or demo?
4. What data is driving this?
5. Can I trust it?

If the user cannot answer those questions within five seconds, the design fails.

## Accessibility Rules

- WCAG 2.2 AA where feasible (axe scan must be green on all routes:
  `/`, `/login`, `/settings/*`, `/mock-draft`).
- Visible focus states.
- Keyboard navigation.
- Semantic headings.
- Descriptive labels.
- Reduced motion support (`useReducedMotion`).
- Touch targets suitable for mobile.
- Charts must have text alternatives or accessible summaries.

## Testing Rules

Every major UI change needs:

- unit tests where logic changes,
- component tests where feasible,
- Playwright route coverage where feasible,
- mobile screenshot,
- tablet screenshot,
- desktop screenshot,
- no console errors,
- no broken network calls.

## Data Sources (all free)

- Sleeper API — identity, rosters, trending adds/drops, projections.
- FantasyPros ECR — consensus value/ADP (daily cron scrape).
- nflverse — snap-share opportunity (cron snapshot, CC-BY).
- ESPN — league/roster (cookie-encrypted), player news/injury.
- FantasyCalc / KTC / DynastyProcess — trade values.

open-meteo (weather) was listed here and was never wired: `weather/openmeteo.ts`
and `weather/stadiums.ts` were reachable only from their own test, and no surface
in the product referenced weather at all. Removed 2026-08-24 rather than left
looking connected — a data source listed in the guardrails is a claim, and this
one had nothing behind it. Restore from git history if it is wired for real.

Trending is a WAIVER signal (adds/drops of free agents); apply it to the market
pool (universe/free agents), not a set roster, or the hype axis reads flat.

## Final Response Rule

The final response must include evidence:

- files changed,
- commands run,
- pass/fail results,
- screenshots,
- remaining risks.

Do not claim success without evidence.
