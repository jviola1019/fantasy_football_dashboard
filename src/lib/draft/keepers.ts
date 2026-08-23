import type { PlayerMarketRecord } from "../governance";
import type { LeagueFormat } from "../trade/format";

/**
 * Keeper evaluation (audit 2026-08-06 F-010).
 *
 * The question a keeper league actually asks is not "who is my best player" but
 * "is this player worth more than the pick I give up for him". Those differ
 * sharply: an elite player at a first-round cost is often a *wash*, while a
 * good player at a late-round cost is where leagues are won.
 *
 * This module therefore prices a keeper as SURPLUS — the player's value minus
 * the value of the pick it costs — and refuses to answer at all when the cost
 * rule is unknown. Neither ESPN nor Sleeper publishes the cost rule (verified
 * against a real ESPN keeper league: the entire draftSettings payload contains
 * keeperCount and keeperOrderType but nothing about price), so it is a league
 * convention that an owner must confirm. Guessing it would be worse than
 * silence, because a keeper decision is irreversible for the season.
 */

export type KeeperVerdict = "keep" | "lean-keep" | "borderline" | "pass";

export interface KeeperCandidate {
  player: PlayerMarketRecord;
  /** Round this keeper would cost. */
  costRound: number;
  /** Overall pick the cost round equates to, at this roster's slot. */
  costPickOverall: number;
  /** Value of the player, on the same scale as the board. */
  playerValue: number;
  /** Value the forfeited pick would realistically have returned. */
  pickValue: number;
  /** playerValue - pickValue. Positive means the keep gains you value. */
  surplus: number;
  verdict: KeeperVerdict;
  reasons: string[];
}

export type KeeperAnalysis =
  | {
      status: "unavailable";
      /** Machine-readable so the UI can prompt for exactly what is missing. */
      reason: "not-a-keeper-league" | "cost-rule-unconfirmed" | "no-roster" | "no-board";
      detail: string;
    }
  | {
      status: "ok";
      keeperCount: number;
      candidates: KeeperCandidate[];
      /** The candidates that fit within keeperCount, best surplus first. */
      recommended: KeeperCandidate[];
      /** True when NO candidate has positive surplus — keeping nothing is right. */
      keepNobody: boolean;
      assumptions: string[];
    };

export interface KeeperInput {
  /** The manager's current roster. */
  roster: readonly PlayerMarketRecord[];
  /**
   * The draftable board, best-first. Used to price a pick: the value of pick N
   * is what the board actually offers at N, not a theoretical curve.
   */
  board: readonly PlayerMarketRecord[];
  format: LeagueFormat;
  /**
   * Where this manager picks in round 1 (1-indexed). Needed to convert a cost
   * ROUND into an overall pick. When unknown, the middle of the round is used
   * and that is declared as an assumption rather than hidden.
   */
  draftSlot?: number | null;
  /** Per-player cost rounds, for rules where cost varies by player. */
  costRoundByPlayerId?: Readonly<Record<string, number>>;
}

/** Overall pick number for a snake draft. */
export function snakePickOverall(round: number, slot: number, numTeams: number): number {
  const isReverse = round % 2 === 0;
  const slotThisRound = isReverse ? numTeams - slot + 1 : slot;
  return (round - 1) * numTeams + slotThisRound;
}

/**
 * What a pick is worth: the value of the best player still expected on the
 * board at that overall pick. Using the real board rather than a generic pick
 * chart keeps this honest for THIS league's player pool and scoring.
 */
function valueAtPick(board: readonly PlayerMarketRecord[], overall: number): number {
  if (board.length === 0) return 0;
  const idx = Math.min(board.length - 1, Math.max(0, overall - 1));
  return board[idx]!.trueValue;
}

function verdictFor(surplus: number, playerValue: number): KeeperVerdict {
  // Scaled to the value system rather than absolute points, so the thresholds
  // survive a change of value units.
  const scale = Math.max(1, playerValue);
  const pct = surplus / scale;
  if (pct >= 0.2) return "keep";
  if (pct >= 0.08) return "lean-keep";
  if (pct >= -0.05) return "borderline";
  return "pass";
}

