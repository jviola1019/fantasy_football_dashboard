import { describe, it, expect } from "vitest";
import { normalizeSleeperTrades } from "./transactions";
import type { PlayerValue } from "./values";

// Minimal shape accepted by normalizeSleeperTrades (internal SleeperTxn is not exported).
interface RawTxn {
  type?: string;
  status?: string;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
}

function pv(id: string, value: number): PlayerValue {
  return {
    sleeperId: id, espnId: null, name: `Player ${id}`, position: "RB", team: null,
    value, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("normalizeSleeperTrades", () => {
  const valueMap = new Map<string, PlayerValue>([
    ["100", pv("100", 8000)],
    ["200", pv("200", 3000)]
  ]);
  // Sleeper trade: roster 1 receives player 100, roster 2 receives player 200.
  const txns: RawTxn[] = [
    {
      type: "trade",
      status: "complete",
      created: 1_700_000_000_000,
      roster_ids: [1, 2],
      adds: { "100": 1, "200": 2 }
    },
    { type: "waiver", status: "complete", created: 1, roster_ids: [1], adds: { "300": 1 } }
  ];

  it("keeps only completed trades and grades them", () => {
    const graded = normalizeSleeperTrades(txns, valueMap);
    expect(graded).toHaveLength(1);
    expect(graded[0]!.verdict.winner).toBe("A");
  });

  it("returns an empty list when there are no trades", () => {
    expect(normalizeSleeperTrades([], valueMap)).toEqual([]);
  });
});
