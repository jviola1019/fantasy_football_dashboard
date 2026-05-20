"use client";

import { useMemo } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { rankTradesByFairness, type TradeProposal } from "@/lib/lifecycle/trades";
import { PanelCard } from "../ui/PanelCard";

type Props = {
  players: PlayerMarketRecord[];
};

export function TradeCenter({ players }: Props) {
  const trades = useMemo(() => mockTradeFeed(players), [players]);
  const ranked = useMemo(() => rankTradesByFairness(trades), [trades]);

  return (
    <PanelCard
      id="trade-center"
      titleId="tc-title"
      title="Trade Center"
      eyebrow="Compute trade fairness from reputation edge deltas."
      icon={<ArrowLeftRight />}
    >
      <div className="table-wrap" tabIndex={0}>
        <div className="section-label">RECENT TRADES — RANKED BY FAIRNESS</div>
        {ranked.length === 0 ? (
          <p className="muted-note">
            No trades visible yet. Connect a league and recent transactions will populate here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Trade</th>
                <th>Side A</th>
                <th>Side B</th>
                <th>Edge Δ</th>
                <th>Fairness</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ trade, edgeA, edgeB, delta, fairness, verdict }) => (
                <tr key={trade.id}>
                  <td>
                    <small>{new Date(trade.proposedAt).toLocaleDateString()}</small>
                  </td>
                  <td>
                    {trade.sideA.manager}:{" "}
                    {trade.sideA.players.map((p) => p.name).join(", ")}
                    <small> ({edgeA.toFixed(1)})</small>
                  </td>
                  <td>
                    {trade.sideB.manager}:{" "}
                    {trade.sideB.players.map((p) => p.name).join(", ")}
                    <small> ({edgeB.toFixed(1)})</small>
                  </td>
                  <td className={Math.abs(delta) < 4 ? "muted-text" : delta > 0 ? "pos-text" : "neg-text"}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(1)}
                  </td>
                  <td>{(fairness * 100).toFixed(0)}%</td>
                  <td>
                    <span
                      className={
                        verdict === "balanced"
                          ? "pos-text"
                          : verdict === "slight-edge"
                          ? "neu-text"
                          : "neg-text"
                      }
                    >
                      {verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="small-note">
        Replace `mockTradeFeed` with `getTransactions(leagueId, week)` from
        `src/lib/sleeper/league.ts` or ESPN&apos;s scoreboard view to surface real trades.
      </p>
    </PanelCard>
  );
}

function mockTradeFeed(players: PlayerMarketRecord[]): TradeProposal[] {
  if (players.length < 2) return [];
  // Build two demo trades from the envelope so the UI is non-empty on first load.
  const sorted = [...players].sort((a, b) => b.trueValue - a.trueValue);
  return [
    {
      id: "demo-balanced",
      proposedAt: "2026-10-08T17:00:00Z",
      sideA: { manager: "Manager A", players: [sorted[0]!] },
      sideB: { manager: "Manager B", players: [sorted[1]!] }
    },
    {
      id: "demo-lopsided",
      proposedAt: "2026-10-09T20:30:00Z",
      sideA: { manager: "Manager C", players: [sorted[0]!] },
      sideB: { manager: "Manager D", players: [sorted.at(-1)!] }
    }
  ];
}
