import type { PlayerValue } from "./values";
import { evaluateTrade, type TradeVerdict } from "./evaluate";
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
 */
export function normalizeSleeperTrades(
  txns: SleeperTxn[],
  valueMap: Map<string, PlayerValue>
): GradedTrade[] {
  const out: GradedTrade[] = [];
  for (const t of txns) {
    if (t.type !== "trade" || t.status !== "complete") continue;
    const rosterIds = t.roster_ids ?? [];
    const rosterA = rosterIds[0];
    if (rosterA == null) continue;
    const sideA: PlayerValue[] = [];
    const sideB: PlayerValue[] = [];
    for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
      const pv = valueMap.get(playerId);
      if (!pv) continue;
      (rosterId === rosterA ? sideA : sideB).push(pv);
    }
    out.push({
      id: `sleeper-${t.created ?? out.length}`,
      proposedAt: new Date(t.created ?? Date.now()).toISOString(),
      sideALabel: `Roster ${rosterA}`,
      sideBLabel: `Roster ${rosterIds[1] ?? "?"}`,
      sideA,
      sideB,
      verdict: evaluateTrade(sideA, sideB)
    });
  }
  return out;
}

/** Fetch and grade completed trades from the most recent Sleeper weeks. */
export async function fetchSleeperLeagueTrades(
  leagueId: string,
  valueMap: Map<string, PlayerValue>,
  weeksBack = 6
): Promise<GradedTrade[]> {
  const state = await getNflState();
  const week = state.data != null && typeof state.data.week === "number" ? state.data.week : 1;
  const graded: GradedTrade[] = [];
  for (let w = week; w > Math.max(0, week - weeksBack); w--) {
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
 */
export function normalizeEspnTrades(
  txns: EspnTransaction[],
  valueByEspnId: Map<string, PlayerValue>
): GradedTrade[] {
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
    const teamA = items[0]!.toTeamId;
    const sideA: PlayerValue[] = [];
    const sideB: PlayerValue[] = [];
    for (const item of items) {
      const pv = valueByEspnId.get(String(item.playerId));
      if (!pv) continue;
      (item.toTeamId === teamA ? sideA : sideB).push(pv);
    }
    const teamB = items.find((i) => i.toTeamId !== teamA)?.toTeamId;
    out.push({
      id: `espn-${t.id ?? out.length}`,
      proposedAt: new Date(t.proposedDate ?? Date.now()).toISOString(),
      sideALabel: `Team ${teamA ?? "?"}`,
      sideBLabel: `Team ${teamB ?? "?"}`,
      sideA,
      sideB,
      verdict: evaluateTrade(sideA, sideB)
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
