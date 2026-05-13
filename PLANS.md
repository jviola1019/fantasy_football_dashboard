# RAE Implementation Plan

## Repository inspection
- Framework detected: none. The repository only contained `README.md` at inspection time.
- Package manager detected: none. This plan will introduce npm because no lockfile exists.
- Existing architecture: none.
- Existing design system: none.
- Existing routing: none.
- Existing state management: none.
- Existing testing stack: none.
- Existing deployment strategy: none.

## Architecture decision
Use a focused Next.js + TypeScript application because the repo has no incumbent stack and the product requires server/client separation, route handlers, typed boundaries, responsive UI, and deployability.

## Service boundaries
1. Frontend shell: five top-level systems only.
2. Data adapter layer: isolated adapters for Sleeper/NFLverse-style sources with schema validation and source metadata.
3. Governance layer: freshness scoring, stale/missing/unavailable states, cache TTL contracts, and validation status.
4. Simulation engine: deterministic seeded Monte Carlo primitives with replayable parameter logs.
5. Visualization layer: CSS/SVG topology renderers that encode documented variables only.
6. Audit layer: UI-visible source state and developer-facing audit documentation.

## Phases
### Phase 1 — Foundation
- Scaffold Next.js, TypeScript, CSS variables, route shell.
- Implement five top-level systems exactly.
- Add planning, task, and audit docs.

### Phase 2 — Data governance
- Add Zod schemas for source envelopes and player market records.
- Add bounded fetch/cache contracts and missing/stale state modeling.
- Add Sleeper public adapter interface without client-exposed secrets.

### Phase 3 — Simulation infrastructure
- Add deterministic PRNG and Monte Carlo scenario runner.
- Persist seed, parameters, assumptions, confidence, and failure conditions in result objects.

### Phase 4 — Product UI
- Build Command Center, Market Intelligence, Player Universe, Narrative Engine, and Nexus Simulator sections.
- Integrate draft intelligence contextually, not as a top-level tab.
- Render unavailable/stale/fixture modes honestly.

### Phase 5 — Validation
- Unit/schema/stale/missing-data/determinism tests.
- Lint, typecheck, build.
- Responsive/accessibility review and documented limitations.

## Non-goals for this pass
- Paid/private APIs, league OAuth, database persistence, and production-grade Monte Carlo calibration are planned boundaries, not fabricated implementations.
- No hardcoded live metrics will be represented as production data.


## Sprint correction — visual fidelity, roster imagery, and operational polish

Brutal assessment: the first implementation was an architecture/governance skeleton, not a flagship interface. It satisfied several data-integrity constraints but underdelivered on the user's visual bar and did not prove player imagery/roster presentation. This correction focuses on repo-native, push-safe visual systems rather than committing binary assets.

### Execution plan
1. Keep exactly five top-level systems and preserve non-fabrication governance.
2. Extend player records with roster slot, status, jersey number, remote headshot URL, and image source metadata.
3. Verify remote player headshot URLs during development with HTTP HEAD checks; do not commit downloaded images.
4. Rebuild the interface around an institutional command surface: loading sigil, hero console, 3D CSS topology, roster rail, player image cards, orbital universe, narrative flow field, and multiverse simulation.
5. Validate desktop/mobile layout with build-time checks, unit/product-contract tests, and local screenshot capture only.
6. Document that the original reference image is not present in the repository/context, so implementation targets the stated visual language and must be visually compared by the user/reviewer against the private reference.
