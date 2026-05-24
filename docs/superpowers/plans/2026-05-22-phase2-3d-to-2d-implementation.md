# Phase 2: Replace Decorative 3-D Scenes with Player-Forward 2-D Visualizations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five decorative 3-D WebGL scenes with scannable player-forward 2-D visualizations, keep and improve one genuinely useful 3-D graph (VolatilitySurface with labeled axes), trim the dead WebGL layer, and fix all tests.

**Architecture:** A new shared `PlayerRow` component (headshot + position badge + metric bar) is the building block for every player-forward view. Each panel's `<Canvas3D>` block is replaced in-place with a 2-D React component that uses existing chart primitives (`BarChart`, `LineChart`) and `PlayerRow`. The 3-D layer is then pruned to only `VolatilitySurface` and its dependencies; five deleted scene files are scrubbed from imports and tests.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, SVG-based `BarChart`/`LineChart`/`RadarChart`, three.js / @react-three/fiber (retained only for `VolatilitySurface`), Playwright (e2e), Vitest (unit).

---

## File Map

**Create:**
- `src/components/PlayerRow.tsx` — shared player row: headshot + name + position badge + team + metric value + optional bar
- CSS additions inline in `src/app/globals.css` — `.player-row`, `.pos-badge`, `.leaderboard-list` enhancements, `.player-grid`, `.narrative-bar-chart`, volatility surface axis label rules

**Modify (panel replacements):**
- `src/components/panels/CommandCenter.tsx` — reconcile stray edit, use `PlayerRow` in `LeaguePulse`
- `src/components/panels/PlayerUniverse.tsx` — replace `GalaxyView`'s `<Canvas3D><PlayerGalaxy/>` with a scrollable player grid/list
- `src/components/panels/NarrativeEngine.tsx` — replace `NarrativeFlowField`'s `<Canvas3D><NarrativeField/>` with a 2-D bar list of players by `narrativePressure`
- `src/components/panels/MarketIntelligence.tsx` — replace `LiquidityFlow`'s `<Canvas3D><LiquidityFlowScene/>` with a 2-D `BarChart` by `opportunity`
- `src/components/panels/DraftIntelligence.tsx` — replace `DraftMultiverse` tab's `<Canvas3D><DraftMultiverse/>` with a labeled 2-D draft-board bar list of `recommendations`

**Modify (3-D improvement):**
- `src/components/three/scenes/VolatilitySurface.tsx` — add labeled axes, legend caption, better camera angle
- `src/components/panels/MarketIntelligence.tsx` — improve `VolatilitySurface` wrapper with axis-label HTML overlay
- `src/components/panels/NexusSimulator.tsx` — keep `VolatilitySurface` + surrounding 2-D content as-is (already has the SVG multiverse chart)

**Delete (scenes):**
- `src/components/three/scenes/OrbitalTopology.tsx`
- `src/components/three/scenes/PlayerGalaxy.tsx`
- `src/components/three/scenes/NarrativeField.tsx`
- `src/components/three/scenes/LiquidityFlow.tsx`
- `src/components/three/scenes/DraftMultiverse.tsx`
- `src/components/three/HeadshotBillboard.tsx`
- `src/components/three/shaders/flowMaterial.ts` (only used by deleted scenes)

**Keep (3-D infrastructure):**
- `src/components/three/Canvas3D.tsx`
- `src/components/three/Atmosphere.tsx`
- `src/components/three/PostFX.tsx`
- `src/components/three/SceneErrorBoundary.tsx`
- `src/components/three/lighting/` (all)
- `src/components/three/scenes/VolatilitySurface.tsx`
- `src/components/three/shaders/surfaceMaterial.ts`

**Modify (CSS cleanup):**
- `src/app/globals.css` — remove `.galaxy-field` (now repurposed for the 2-D grid), remove scene-specific dead rules, keep `.scene-fallback*`

**Modify (tests):**
- `e2e/01-dashboard.spec.ts` — rewrite WebGL canvas assertions; verify player names visible in panels; keep the one remaining canvas (VolatilitySurface, tab-gated)
- `e2e/04-draft-and-lifecycle.spec.ts` — verify no broken references; keep existing assertions (none reference scenes directly)

---

## Task A: Create the shared `PlayerRow` component

**Files:**
- Create: `src/components/PlayerRow.tsx`
- Modify: `src/app/globals.css` (add CSS for `.player-row`, `.pos-badge`)

- [ ] **Step A1: Add CSS for PlayerRow and PositionBadge to globals.css**

Open `src/app/globals.css` and append the following block after the `/* ─── Fragility X-Ray ───────────── */` section (around line 353):

