# Pro Sports-Analytics Redesign

**Date:** 2026-05-22
**Branch:** `redesign/pro-sports-analytics`

## Goal

Replace the generic "AI-generated dark dashboard" look (neon-on-black, abstract 3-D glowing blobs) with a professional **pro sports-analytics** aesthetic — the look of a real fantasy-football product (ESPN / Sleeper / Yahoo): player-forward, scannable, data-clear. Replace the abstract 3-D WebGL scenes with informative 2-D visualizations. Fix authentication. Eliminate the lag. Verify every panel in a real browser.

## Phases

### Phase 1 — Design system
A disciplined, professional theme:
- Refined dark surfaces — real neutral grays, **not** pure black + neon.
- One confident accent color + standard fantasy position colors (QB / RB / WR / TE).
- Strong typographic hierarchy; big bold stat numbers; clear uppercase labels.
- Subtle 1px borders and solid card surfaces — **remove all neon glow** (`--glow-*`, glow shadows, gradient-heavy backgrounds).
- Generous, consistent spacing.

### Phase 2 — Replace the 6 abstract 3-D scenes with 2-D
Every 3-D WebGL scene becomes a clear, labeled 2-D view that shows player names, headshots, and real data. This also removes all WebGL render loops → fixes the lag.

| Panel | 3-D scene today | 2-D replacement |
| --- | --- | --- |
| Command Center | OrbitalTopology (League Pulse) | Player leaderboard cards (headshot + name + key metric) |
| Player Universe | PlayerGalaxy | Sortable player table / card grid with headshots |
| Narrative Engine | NarrativeField | Restyled 2-D narrative chart (existing LineChart) |
| Market Intelligence | LiquidityFlow / VolatilitySurface | Restyled 2-D charts (Bar / Line) |
| Nexus Simulator | VolatilitySurface | Restyled 2-D outcome chart |
| Draft Intelligence | DraftMultiverse | 2-D draft board / chart |

`Canvas3D`, the `three/` scenes, `Atmosphere`, `PostFX`, `StudioLighting`, shaders, and the three.js dependencies are removed once no panel references them.

### Phase 3 — Authentication
Fix signup / sign-in. Locally: `.env` created. Production: verify the Postgres `init-db` actually succeeded (the likely cause on the live site) and the auth flow works end to end.

### Phase 4 — QA
Per-panel verification in a real browser at desktop (1440px) and mobile (390px). Full gate: `tsc`, `eslint`, `vitest`, `next build`, `playwright`. PR with green CI.

## Verification discipline

Every phase is verified in a real browser before it is called done — no "it's fixed" without a screenshot confirming it.