export function evaluateKeepers(input: KeeperInput): KeeperAnalysis {
  const { format, roster, board } = input;

  if (format.leagueType !== "keeper" || format.keeperCount <= 0) {
    return {
      status: "unavailable",
      reason: "not-a-keeper-league",
      detail:
        format.leagueType === "dynasty"
          ? "Dynasty league — the whole roster carries over, so there is no keeper decision to make."
          : "This is a redraft league; no players are kept."
    };
  }

  // The fail-closed gate. See the module comment: the cost rule is a league
  // convention neither platform publishes, and a wrong guess is irreversible.
  if (format.keeperCostRule === "unknown") {
    return {
      status: "unavailable",
      reason: "cost-rule-unconfirmed",
      detail:
        "Keeper cost is not published by ESPN or Sleeper — it is a league rule. " +
        "Confirm what keeping a player costs (for example, your first-round pick) " +
        "in league settings, and this will price each candidate against it."
    };
  }
  if (roster.length === 0) {
    return { status: "unavailable", reason: "no-roster", detail: "No roster loaded for this league." };
  }
  if (board.length === 0) {
    return { status: "unavailable", reason: "no-board", detail: "No draftable player board available." };
  }

  const assumptions: string[] = [];
  const numTeams = format.numTeams;
  const slot = input.draftSlot ?? Math.ceil(numTeams / 2);
  if (input.draftSlot == null) {
    assumptions.push(
      `Draft slot unknown — priced from the middle of the round (slot ${slot} of ${numTeams}).`
    );
  }

  const defaultRound = format.keeperCostRound ?? 1;
  if (format.keeperCostRule === "fixed-round" && format.keeperCostRound == null) {
    assumptions.push("Cost round not set; assuming round 1.");
  }

  const candidates: KeeperCandidate[] = roster.map((player) => {
    const costRound =
      input.costRoundByPlayerId?.[player.id] ??
      (format.keeperCostRule === "free" ? Number.POSITIVE_INFINITY : defaultRound);

    // A free keeper forfeits nothing, so its surplus is the whole player value.
    const isFree = format.keeperCostRule === "free";
    const costPickOverall = isFree ? 0 : snakePickOverall(costRound, slot, numTeams);
    const pickValue = isFree ? 0 : valueAtPick(board, costPickOverall);
    const playerValue = player.trueValue;
    const surplus = playerValue - pickValue;

    const reasons: string[] = [];
    if (isFree) {
      reasons.push("Free keeper — no pick forfeited.");
    } else {
      reasons.push(
        `Costs round ${costRound} (overall ~${costPickOverall}), where the board offers ~${pickValue.toFixed(0)}.`
      );
    }
    if (surplus > 0) reasons.push(`Keeps ${surplus.toFixed(0)} more value than the pick returns.`);
    else reasons.push(`The pick is worth ${Math.abs(surplus).toFixed(0)} MORE than the player.`);
    if (player.fragility > 60) reasons.push(`Fragility ${player.fragility} — injury risk on a locked-in slot.`);

    return {
      player,
      costRound: isFree ? 0 : costRound,
      costPickOverall,
      playerValue,
      pickValue,
      surplus: Math.round(surplus * 10) / 10,
      verdict: verdictFor(surplus, playerValue),
      reasons
    };
  });

  candidates.sort((a, b) => b.surplus - a.surplus || b.playerValue - a.playerValue);

  // Only positive-surplus keeps are recommended. Filling every keeper slot just
  // because it exists is how managers hand back value.
  const recommended = candidates.filter((c) => c.surplus > 0).slice(0, format.keeperCount);

  assumptions.push(
    "Pick value is the board's actual player at that overall pick, not a generic pick chart."
  );

  return {
    status: "ok",
    keeperCount: format.keeperCount,
    candidates,
    recommended,
    keepNobody: recommended.length === 0,
    assumptions
  };
}
