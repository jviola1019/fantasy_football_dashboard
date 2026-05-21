import { describe, it, expect } from "vitest";
import { normalizeSleeperTrades, normalizeEspnTrades, indexByEspnId } from "./transactions";
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

describe("indexByEspnId", () => {
  it("re-keys a sleeperId map by espnId, skipping null espnIds", () => {
    const m = new Map<string, PlayerValue>([
      ["s1", { sleeperId: "s1", espnId: "111", name: "A", position: "RB", team: null, value: 5000, overallRank: 0, positionRank: 0, trend30Day: 0 }],
      ["s2", { sleeperId: "s2", espnId: null, name: "B", position: "WR", team: null, value: 4000, overallRank: 0, positionRank: 0, trend30Day: 0 }]
    ]);
    const byEspn = indexByEspnId(m);
    expect(byEspn.get("111")?.name).toBe("A");
    expect(byEspn.size).toBe(1);
  });
});

describe("normalizeEspnTrades", () => {
  function pvE(espnId: string, value: number): PlayerValue {
    return { sleeperId: null, espnId, name: `P${espnId}`, position: "RB", team: null, value, overallRank: 0, positionRank: 0, trend30Day: 0 };
  }
  const byEspnId = new Map<string, PlayerValue>([
    ["111", pvE("111", 9000)],
    ["222", pvE("222", 4000)]
  ]);
  interface RawEspnTxn {
    id?: number;
    type?: string;
    status?: string;
    proposedDate?: number;
    items?: { type?: string; playerId?: number; fromTeamId?: number; toTeamId?: number }[];
  }
  const txns: RawEspnTxn[] = [
    {
      id: 1, type: "TRADE_ACCEPT", status: "EXECUTED", proposedDate: 1_700_000_000_000,
      items: [
        { type: "TRADE", playerId: 111, fromTeamId: 5, toTeamId: 3 },
        { type: "TRADE", playerId: 222, fromTeamId: 3, toTeamId: 5 }
      ]
    },
    { id: 2, type: "WAIVER", items: [{ type: "WAIVER", playerId: 333, toTeamId: 3 }] }
  ];

  it("keeps only trades and grades them", () => {
    const graded = normalizeEspnTrades(txns, byEspnId);
    expect(graded).toHaveLength(1);
    // player 111 (9000) → team 3 = side A; player 222 (4000) → team 5 = side B
    expect(graded[0]!.verdict.winner).toBe("A");
  });

  it("returns an empty list when there are no trades", () => {
    expect(normalizeEspnTrades([], byEspnId)).toEqual([]);
  });
});
