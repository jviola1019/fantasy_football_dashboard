import type { PlayerValue } from "./values";
import { evaluateTrade, multiTeamTrade, type TradeVerdict } from "./evaluate";
import { getTransactions, getNflState } from "../sleeper/league";
import { getTransactions as getEspnTransactions } from "../espn/league";
import type { EspnClient } from "../espn/client";
import type { EspnLeagueRef } from "../espn/league";
import type { EspnTransaction } from "../espn/schemas";

export interface GradedTrade {
  id: string;
  proposedAt: string;
  sideALabel: string;
  sideBLabel: string;
  sideA: PlayerValue[];
  sideB: PlayerValue[];
  verdict: TradeVerdict;
}

interface SleeperTxn {
  type?: string;
  status?: string;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
}

/**
 * Normalize raw Sleeper transactions into graded trades. `adds` maps a player
 * id to the roster id that received them; side A is the first roster id.
 *
 * Pass `leagueUsers` to resolve real display names for trade labels; omit for
 * the anonymous `Roster N` fallback.
 */
export function normalizeSleeperTrades(
  txns: SleeperTxn[],
  valueMap: Map<string, PlayerValue>,
  leagueUsers?: ReadonlyArray<{ user_id: string; display_name?: string | null; roster_id?: number | null }>
): GradedTrade[] {
  // Build a roster_id → display_name lookup when users are provided.
  const rosterLabel = (rosterId: number): string => {
    if (leagueUsers) {
      const user = leagueUsers.find((u) => u.roster_id === rosterId);
      if (user?.display_name) return user.display_name;
    }
    return `Roster ${rosterId}`;
  };

  const out: GradedTrade[] = [];
  for (const t of txns) {
    if (t.type !== "trade" || t.status !== "complete") continue;
    // Sleeper states the participants directly, so the team count needs no
    // inference. Same defect as the ESPN path (audit 2026-08-22, P1-4): a
    // three-roster trade used to sweep rosters B and C into one "side B" under
    // roster B's name and grade A against the pair.
    const rosterIds = t.roster_ids ?? [];
    const rosterA = rosterIds[0];
    if (rosterA == null) continue;
    const rosterB = rosterIds[1];
    const multiTeam = rosterIds.length > 2;

    const sideA: PlayerValue[] = [];
    const sideB: PlayerValue[] = [];
    for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
      const pv = valueMap.get(playerId);
      if (!pv) continue;
      if (rosterId === rosterA) sideA.push(pv);
      else if (rosterB != null && rosterId === rosterB) sideB.push(pv);
    }

    const labelB = rosterB != null ? rosterLabel(rosterB) : "Roster ?";
    out.push({
      id: `sleeper-${t.created ?? out.length}`,
      proposedAt: new Date(t.created ?? Date.now()).toISOString(),
      sideALabel: rosterLabel(rosterA),
      sideBLabel: multiTeam ? `${labelB} +${rosterIds.length - 2} more` : labelB,
      sideA,
      sideB,
      verdict: multiTeam ? multiTeamTrade(rosterIds.length) : evaluateTrade(sideA, sideB)
    });
  }
  return out;
}

/**
 * Fetch and grade completed trades for the full Sleeper season (weeks 1 through
 * the current NFL week, capped at 18). The previous hard-coded 6-week window
 * silently dropped older trades.
 */
export async function fetchSleeperLeagueTrades(
  leagueId: string,
  valueMap: Map<string, PlayerValue>
): Promise<GradedTrade[]> {
  const state = await getNflState();
  const currentWeek =
    state.data != null && typeof state.data.week === "number" ? state.data.week : 1;
  const maxWeek = Math.min(currentWeek, 18);
  const graded: GradedTrade[] = [];
  for (let w = 1; w <= maxWeek; w++) {
    const envelope = await getTransactions(leagueId, w);
    if (envelope.source.failure || !envelope.data) continue;
    graded.push(...normalizeSleeperTrades(envelope.data as unknown as SleeperTxn[], valueMap));
  }
  return graded;
}