```css
/* ─── PlayerRow & PositionBadge ─────────────────────────────────────────── */
.player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid rgba(214,226,226,0.06);
  min-width: 0;
}
.player-row:last-child { border-bottom: none; }
.player-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.player-row-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.player-row-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--cream);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.player-row-team {
  font-size: 9px;
  color: var(--muted);
  white-space: nowrap;
}
.player-row-bar-wrap {
  height: 3px;
  background: rgba(255,255,255,0.07);
  border-radius: 2px;
  overflow: hidden;
}
.player-row-bar {
  height: 100%;
  border-radius: 2px;
  background: var(--green);
  width: var(--bar-w, 0%);
  transition: width 0.3s ease;
}
.player-row-metric {
  font-size: 11px;
  font-weight: 700;
  color: var(--cream);
  white-space: nowrap;
  min-width: 28px;
  text-align: right;
}
/* Position badge pill */
.pos-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.4;
  white-space: nowrap;
  flex-shrink: 0;
}
.pos-badge[data-pos="qb"] { background: rgba(239,92,122,0.18); color: var(--pos-qb); }
.pos-badge[data-pos="rb"] { background: rgba(53,192,138,0.18); color: var(--pos-rb); }
.pos-badge[data-pos="wr"] { background: rgba(74,140,247,0.18); color: var(--pos-wr); }
.pos-badge[data-pos="te"] { background: rgba(234,165,61,0.18); color: var(--pos-te); }
.pos-badge[data-pos="k"],
.pos-badge[data-pos="def"] { background: rgba(141,154,160,0.18); color: var(--muted); }

/* Leaderboard list used in LeaguePulse */
.leaderboard-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.leaderboard-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(214,226,226,0.05);
}
.leaderboard-row:last-child { border-bottom: none; }
.lb-rank {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  min-width: 18px;
  text-align: right;
}
.lb-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lb-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.lb-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--cream);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lb-team { font-size: 9px; color: var(--muted); }
.lb-bar-wrap {
  height: 3px;
  background: rgba(255,255,255,0.07);
  border-radius: 2px;
  overflow: hidden;
}
.lb-bar {
  height: 100%;
  background: var(--green);
  border-radius: 2px;
  width: var(--bar-w, 0%);
}
.lb-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--green);
  min-width: 30px;
  text-align: right;
}
.league-pulse-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.league-pulse-edge-pill {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.league-pulse-edge-val {
  font-size: 18px;
  font-weight: 800;
  color: var(--green);
}
.league-pulse-edge-lbl {
  font-size: 9px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .07em;
}
.lp-empty-icon { font-size: 20px; color: var(--muted); }

/* Player grid for PlayerUniverse */
.player-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
  padding: 4px 0;
}
.player-grid-card {
  padding: 8px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color 0.12s, background 0.12s;
}
.player-grid-card:hover { border-color: rgba(74,140,247,0.4); background: rgba(74,140,247,0.06); }
.player-grid-card.selected { border-color: var(--blue); background: rgba(74,140,247,0.1); }
.player-grid-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.player-grid-card-name {
  font-size: 10px;
  font-weight: 600;
  color: var(--cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-grid-card-meta {
  font-size: 9px;
  color: var(--muted);
}
.player-grid-card-value {
  font-size: 14px;
  font-weight: 800;
  color: var(--green);
  text-align: right;
  margin-top: 2px;
}
.player-grid-empty {
  padding: 24px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

/* Narrative bar list */
.narrative-bar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}
.narrative-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.narrative-bar-row-label {
  font-size: 10px;
  color: var(--cream);
  min-width: 120px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.narrative-bar-track {
  flex: 1;
  height: 12px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.narrative-bar-fill {
  height: 100%;
  border-radius: 2px;
  width: var(--bar-w, 0%);
  transition: width 0.3s ease;
}
.narrative-bar-val {
  font-size: 10px;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
  white-space: nowrap;
}

/* Volatility Surface axis labels */
.vol-surface-wrap { position: relative; }
.vol-axis-labels {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--muted);
  padding: 0 4px;
  margin-top: 2px;
}
.vol-axis-y-label {
  position: absolute;
  left: 2px;
  top: 50%;
  transform: rotate(-90deg) translateY(-50%);
  font-size: 8px;
  color: var(--muted);
  white-space: nowrap;
  transform-origin: left center;
}
.vol-surface-caption {
  padding: 6px 0 0;
  font-size: 9px;
  color: var(--muted);
  line-height: 1.5;
}
.vol-surface-caption strong { color: var(--cream); }

/* Draft multiverse 2-D bar list */
.draft-board-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}
.draft-board-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  border-radius: 3px;
}
.draft-board-rank {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  min-width: 20px;
}
.draft-board-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--cream);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-board-category {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--amber);
  border: 1px solid rgba(234,165,61,0.35);
  padding: 1px 5px;
  border-radius: 2px;
  white-space: nowrap;
  flex-shrink: 0;
}
.draft-board-score {
  font-size: 12px;
  font-weight: 700;
  color: var(--green);
  min-width: 28px;
  text-align: right;
  flex-shrink: 0;
}
.draft-board-bar-wrap {
  width: 60px;
  height: 4px;
  background: rgba(255,255,255,0.07);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}
.draft-board-bar {
  height: 100%;
  background: var(--green);
  border-radius: 2px;
  width: var(--bar-w, 0%);
}
.draft-board-empty {
  padding: 24px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}
```

- [ ] **Step A2: Create `src/components/PlayerRow.tsx`**

