import { describe, expect, it } from "vitest";
import { evaluateTradeFairness, rankTradesByFairness, type TradeProposal } from "./trades";
import type { PlayerMarketRecord } from "../governance";

function mk(id: string, trueValue: number, perceivedValue: number): PlayerMarketRecord {
  return {
    id,
    name: id,
    position: "RB",
    team: "ATL",
    perceivedValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    narrativePressure: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: "RB",
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test"
  };
}

describe("trade fairness", () => {
  it("scores a perfectly balanced trade near fairness=1 and verdict=balanced", () => {
    const trade: TradeProposal = {
      id: "t1",
      proposedAt: "2026-10-01T00:00:00Z",
      sideA: { manager: "A", players: [mk("p1", 80, 75)] }, // edge = 5
      sideB: { manager: "B", players: [mk("p2", 80, 75)] }  // edge = 5
    };
    const result = evaluateTradeFairness(trade);
    expect(result.delta).toBe(0);
    expect(result.fairness).toBe(1);
    expect(result.verdict).toBe("balanced");
  });

  it("flags a lopsided trade with low fairness and verdict=lopsided", () => {
    const trade: TradeProposal = {
      id: "t2",
      proposedAt: "2026-10-02T00:00:00Z",
      sideA: { manager: "A", players: [mk("star", 95, 60)] }, // edge ≈ 35
      sideB: { manager: "B", players: [mk("dud", 50, 60)] }   // edge ≈ -10
    };
    const result = evaluateTradeFairness(trade);
    expect(result.delta).toBeGreaterThan(20);
    expect(result.fairness).toBeLessThan(0.5);
    expect(result.verdict).toBe("lopsided");
  });

  it("ranks multiple trades by fairness descending", () => {
    const fair: TradeProposal = {
      id: "fair",
      proposedAt: "2026-10-01T00:00:00Z",
      sideA: { manager: "A", players: [mk("a", 80, 75)] },
      sideB: { manager: "B", players: [mk("b", 80, 75)] }
    };
    const unfair: TradeProposal = {
      id: "unfair",
      proposedAt: "2026-10-02T00:00:00Z",
      sideA: { manager: "A", players: [mk("star", 95, 60)] },
      sideB: { manager: "B", players: [mk("dud", 50, 60)] }
    };
    const ranked = rankTradesByFairness([unfair, fair]);
    expect(ranked[0]?.trade.id).toBe("fair");
    expect(ranked[1]?.trade.id).toBe("unfair");
  });
});
