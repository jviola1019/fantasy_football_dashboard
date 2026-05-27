"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { PlayerHeadshot } from "./PlayerHeadshot";
import { fixtureHeadshotFallbacks } from "@/lib/fixtures";

interface PlayerRowProps {
  player: PlayerMarketRecord;
  /** Numeric or string value displayed on the right (e.g. trueValue, trendingMomentum). */
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
 * Layout: [headshot] [name + badge + team + optional bar] [metric]
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
