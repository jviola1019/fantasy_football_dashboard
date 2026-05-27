import type { PlayerMarketRecord } from "../governance";
import { reputationEdge } from "../models";
import { tiersByPosition } from "./tiers";

export type RecommendationCategory = "Value" | "Need" | "Stash" | "Run";

export interface Recommendation {
  player: PlayerMarketRecord;
  category: RecommendationCategory;
  score: number;
  reasons: string[];
}

export interface RecommendInput {
  available: PlayerMarketRecord[];
  myRoster: PlayerMarketRecord[];
  /** Pick number you are on (1-indexed). */
  picksRemaining?: number;
  /** Roster slot targets, e.g. { QB: 1, RB: 2, WR: 3, TE: 1 }. */
  targets?: Partial<Record<PlayerMarketRecord["position"], number>>;
}

const DEFAULT_TARGETS: Record<PlayerMarketRecord["position"], number> = {
  QB: 1,
  RB: 4,
  WR: 5,
  TE: 1,
  K: 1,
  DEF: 1
};

export function recommend(input: RecommendInput, limit = 10): Recommendation[] {
  const targets = { ...DEFAULT_TARGETS, ...(input.targets ?? {}) };
  const myCounts = countByPosition(input.myRoster);
  const tiers = tiersByPosition(input.available);
  const lastInTier = new Map<string, PlayerMarketRecord>();
  for (const tier of tiers) {
    if (tier.players.length === 1 && tier.cliff >= 6) {
      lastInTier.set(tier.players[0]!.id, tier.players[0]!);
    } else if (tier.players.length > 0) {
      const tail = tier.players[tier.players.length - 1]!;
      if (tier.cliff >= 6) lastInTier.set(tail.id, tail);
    }
  }

  return input.available
    .map((player) => {
      const reasons: string[] = [];
      const have = myCounts[player.position] ?? 0;
      const need = Math.max(0, (targets[player.position] ?? 0) - have);
      const edge = reputationEdge(player);
      const opportunity = player.opportunity;
      const fragilityPenalty = player.fragility * 0.25;

      let score = edge * 1.5 + opportunity * 0.6 - fragilityPenalty;
      let category: RecommendationCategory = "Value";

      if (need > 0) {
        score += need * 8;
        reasons.push(`fills ${player.position} need (have ${have}, target ${targets[player.position] ?? 0})`);
        category = "Need";
      }

      if (lastInTier.has(player.id)) {
        score += 12;
        reasons.push("last in tier — run risk");
        category = "Run";
      } else if (have >= (targets[player.position] ?? 0)) {
        category = "Stash";
        reasons.push("depth pick / stash");
      } else if (edge > 8) {
        category = "Value";
        reasons.push(`reputation edge +${edge.toFixed(1)}`);
      }

      if (player.trendingMomentum > 30) reasons.push(`trending tailwind +${player.trendingMomentum}`);
      if (player.fragility > 60) reasons.push(`fragility ${player.fragility} — discount applied`);

      return {
        player,
        category,
        score: Math.round(score * 10) / 10,
        reasons
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function countByPosition(players: PlayerMarketRecord[]): Record<PlayerMarketRecord["position"], number> {
  const counts: Record<PlayerMarketRecord["position"], number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0
  };
  for (const p of players) counts[p.position] += 1;
  return counts;
}
