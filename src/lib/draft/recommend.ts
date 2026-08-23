import type { PlayerMarketRecord } from "../governance";
import type { LeagueFormat } from "../trade/format";
import { scarcityGap } from "../models";
import { tiersByPosition } from "./tiers";
import { targetsFromFormat } from "./rosterTargets";

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
  /**
   * The connected league's format. When present, targets are DERIVED from its
   * real starting lineup (audit F-010) — superflex raises the QB target, a 2-TE
   * league raises TE, and roster size sizes the bench. An explicit `targets`
   * still wins, and with neither we fall back to the documented default below.
   */
  format?: LeagueFormat | null;
}

/**
 * Fallback ONLY for when no league is connected (the fixture/demo pool). It
 * describes a 12-team, 1QB, PPR league and must never be treated as universal:
 * it was previously the unconditional value for every league, which is exactly
 * what audit F-010 flagged.
 */
const DEFAULT_TARGETS: Record<PlayerMarketRecord["position"], number> = {
  QB: 1,
  RB: 4,
  WR: 5,
  TE: 1,
  K: 1,
  DEF: 1
};

// Positions that are low-leverage and should be drafted LATE — never before the
// core starters are essentially set. A kicker or defense taken early is wasted
// draft capital.
const LATE_ONLY = new Set<PlayerMarketRecord["position"]>(["K", "DEF"]);
const CORE_POSITIONS: ReadonlyArray<PlayerMarketRecord["position"]> = ["QB", "RB", "WR", "TE"];

export function recommend(input: RecommendInput, limit = 10): Recommendation[] {
  const base = input.format ? targetsFromFormat(input.format) : DEFAULT_TARGETS;
  const targets = { ...base, ...(input.targets ?? {}) };
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

  // Unfilled core (QB/RB/WR/TE) starter slots — the round-awareness signal. An
  // empty roster has high coreRemaining (draft skill players); a nearly-set
  // roster has ~0 (now K/DEF become sensible). Works for any roster size without
  // hardcoding round numbers.
  // How many players you already hold at each (position, bye week). Built once
  // rather than per candidate.
  const byeCounts = new Map<string, number>();
  for (const p of input.myRoster) {
    if (p.byeWeek == null) continue;
    const key = `${p.position}:${p.byeWeek}`;
    byeCounts.set(key, (byeCounts.get(key) ?? 0) + 1);
  }

  const coreRemaining = CORE_POSITIONS.reduce(
    (s, pos) => s + Math.max(0, (targets[pos] ?? 0) - (myCounts[pos] ?? 0)),
    0
  );

  return input.available
    .map((player) => {
      const reasons: string[] = [];
      const have = myCounts[player.position] ?? 0;
      const need = Math.max(0, (targets[player.position] ?? 0) - have);
      const edge = scarcityGap(player);
      const opportunity = player.opportunity;
      const fragilityPenalty = player.fragility * 0.25;

      let score = edge * 1.5 + opportunity * 0.6 - fragilityPenalty;
      let category: RecommendationCategory = "Value";

      if (LATE_ONLY.has(player.position)) {
        // Bury K/DEF behind every startable skill player until the core roster
        // is essentially complete (coreRemaining <= 1). Kickers are lowest
        // leverage even once needed.
        if (coreRemaining > 1) {
          score -= 100;
          category = "Stash";
          reasons.push(`hold ${player.position} — fill your starters first (${coreRemaining} core slots open)`);
        } else if (need > 0) {
          score += 4;
          category = "Need";
          reasons.push(`fill ${player.position} — rosters nearly set`);
        } else {
          category = "Stash";
          reasons.push("depth pick / stash");
        }
        if (player.position === "K") score -= 4; // kickers are near-fungible
      } else {
        // Core positions: standard need-weighted scoring.
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
          reasons.push(`scarcity gap +${edge.toFixed(1)}`);
        }
      }

      if (player.trendingMomentum > 30) reasons.push(`trending tailwind +${player.trendingMomentum}`);
      if (player.fragility > 60) reasons.push(`fragility ${player.fragility} — discount applied`);

      // Bye-week stacking (audit 2026-08-23). Two starters at the same position
      // off in the same week means an empty slot that week -- a real cost the
      // value columns cannot show.
      //
      // The penalty is SMALL and always accompanied by a stated reason. A
      // stacked bye is one bad week, not a bad player, and burying a
      // significantly better player over it would be the model overruling the
      // drafter on a judgement that is theirs. It is surfaced, then weighted
      // gently.
      //
      // A null bye never stacks: unknown is not equal to unknown.
      const stacked = player.byeWeek == null ? 0 : (byeCounts.get(`${player.position}:${player.byeWeek}`) ?? 0);
      if (stacked > 0) {
        score -= 3;
        reasons.push(
          `bye week ${player.byeWeek} clashes with ${stacked} ${player.position} you already hold`
        );
      }

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
