"use client";

import { useMemo } from "react";
import { Repeat } from "lucide-react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { reputationEdge } from "@/lib/models";
import { BarChart } from "@/components/charts/BarChart";
import { PanelCard } from "../ui/PanelCard";

type Props = {
  players: PlayerMarketRecord[];
};

interface RankedFreeAgent {
  player: PlayerMarketRecord;
  edge: number;
  scarcity: number;
  score: number;
}

export function WaiverWire({ players }: Props) {
  const ranked = useMemo(() => rankFreeAgents(players), [players]);
  const faabBars = [
    { label: "You (est)", value: 35 },
    { label: "League median", value: 62 },
    { label: "Top spender", value: 95 }
  ];

  return (
    <PanelCard
      id="waiver-wire"
      titleId="ww-title"
      title="Waiver Wire"
      eyebrow="Rank free agents by edge × position scarcity."
      icon={<Repeat />}
    >
      <div className="universe-layout">
        <div className="table-wrap" tabIndex={0}>
          <div className="section-label">RANKED FREE AGENTS</div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th>Team</th>
                <th>Edge</th>
                <th>Scarcity</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    No free agents in the current envelope. Connect a real league to populate.
                  </td>
                </tr>
              ) : (
                ranked.map((r) => (
                  <tr key={r.player.id}>
                    <td>{r.player.name}</td>
                    <td>{r.player.position}</td>
                    <td>{r.player.team ?? "—"}</td>
                    <td className={r.edge >= 0 ? "pos-text" : "neg-text"}>
                      {r.edge >= 0 ? "+" : ""}
                      {r.edge.toFixed(1)}
                    </td>
                    <td>{r.scarcity.toFixed(2)}</td>
                    <td>{r.score.toFixed(1)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="universe-sidebar">
          <div className="player-profile-card">
            <div className="momentum-header">FAAB BUDGET</div>
            <BarChart items={faabBars} max={100} />
            <p className="small-note">
              Replace with real FAAB once your league&apos;s waiver type and remaining-budget fields are
              piped through `/api/leagues/[id]/refresh`.
            </p>
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

function rankFreeAgents(players: PlayerMarketRecord[]): RankedFreeAgent[] {
  if (players.length === 0) return [];
  const counts: Record<PlayerMarketRecord["position"], number> = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0
  };
  for (const p of players) counts[p.position] += 1;
  const total = players.length;

  return [...players]
    .map((player) => {
      const edge = reputationEdge(player);
      // Scarcity: 1 / (count / total) ≈ how rare this position is in the pool.
      const scarcity = total / Math.max(1, counts[player.position]);
      const score = edge * 1.4 + scarcity * 6;
      return { player, edge, scarcity, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}
