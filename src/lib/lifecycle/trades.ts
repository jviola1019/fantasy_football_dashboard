import type { PlayerMarketRecord } from "../governance";
import { reputationEdge } from "../models";

export interface TradeSide {
  manager: string;
  players: PlayerMarketRecord[];
}

export interface TradeProposal {
  id: string;
  proposedAt: string;
  sideA: TradeSide;
  sideB: TradeSide;
}

export interface TradeFairness {
  trade: TradeProposal;
  /** Sum of reputationEdge for each side. */
  edgeA: number;
  edgeB: number;
  /** edgeA - edgeB. Positive favors A; negative favors B. */
  delta: number;
  /** 0..1 where 1.0 = perfectly balanced. */
  fairness: number;
  verdict: "balanced" | "slight-edge" | "lopsided";
}

const MAX_REASONABLE_EDGE_DELTA = 40;

export function evaluateTradeFairness(trade: TradeProposal): TradeFairness {
  const edgeA = trade.sideA.players.reduce((s, p) => s + reputationEdge(p), 0);
  const edgeB = trade.sideB.players.reduce((s, p) => s + reputationEdge(p), 0);
  const delta = edgeA - edgeB;
  const absDelta = Math.abs(delta);
  const fairness = Math.max(0, 1 - absDelta / MAX_REASONABLE_EDGE_DELTA);
  let verdict: TradeFairness["verdict"];
  if (absDelta < 4) verdict = "balanced";
  else if (absDelta < 12) verdict = "slight-edge";
  else verdict = "lopsided";
  return { trade, edgeA, edgeB, delta, fairness, verdict };
}

export function rankTradesByFairness(trades: TradeProposal[]): TradeFairness[] {
  return trades.map(evaluateTradeFairness).sort((a, b) => b.fairness - a.fairness);
}
