import type { PlayerMarketRecord } from "../governance";

export interface Tier {
  position: PlayerMarketRecord["position"];
  rank: number;
  players: PlayerMarketRecord[];
  /** Drop in trueValue from this tier's median to the next tier's median. */
  cliff: number;
}

const TIER_GAP_THRESHOLD = 6;

export function tiersByPosition(players: PlayerMarketRecord[]): Tier[] {
  const tiers: Tier[] = [];
  const positions: Array<PlayerMarketRecord["position"]> = ["QB", "RB", "WR", "TE", "K", "DEF"];

  for (const position of positions) {
    const ranked = players
      .filter((p) => p.position === position)
      .sort((a, b) => b.trueValue - a.trueValue);
    if (ranked.length === 0) continue;

    let currentTier: PlayerMarketRecord[] = [];
    let rankCounter = 1;

    for (let i = 0; i < ranked.length; i++) {
      const current = ranked[i]!;
      currentTier.push(current);
      const next = ranked[i + 1];
      const gap = next ? current.trueValue - next.trueValue : Infinity;
      if (gap >= TIER_GAP_THRESHOLD || !next) {
        tiers.push({
          position,
          rank: rankCounter,
          players: currentTier,
          cliff: next ? gap : 0
        });
        rankCounter += 1;
        currentTier = [];
      }
    }
  }

  return tiers;
}

export interface TierCollapseSignal {
  position: PlayerMarketRecord["position"];
  tierRank: number;
  remaining: number;
  cliff: number;
  /** 0..1 — how close this tier is to a hard break. */
  intensity: number;
}

export function tierCollapseSignals(tiers: Tier[]): TierCollapseSignal[] {
  return tiers.map((t) => ({
    position: t.position,
    tierRank: t.rank,
    remaining: t.players.length,
    cliff: t.cliff,
    intensity: Math.min(1, Math.max(0, t.cliff / 20))
  }));
}