```tsx
"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { PlayerHeadshot } from "./PlayerHeadshot";
import { fixtureHeadshotFallbacks } from "@/lib/fixtures";

interface PlayerRowProps {
  player: PlayerMarketRecord;
  /** Numeric value displayed on the right (e.g. trueValue, narrativePressure). */
  metricValue: number | string;
  /**
   * Width of the proportional bar as a percentage [0, 100].
   * When omitted the bar is not rendered.
   */
  barPct?: number;
  /** Extra class on the root element. */
  className?: string;
  /** Headshot size in px. Default 32. */
  size?: number;
}

/** Lower-cases the position for data-pos attribute and CSS targeting. */
function posSlug(position: string): string {
  return position.toLowerCase();
}

/** Small pill tinted with the --pos-* color for the player's position. */
export function PositionBadge({ position }: { position: string }) {
  return (
    <span className="pos-badge" data-pos={posSlug(position)}>
      {position}
    </span>
  );
}

/**
 * Shared presentational player row.
 *
 * Layout: [headshot] [name + badge + team] [optional bar] [metric]
 *
 * Used by LeaguePulse (Command Center), player grids, narrative bars, etc.
 * Never owns data-fetching logic — callers pass in the player + derived values.
 */
export function PlayerRow({
  player,
  metricValue,
  barPct,
  className,
  size = 32,
}: PlayerRowProps) {
  return (
    <div className={`player-row${className ? ` ${className}` : ""}`}>
      <PlayerHeadshot
        player={player}
        fallbacks={fixtureHeadshotFallbacks[player.id] ?? []}
        size={size}
      />
      <div className="player-row-info">
        <div className="player-row-name-line">
          <span className="player-row-name">{player.name}</span>
          <PositionBadge position={player.position} />
          {player.team && <span className="player-row-team">{player.team}</span>}
        </div>
        {barPct !== undefined && (
          <div className="player-row-bar-wrap" aria-hidden="true">
            <div
              className="player-row-bar"
              style={{ ["--bar-w" as string]: `${Math.max(2, barPct)}%` }}
            />
          </div>
        )}
      </div>
      <span className="player-row-metric">{metricValue}</span>
    </div>
  );
}
```

- [ ] **Step A3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step A4: Commit**

```bash
git add src/components/PlayerRow.tsx src/app/globals.css
git commit -m "Add shared PlayerRow component and position badge CSS"
```

---

## Task B1: Reconcile CommandCenter — finish `LeaguePulse` with `PlayerRow`

The file already has a partial inline implementation (a `PositionBadge` + leaderboard). Replace the inline `PositionBadge` with the shared one from `PlayerRow.tsx`, and wire the leaderboard rows through `PlayerRow`.

**Files:**
- Modify: `src/components/panels/CommandCenter.tsx`

- [ ] **Step B1-1: Update CommandCenter to use the shared components**

Replace the entire file content. The key changes are:
1. Import `PlayerRow` and `PositionBadge` from `@/components/PlayerRow` instead of defining them inline.
2. Remove the inline `PositionBadge` and `posSlug` definitions.
3. Update `LeaguePulse` to use `PlayerRow` for each leaderboard entry.

Open `src/components/panels/CommandCenter.tsx` and make these changes:

At the top imports, add:
```tsx
import { PlayerRow, PositionBadge } from "../PlayerRow";
```

Remove the inline `posSlug` function (lines 102–105) and the inline `PositionBadge` function (lines 107–113).

