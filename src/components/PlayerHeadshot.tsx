"use client";

import Image from "next/image";
import { useState } from "react";
import type { PlayerMarketRecord } from "@/lib/governance";

interface Props {
  player: Pick<PlayerMarketRecord, "id" | "name" | "imageUrl" | "imageSource">;
  /** Additional fallback URLs to try if `player.imageUrl` fails to load. */
  fallbacks?: string[];
  size?: number;
  className?: string;
}

/**
 * Player headshot with cascading source fallback.
 *
 *   1. Try `player.imageUrl` (the canonical primary — Sleeper CDN for fixture
 *      and Sleeper-platform records, ESPN CDN for ESPN-platform records).
 *   2. If that 404s, advance to each `fallbacks` URL in order.
 *   3. When every source has failed, render a deterministic initials avatar.
 *
 * We never silently render the wrong player's face: the avatar is derived
 * solely from the player's own `name`, and we never substitute an unrelated
 * image.
 */
export function PlayerHeadshot({ player, fallbacks = [], size = 48, className }: Props) {
  const sources = [player.imageUrl, ...fallbacks].filter((s): s is string => Boolean(s));
  const [sourceIdx, setSourceIdx] = useState(0);
  const exhausted = sources.length === 0 || sourceIdx >= sources.length;

  const initials = player.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (exhausted) {
    return (
      <span
        className={`player-headshot-fallback${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size }}
        aria-label={`${player.name} headshot (unavailable)`}
      >
        {initials}
      </span>
    );
  }

  const current = sources[sourceIdx]!;

  return (
    <Image
      key={current}
      src={current}
      alt={`${player.name} headshot`}
      width={size}
      height={size}
      className={`player-headshot${className ? ` ${className}` : ""}`}
      onError={() => setSourceIdx((i) => i + 1)}
      unoptimized={false}
    />
  );
}