/** Re-key a sleeperId-keyed value map by espnId (skips players with no espnId). */
export function indexByEspnId(valueMap: Map<string, PlayerValue>): Map<string, PlayerValue> {
  const byEspn = new Map<string, PlayerValue>();
  for (const pv of valueMap.values()) {
    if (pv.espnId) byEspn.set(pv.espnId, pv);
  }
  return byEspn;
}

/**
 * Normalize raw ESPN transactions into graded trades. ESPN trade items carry
 * `fromTeamId`/`toTeamId`; side A is the first team that receives a player.
 *
 * Pass `teamNames` (teamId → display name) to resolve real team names for
 * trade labels; omit for the anonymous `Team N` fallback.
 */
export function normalizeEspnTrades(
  txns: EspnTransaction[],
  valueByEspnId: Map<string, PlayerValue>,
  teamNames?: Map<number, string>
): GradedTrade[] {
  const teamLabel = (teamId: number | null | undefined): string => {
    if (teamId != null && teamNames) {
      const name = teamNames.get(teamId);
      if (name) return name;
    }
    return `Team ${teamId ?? "?"}`;
  };

  const out: GradedTrade[] = [];
  for (const t of txns) {
    if (!t.type || !t.type.includes("TRADE")) continue;
    // Only grade trades that actually went through; ESPN reports proposed,
    // declined, and pending trades with TRADE-prefixed types too.
    if (t.status && t.status !== "EXECUTED") continue;
    const items = (t.items ?? []).filter(
      (i) => i.playerId != null && i.fromTeamId != null && i.toTeamId != null && i.fromTeamId !== i.toTeamId
    );
    if (items.length === 0) continue;

    // How many DISTINCT teams are actually in this deal.
    //
    // Audit 2026-08-22, P1-4: the old bucketing was "did this item go to team
    // A?", with everything else swept into side B under side B's label. In a
    // three-team trade that attributed team C's haul to team B and then graded
    // A against B-plus-C — a specific, confident, wrong verdict, printed beside
    // the wrong team name. Multi-team deals are now reported as what they are.
    const teams = new Set<number>();
    for (const i of items) {
      if (i.fromTeamId != null) teams.add(i.fromTeamId);
      if (i.toTeamId != null) teams.add(i.toTeamId);
    }

    const teamA = items[0]!.toTeamId;
    const teamB = items.find((i) => i.toTeamId !== teamA)?.toTeamId;
    const multiTeam = teams.size > 2;

    const sideA: PlayerValue[] = [];
    const sideB: PlayerValue[] = [];
    for (const item of items) {
      const pv = valueByEspnId.get(String(item.playerId));
      if (!pv) continue;
      // In a multi-team deal only the two named sides are populated; a third
      // team's players are deliberately NOT folded into side B, because side B
      // is labelled with team B's name and does not contain them.
      if (item.toTeamId === teamA) sideA.push(pv);
      else if (item.toTeamId === teamB) sideB.push(pv);
    }

    out.push({
      id: `espn-${t.id ?? out.length}`,
      proposedAt: new Date(t.proposedDate ?? Date.now()).toISOString(),
      sideALabel: teamLabel(teamA),
      sideBLabel: multiTeam ? `${teamLabel(teamB)} +${teams.size - 2} more` : teamLabel(teamB),
      sideA,
      sideB,
      verdict: multiTeam ? multiTeamTrade(teams.size) : evaluateTrade(sideA, sideB)
    });
  }
  return out;
}

/** Fetch and grade completed trades from an ESPN league. */
export async function fetchEspnLeagueTrades(
  client: EspnClient,
  ref: EspnLeagueRef,
  valueMap: Map<string, PlayerValue>
): Promise<GradedTrade[]> {
  const envelope = await getEspnTransactions(client, ref);
  if (envelope.source.failure || !envelope.data) return [];
  const txns = (envelope.data.transactions ?? []) as unknown as EspnTransaction[];
  return normalizeEspnTrades(txns, indexByEspnId(valueMap));
}