Replace the entire `LeaguePulse` function with:
```tsx
function LeaguePulse({ players, marketEdge, timeRange }: { players: PlayerMarketRecord[]; marketEdge: number; timeRange: string }) {
  const ranked = [...players].sort((a, b) => b.trueValue - a.trueValue);
  const maxVal = ranked[0]?.trueValue ?? 100;
  return (
    <div className="league-pulse" aria-label="League pulse player leaderboard">
      <div className="league-pulse-topbar">
        <span className="league-pulse-label">LEAGUE PULSE</span>
        <span className="league-pulse-edge-pill">
          <span className="league-pulse-edge-val">{marketEdge}</span>
          <span className="league-pulse-edge-lbl">Market Edge · {timeRange}</span>
        </span>
      </div>

      {players.length === 0 ? (
        <div className="league-pulse-empty" role="status">
          <span className="lp-empty-icon">—</span>
          <span>Awaiting league data</span>
        </div>
      ) : (
        <ol className="leaderboard-list" aria-label="Players ranked by true value">
          {ranked.map((p, idx) => (
            <li key={p.id} className="leaderboard-row">
              <span className="lb-rank">{idx + 1}</span>
              <PlayerRow
                player={p}
                metricValue={Math.round(p.trueValue)}
                barPct={(p.trueValue / maxVal) * 100}
                size={32}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

Also remove the import for `PlayerHeadshot` and `fixtureHeadshotFallbacks` from this file if they are no longer referenced after the above changes (they are used only in the old inline leaderboard row — `PlayerRow` imports them internally).

- [ ] **Step B1-2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step B1-3: Commit**

```bash
git add src/components/panels/CommandCenter.tsx
git commit -m "Command Center: reconcile LeaguePulse to use shared PlayerRow"
```

---

## Task B2: Replace Player Universe 3-D galaxy with a player grid

**Files:**
- Modify: `src/components/panels/PlayerUniverse.tsx`

- [ ] **Step B2-1: Replace `GalaxyView` with a 2-D player grid**

The `GalaxyView` function currently renders `<Canvas3D><PlayerGalaxy/></Canvas3D>` with a prev/next cycler. Replace the entire `GalaxyView` function and update the imports.

Remove these imports:
```tsx
import { Canvas3D } from "../three/Canvas3D";
import { PlayerGalaxy } from "../three/scenes/PlayerGalaxy";
```

Add this import:
```tsx
import { PlayerRow } from "../PlayerRow";
```

Replace the entire `GalaxyView` function with:
```tsx
function GalaxyView({
  players, selectedIdx, onSelect,
}: {
  players: PlayerMarketRecord[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const maxVal = Math.max(...players.map((p) => p.trueValue), 1);
  if (players.length === 0) {
    return <div className="player-grid-empty" role="status">No players found</div>;
  }
  return (
    <div className="player-grid-outer" aria-label="Player list">
      <div className="player-grid">
        {players.map((p, i) => {
          const globalIdx = selectedIdx; // original players array index
          const isSelected = players[selectedIdx]?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`player-grid-card${isSelected ? " selected" : ""}`}
              onClick={() => onSelect(i)}
              aria-pressed={isSelected}
              aria-label={`${p.name}, ${p.position}, ${p.team ?? "unknown team"}`}
            >
              <div className="player-grid-card-header">
                <PlayerHeadshot
                  player={p}
                  fallbacks={fixtureHeadshotFallbacks[p.id] ?? []}
                  size={36}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="player-grid-card-name">{p.name}</div>
                  <div className="player-grid-card-meta">{p.position} · {p.team ?? "—"}</div>
                </div>
              </div>
              <div className="player-grid-card-value">{Math.round(p.trueValue)}</div>
              <div className="player-row-bar-wrap" aria-hidden="true">
                <div
                  className="player-row-bar"
                  style={{ ["--bar-w" as string]: `${Math.round((p.trueValue / maxVal) * 100)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Note: this keeps `PlayerHeadshot` and `fixtureHeadshotFallbacks` imports (already in the file). Remove `PlayerRow` import if not used elsewhere. The `globalIdx` variable can be deleted — it was left as a note; the `isSelected` check uses `players[selectedIdx]?.id === p.id` which correctly handles the filtered list.

Clean up — the component also needs `onSelect` to map to the **original** `players` array index, not the filtered list index. Update `GalaxyView` so that clicking a card in the filtered list sets `selectedIdx` to the index in the *original* `players` prop:

```tsx
// Inside GalaxyView, find the original index for each filtered player
function GalaxyView({
  players,    // already-filtered list
  allPlayers, // full unfiltered list for correct selectedIdx
  selectedIdx,
  onSelect,
}: {
  players: PlayerMarketRecord[];
  allPlayers: PlayerMarketRecord[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const maxVal = Math.max(...allPlayers.map((p) => p.trueValue), 1);
  if (players.length === 0) {
    return <div className="player-grid-empty" role="status">No players found</div>;
  }
  return (
    <div aria-label="Player grid">
      <div className="player-grid">
        {players.map((p) => {
          const originalIdx = allPlayers.findIndex((ap) => ap.id === p.id);
          const isSelected = selectedIdx === originalIdx;
          return (
            <button
              key={p.id}
              type="button"
              className={`player-grid-card${isSelected ? " selected" : ""}`}
              onClick={() => originalIdx !== -1 && onSelect(originalIdx)}
              aria-pressed={isSelected}
              aria-label={`${p.name}, ${p.position}, ${p.team ?? "unknown team"}`}
            >
              <div className="player-grid-card-header">
                <PlayerHeadshot
                  player={p}
                  fallbacks={fixtureHeadshotFallbacks[p.id] ?? []}
                  size={36}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="player-grid-card-name">{p.name}</div>
                  <div className="player-grid-card-meta">{p.position} · {p.team ?? "—"}</div>
                </div>
              </div>
              <div className="player-grid-card-value">{Math.round(p.trueValue)}</div>
              <div className="player-row-bar-wrap" aria-hidden="true">
                <div
                  className="player-row-bar"
                  style={{ ["--bar-w" as string]: `${Math.round((p.trueValue / maxVal) * 100)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Update the call site in `PlayerUniverse` JSX to pass `allPlayers={players}`:
```tsx
<GalaxyView
  players={filtered}
  allPlayers={players}
  selectedIdx={selectedIdx}
  onSelect={setSelectedIdx}
/>
```

Also remove the `<select className="galaxy-select" defaultValue="GALAXY VIEW">` control — it no longer makes sense (was a view-mode toggle for the 3-D scene). Keep the search input.

- [ ] **Step B2-2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step B2-3: Commit**

```bash
git add src/components/panels/PlayerUniverse.tsx
git commit -m "Player Universe: replace 3-D galaxy with 2-D player grid"
```

---

## Task B3: Replace Narrative Engine 3-D with a 2-D narrative pressure bar list

**Files:**
- Modify: `src/components/panels/NarrativeEngine.tsx`

- [ ] **Step B3-1: Replace `NarrativeFlowField` with a 2-D bar chart**

Remove these imports:
```tsx
import { Canvas3D } from "../three/Canvas3D";
import { NarrativeField } from "../three/scenes/NarrativeField";
```

Add:
```tsx
import { PlayerRow } from "../PlayerRow";
```

Replace the entire `NarrativeFlowField` function with:
```tsx
function NarrativeFlowField({ players }: { players: PlayerMarketRecord[] }) {
  if (players.length === 0) {
    return <div className="empty-state"><b>No narrative data</b></div>;
  }
  // Sort by absolute narrative pressure (highest impact first)
  const sorted = [...players]
    .sort((a, b) => Math.abs(b.narrativePressure) - Math.abs(a.narrativePressure));
  const maxAbs = Math.max(...sorted.map((p) => Math.abs(p.narrativePressure)), 1);

  return (
    <div
      className="narrative-flow-svg"
      aria-label="Narrative pressure bar chart — players ranked by narrative impact"
    >
      <div className="section-label" style={{ padding: "8px 10px 4px" }}>NARRATIVE PRESSURE — by player</div>
      <div className="narrative-bar-list" style={{ padding: "0 10px 8px" }}>
        {sorted.map((p) => {
          const val = p.narrativePressure;
          const barPct = Math.round((Math.abs(val) / maxAbs) * 100);
          const isPositive = val >= 0;
          return (
            <div key={p.id} className="narrative-bar-row">
              <span className="narrative-bar-row-label" title={p.name}>
                {p.name}
              </span>
              <div className="narrative-bar-track">
                <div
                  className="narrative-bar-fill"
                  style={{
                    ["--bar-w" as string]: `${barPct}%`,
                    background: isPositive ? "var(--green)" : "var(--red)",
                  }}
                  aria-label={`${p.name} narrative pressure: ${val}`}
                />
              </div>
              <span
                className="narrative-bar-val"
                style={{ color: isPositive ? "var(--green)" : "var(--red)" }}
              >
                {isPositive ? "+" : ""}{Math.round(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step B3-2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step B3-3: Commit**

```bash
git add src/components/panels/NarrativeEngine.tsx
git commit -m "Narrative Engine: replace 3-D flow field with 2-D narrative pressure bar list"
```

---

## Task B4: Replace Market Intelligence `LiquidityFlow` 3-D with a 2-D bar chart

**Files:**
- Modify: `src/components/panels/MarketIntelligence.tsx`

- [ ] **Step B4-1: Replace the `LiquidityFlow` sub-view's `Canvas3D` with a 2-D BarChart**

Remove these imports:
```tsx
import { Canvas3D } from "../three/Canvas3D";
import { LiquidityFlow as LiquidityFlowScene } from "../three/scenes/LiquidityFlow";
```

Keep the `VolatilitySurfaceScene` import (it's still used in the Trends tab).

The existing `BarChart` is already imported via `@/components/charts/BarChart`. If not yet imported, add:
```tsx
import { BarChart } from "@/components/charts/BarChart";
```

Replace the entire `LiquidityFlow` function with:
```tsx
function LiquidityFlow({ players }: { players: PlayerMarketRecord[] }) {
  if (players.length === 0) {
    return <div className="empty-state"><b>No data</b></div>;
  }
  // Sort by opportunity (proxy for liquidity/market activity)
  const sorted = [...players]
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 12);
  const items = sorted.map((p) => ({
    label: p.name.split(" ").pop() ?? p.name,
    value: Math.round(p.opportunity),
    color: p.opportunity > 70 ? "var(--green)" : p.opportunity > 40 ? "var(--amber)" : "var(--muted)",
  }));

  return (
    <div className="liquidity-flow-wrap">
      <div className="section-label">LIQUIDITY FLOW — Players by Opportunity</div>
      <div className="flow-legend">
        <span className="legend-dot" style={{ background: "var(--green)" }} /> High Opportunity
        <span className="legend-dot" style={{ background: "var(--amber)", marginLeft: 12 }} /> Moderate
        <span className="legend-dot" style={{ background: "var(--muted)", marginLeft: 12 }} /> Low
      </div>
      <BarChart items={items} max={100} />
      <div className="small-note" style={{ marginTop: 6 }}>
        Bar length = opportunity score (0–100). Green = high-liquidity / high-upside players.
      </div>
    </div>
  );
}
```

- [ ] **Step B4-2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step B4-3: Commit**

```bash
git add src/components/panels/MarketIntelligence.tsx
git commit -m "Market Intelligence: replace LiquidityFlow 3-D scene with 2-D opportunity bar chart"
```

---

## Task B5: Replace Draft Intelligence `DraftMultiverse` tab with a 2-D draft board

**Files:**
- Modify: `src/components/panels/DraftIntelligence.tsx`

- [ ] **Step B5-1: Replace the Multiverse tab's `Canvas3D` with a 2-D recommendation bar list**

Remove these imports:
```tsx
import { Canvas3D } from "../three/Canvas3D";
import { DraftMultiverse } from "../three/scenes/DraftMultiverse";
```

Replace the Multiverse tab block (inside `DraftIntelligence`'s return JSX) from:
```tsx
{activeTab === "Multiverse" && (
  <div className="multiverse-wrap">
    <div className="section-label">DRAFT MULTIVERSE</div>
    <Canvas3D
      ariaLabel="3-D draft branching paths weighted by branch probability"
      height={260}
    >
      <DraftMultiverse />
    </Canvas3D>
    <p className="muted-note" style={{ marginTop: 6 }}>
      Tube color and thickness encode branch probability and projected roster delta...
    </p>
  </div>
)}
```

...to:
```tsx
{activeTab === "Multiverse" && (
  <DraftBoardView recommendations={recommendations} />
)}
```

Add the new component at the bottom of the file:
```tsx
function DraftBoardView({ recommendations }: { recommendations: Recommendation[] }) {
  const maxScore = Math.max(...recommendations.map((r) => r.score), 1);
  return (
    <div className="multiverse-wrap">
      <div className="section-label">DRAFT RECOMMENDATION BOARD</div>
      {recommendations.length === 0 ? (
        <p className="draft-board-empty">No recommendations yet — draft players on the Live Board to populate this view.</p>
      ) : (
        <ol className="draft-board-list" aria-label="Draft recommendation board ranked by score">
          {recommendations.map((rec, idx) => (
            <li key={rec.player.id} className="draft-board-row">
              <span className="draft-board-rank">{idx + 1}</span>
              <span className="draft-board-name" title={rec.player.name}>
                {rec.player.name}
              </span>
              <span className="pos-badge" data-pos={rec.player.position.toLowerCase()}>
                {rec.player.position}
              </span>
              <span className="draft-board-category">{rec.category}</span>
              <div className="draft-board-bar-wrap" aria-hidden="true">
                <div
                  className="draft-board-bar"
                  style={{ ["--bar-w" as string]: `${Math.round((rec.score / maxScore) * 100)}%` }}
                />
              </div>
              <span className="draft-board-score">{rec.score}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="small-note" style={{ marginTop: 8 }}>
        Ranked by composite draft score. Category labels: VALUE = underpriced opportunity, NEED = positional gap, UPSIDE = high-ceiling picks.
      </p>
    </div>
  );
}
```

- [ ] **Step B5-2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step B5-3: Commit**

```bash
git add src/components/panels/DraftIntelligence.tsx
git commit -m "Draft Intelligence: replace DraftMultiverse 3-D scene with 2-D draft board"
```

---

## Task C: Improve the 3-D Volatility Surface with labeled axes and legend

**Files:**
- Modify: `src/components/three/scenes/VolatilitySurface.tsx`
- Modify: `src/components/panels/MarketIntelligence.tsx` (improve the `VolatilitySurface` wrapper)
- Modify: `src/components/panels/NexusSimulator.tsx` (verify the wrapper is adequate — no Canvas3D changes needed)

- [ ] **Step C1: Add camera props to `Canvas3D` call in MarketIntelligence's `VolatilitySurface` wrapper**

In `src/components/panels/MarketIntelligence.tsx`, find the `VolatilitySurface` function (the local wrapper, not the scene). Update it to:

```tsx
function VolatilitySurface({ players }: { players: PlayerMarketRecord[] }) {
  const sim = runNexusSimulation(players, { seed: 20260513, iterations: 1000, rosterSlots: 6, riskTolerance: 0.5 });
  return (
    <div className="chart-wrap vol-surface-wrap">
      <div className="section-label">VOLATILITY SURFACE — Outcome Probability Landscape</div>
      {/* HTML axis labels sit outside the canvas so they are always crisp */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Canvas3D
            ariaLabel="3-D volatility surface: height and color encode outcome probability across a risk landscape"
            height={220}
            cameraPosition={[0, 3.5, 5.5]}
            cameraFov={45}
          >
            <VolatilitySurfaceScene sim={sim} />
          </Canvas3D>
          <div className="vol-axis-labels">
            <span>Low Risk →</span>
            <span>Risk Axis (Catastrophic ↑)</span>
            <span>→ High Risk</span>
          </div>
        </div>
      </div>
      <div className="vol-surface-legend">
        <span style={{ color: "#7dd3fc" }}>■</span> Low outcome probability (valley)
        <span style={{ color: "#9b7fe8", marginLeft: 10 }}>■</span> Mid-range
        <span style={{ color: "#fbbf24", marginLeft: 10 }}>■</span> High outcome probability (peak)
      </div>
      <div className="vol-surface-caption">
        <strong>Reading this surface:</strong> Height = outcome probability. Color: cyan = low, purple = mid, amber = high.
        X-axis = playoff probability; Y-axis = catastrophic risk exposure.
        Peaks (amber) mark scenarios where your roster has the highest probability of a positive outcome.
      </div>
    </div>
  );
}
```

- [ ] **Step C2: Update `VolatilitySurface` scene to use a better default camera angle and add axis grid labels**

In `src/components/three/scenes/VolatilitySurface.tsx`, update the scene to use a slightly better default rotation and add labeled axis lines via HTML5 Canvas overlay (achieved by adjusting the scene mesh rotation to be more legible):

Change the mesh rotation from `-Math.PI / 3` to `-Math.PI / 4` for a more face-on perspective:

```tsx
// In the return JSX, change:
<mesh ref={meshRef} rotation={[-Math.PI / 3, 0, 0]} position={[0, -0.25, 0]}>
// to:
<mesh ref={meshRef} rotation={[-Math.PI / 4, 0.15, 0]} position={[0, -0.4, 0]}>
```

And update the wireframe to match:
```tsx
// Change:
<mesh ref={wireRef} rotation={[-Math.PI / 3, 0, 0]} position={[0, -0.245, 0]}>
// to:
<mesh ref={wireRef} rotation={[-Math.PI / 4, 0.15, 0]} position={[0, -0.395, 0]}>
```

Also reduce the subtle rotation animation to keep it mostly still (informative, not decorative):
```tsx
// In useFrame, change:
if (meshRef.current) meshRef.current.rotation.z = Math.sin(t * 0.1) * 0.04;
if (wireRef.current) wireRef.current.rotation.z = Math.sin(t * 0.1) * 0.04;
// to (keep x/y fixed, only z sways gently):
if (meshRef.current) {
  meshRef.current.rotation.x = -Math.PI / 4;
  meshRef.current.rotation.y = 0.15 + Math.sin(t * 0.08) * 0.04;
}
if (wireRef.current) {
  wireRef.current.rotation.x = -Math.PI / 4;
  wireRef.current.rotation.y = 0.15 + Math.sin(t * 0.08) * 0.04;
}
```

- [ ] **Step C3: Verify the NexusSimulator wrapper still works**

Open `src/components/panels/NexusSimulator.tsx`. The `OutcomeMultiverse` function already wraps `<Canvas3D><VolatilitySurface/></Canvas3D>` above the SVG multiverse chart. No change needed — the caption is provided by the HTML below the canvas. Optionally add a tiny caption below the Canvas3D block to confirm it reads as a graph:

```tsx
// After the </Canvas3D> closing tag inside OutcomeMultiverse, add:
<div className="vol-surface-caption" style={{ fontSize: 9, padding: "4px 0 0" }}>
  <strong>Outcome surface:</strong> Height = probability. Amber peaks = highest-probability outcome zones.
</div>
```

- [ ] **Step C4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step C5: Commit**

```bash
git add src/components/three/scenes/VolatilitySurface.tsx \
        src/components/panels/MarketIntelligence.tsx \
        src/components/panels/NexusSimulator.tsx
git commit -m "Improve VolatilitySurface: labeled axes, legend, better camera angle"
```

---

## Task D: Delete unused 3-D scenes and trim the WebGL layer

**Files:**
- Delete: `src/components/three/scenes/OrbitalTopology.tsx`
- Delete: `src/components/three/scenes/PlayerGalaxy.tsx`
- Delete: `src/components/three/scenes/NarrativeField.tsx`
- Delete: `src/components/three/scenes/LiquidityFlow.tsx`
- Delete: `src/components/three/scenes/DraftMultiverse.tsx`
- Delete: `src/components/three/HeadshotBillboard.tsx`
- Delete: `src/components/three/shaders/flowMaterial.ts`
- Modify: `src/app/globals.css` (remove dead scene-specific CSS)

- [ ] **Step D1: Grep to confirm no kept file imports the files to be deleted**

```bash
grep -r "OrbitalTopology\|PlayerGalaxy\|NarrativeField\|LiquidityFlow\|DraftMultiverse\|HeadshotBillboard\|flowMaterial" \
  src/ --include="*.ts" --include="*.tsx" -l
```

Expected output: only the files themselves (or nothing after their imports were already removed in Tasks B2–B5). If any unexpected file appears, fix it before deleting.

Also verify `surfaceMaterial` is still imported by the kept `VolatilitySurface.tsx`:
```bash
grep -r "surfaceMaterial" src/ --include="*.ts" --include="*.tsx"
```

Expected: `src/components/three/scenes/VolatilitySurface.tsx` and `src/components/three/shaders/surfaceMaterial.ts`.

- [ ] **Step D2: Delete the scene files**

```bash
rm src/components/three/scenes/OrbitalTopology.tsx
rm src/components/three/scenes/PlayerGalaxy.tsx
rm src/components/three/scenes/NarrativeField.tsx
rm src/components/three/scenes/LiquidityFlow.tsx
rm src/components/three/scenes/DraftMultiverse.tsx
rm src/components/three/HeadshotBillboard.tsx
rm src/components/three/shaders/flowMaterial.ts
```

- [ ] **Step D3: Remove dead WebGL/scene CSS from `globals.css`**

The following CSS rules are specific to the deleted 3-D scenes and should be removed from `src/app/globals.css`:

Search for and remove these rules:
- `.star { animation: star-twinkle ... }` (used by old galaxy SVG stars — the galaxy view is gone)
- `@keyframes star-twinkle` (same)
- `@keyframes flow-particle` (used by the old flow particles — scenes deleted)
- `@keyframes node-glow` (used by `.pulse-node` — scene deleted)
- `.pulse-node { animation: node-glow ... }` (scene deleted)
- `.galaxy-field` CSS block — the class is now repurposed as a plain container; keep the block but remove the `background: #0a0c0f` and `min-height: 320px` if they are no longer needed (the player-grid sits inside a regular div now). Actually: the `.galaxy-field` class is NOT used by the new code — Task B2 wraps in a plain `<div>` with no class. Remove `.galaxy-field` entirely.

Keep:
- `.scene-fallback`, `.scene-fallback-mark`, `.scene-fallback-text` — still used by `SceneErrorBoundary` for `VolatilitySurface`.
- All other classes (leaderboard, player-grid, etc. added in Task A).

The rules to surgically remove:
```
.pulse-node { animation: node-glow 2.8s ease-in-out infinite; }
.galaxy-field { ... }  (the whole block)
.star { animation: star-twinkle 3s ease-in-out infinite; }
@keyframes node-glow { ... }
@keyframes star-twinkle { ... }
@keyframes flow-particle { ... }
```

- [ ] **Step D4: Verify TypeScript compiles with 0 errors**

```bash
npx tsc --noEmit
```

Expected: 0 errors (no dangling imports to deleted files).

- [ ] **Step D5: Commit**

```bash
git add -A
git commit -m "Remove unused 3-D scenes, HeadshotBillboard, flowMaterial shader, and dead CSS"
```

---

## Task E: Fix tests

**Files:**
- Modify: `e2e/01-dashboard.spec.ts`
- Review: `e2e/04-draft-and-lifecycle.spec.ts` (likely no changes needed)
- Review: `src/lib/visualContract.test.ts` (no changes needed — tests only check data contracts)
- Review: `src/lib/derivedMetrics.stats.test.ts` (no changes needed)

- [ ] **Step E1: Rewrite the stale canvas/scene assertions in `e2e/01-dashboard.spec.ts`**

The test currently asserts:
- `canvas` elements are visible and count ≥ 1 (at page root, many scenes)
- `canvas, .scene-fallback` count ≥ 4 (many scenes on default tabs)
- Each of `command-center`, `player-universe`, `narrative-engine`, `nexus-simulator` has a visible `canvas, .scene-fallback`

After Phase 2, only `VolatilitySurface` remains as a canvas, and it is **tab-gated** (in Market Intelligence's "Trends" tab and Nexus Simulator's "Multiverse" tab). The default tab for both panels does NOT show a canvas. So the canvas assertions need to be updated.

Replace the entire first test in `e2e/01-dashboard.spec.ts` with:

```typescript
test("homepage renders the 9-system nav and 2-D player views without crashing", async ({ page }) => {
  await page.goto("/");

  // The page must NOT fall back to Next.js's global error boundary.
  await expect(page.locator("html#__next_error__")).toHaveCount(0);

  const nav = page.locator('nav[aria-label="Top-level systems"]');
  await expect(nav).toBeVisible();
  const tabs = nav.locator("button");
  await expect(tabs).toHaveCount(9);

  // Command Center: LeaguePulse must show player names in the leaderboard.
  const commandCenter = page.locator("#command-center");
  await commandCenter.scrollIntoViewIfNeeded();
  // The leaderboard renders player names — verify at least one row is present.
  await expect(commandCenter.locator(".leaderboard-list")).toBeVisible({ timeout: 15_000 });
  await expect(commandCenter.locator(".leaderboard-row").first()).toBeVisible({ timeout: 15_000 });

  // Player Universe: player grid must render player cards.
  const playerUniverse = page.locator("#player-universe");
  await playerUniverse.scrollIntoViewIfNeeded();
  await expect(playerUniverse.locator(".player-grid")).toBeVisible({ timeout: 15_000 });
  await expect(playerUniverse.locator(".player-grid-card").first()).toBeVisible({ timeout: 15_000 });

  // Narrative Engine: narrative bar list must render with player names.
  const narrativeEngine = page.locator("#narrative-engine");
  await narrativeEngine.scrollIntoViewIfNeeded();
  await expect(narrativeEngine.locator(".narrative-bar-list")).toBeVisible({ timeout: 15_000 });

  // Nexus Simulator: the Multiverse tab must show the SVG outcome chart.
  const nexus = page.locator("#nexus-simulator");
  await nexus.scrollIntoViewIfNeeded();
  await expect(nexus.locator("svg").first()).toBeVisible({ timeout: 15_000 });

  // Only one WebGL surface remains (VolatilitySurface), and it is tab-gated.
  // On the default page state, zero canvas elements should be visible.
  // (If a canvas is somehow visible it means a scene wasn't removed — check.)
  const visibleCanvases = await page.locator("canvas:visible").count();
  expect(visibleCanvases).toBe(0);
});
```

- [ ] **Step E2: Verify `e2e/04-draft-and-lifecycle.spec.ts` has no stale scene references**

Read the file — it already asserts on text content and table rows, not on canvas/scene presence. No changes needed. But verify by grepping:

```bash
grep -n "canvas\|scene\|3-D\|WebGL\|galaxy\|multiverse\|DraftMultiverse" e2e/04-draft-and-lifecycle.spec.ts
```

Expected: no matches (if matches found, investigate and update as needed).

- [ ] **Step E3: Run vitest**

```bash
npx vitest run
```

Expected: all tests pass. The deleted scenes have no vitest tests. The `visualContract.test.ts` and `derivedMetrics.stats.test.ts` test only data/logic — unaffected.

If any test imports a deleted file, fix the import.

- [ ] **Step E4: Commit**

```bash
git add e2e/01-dashboard.spec.ts
git commit -m "Fix e2e test: update WebGL canvas assertions for 2-D panels; only VolatilitySurface canvas remains"
```

---

## Task F: Final verification gate

- [ ] **Step F1: TypeScript**

```bash
npx tsc --noEmit
```

Expected: `Found 0 errors.`

- [ ] **Step F2: ESLint**

```bash
npx eslint .
```

Expected: 0 errors, 0 warnings. Common violations to watch for:
- `react-hooks/exhaustive-deps` — every `useMemo`/`useCallback`/`useEffect` must declare its deps
- `react-hooks/rules-of-hooks` — no hooks inside callbacks or conditionals
- `no-unused-vars` — imported names from deleted scenes (caught by TS already, but ESLint may also flag)

- [ ] **Step F3: Vitest**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step F4: Next.js build**

```bash
npx next build
```

Expected: clean build, no "Module not found" errors, no "Type error" output.

- [ ] **Step F5: Final commit (if any stragglers)**

If any files were tweaked during the gate runs, commit them:

```bash
git add -A
git commit -m "Phase 2 gate fixes: tsc/eslint/vitest/build clean"
```

---

## Self-Review Against Spec

**Spec requirement → task mapping:**

| Spec requirement | Task |
|---|---|
| Task A: Create `PlayerRow.tsx` shared component | Task A |
| CommandCenter `LeaguePulse` → player leaderboard with `PlayerRow` | B1 |
| CommandCenter: reconcile stray partial edit, no inline `PositionBadge` | B1 |
| PlayerUniverse `GalaxyView` → player grid, keep selectedIdx→sidebar | B2 |
| NarrativeEngine `NarrativeFlowField` → 2-D bar list by `narrativePressure` | B3 |
| MarketIntelligence `LiquidityFlow` sub-view → 2-D BarChart by `opportunity` | B4 |
| DraftIntelligence Multiverse tab → labeled bar list of recommendation queue | B5 |
| Keep `VolatilitySurface` 3-D; add labeled axes, legend, caption | C |
| Delete 5 scenes + HeadshotBillboard + flowMaterial | D2 |
| Grep imports before deleting | D1 |
| Remove dead WebGL/scene CSS; keep `.scene-fallback*` | D3 |
| Fix `e2e/01-dashboard.spec.ts` canvas assertions | E1 |
| Check `e2e/04-draft-and-lifecycle.spec.ts` | E2 |
| `tsc --noEmit` 0 errors | F1 |
| `eslint` 0 errors | F2 |
| `vitest run` all pass | F3 |
| `next build` clean | F4 |

**No gaps found.** All spec requirements are covered by tasks above.
