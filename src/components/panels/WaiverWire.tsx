"use client";

import { useMemo } from "react";
import { Repeat } from "lucide-react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { reputationEdge } from "@/lib/models";
import { PanelCard } from "../ui/PanelCard";
import { DataUnavailable } from "../ui/DataUnavailable";

type Props = {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
};

interface RankedFreeAgent {
  player: PlayerMarketRecord;
  edge: number;
  scarcity: number;
  score: number;
}

export function WaiverWire({ players, envelope }: Props) {
  // The Edge column derives from reputationEdge() which mixes trueValue +
  // perceivedValue + ownershipLeverage * 0.18 - fragility * 0.08. The
  // fragility term is zero pre-injury-adapter (always), so the Edge value
  // is meaningful only when opportunity is also populated (which it isn't
  // pre-season). When the envelope reports opportunity is missing, we
  // suppress the Edge column entirely rather than show a misleading rank.
  const panelState = envelope
    ? derivePanelState(envelope, ["opportunity"])
    : { status: "ready" as const, bannerText: null, unavailable: new Set<string>() };
  const showEdge = panelState.status === "ready";
  const ranked = useMemo(() => rankFreeAgents(players, { showEdge }), [players, showEdge]);

  return (
    <PanelCard
      id="waiver-wire"
      titleId="ww-title"
      title="Waiver Wire"
      eyebrow={
        showEdge
          ? "Rank free agents by edge × position scarcity."
          : "Pre-draft mode — ranks by ECR scarcity only."
      }
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
                {showEdge ? <th>Edge</th> : null}
                <th>Scarcity</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={showEdge ? 6 : 5}>
                    No free agents in the current envelope. Connect a real league to populate.
                  </td>
                </tr>
              ) : (
                ranked.map((r) => (
                  <tr key={r.player.id}>
                    <td>{r.player.name}</td>
                    <td>{r.player.position}</td>
                    <td>{r.player.team ?? "—"}</td>
                    {showEdge ? (
                      <td className={r.edge >= 0 ? "pos-text" : "neg-text"}>
                        {r.edge >= 0 ? "+" : ""}
                        {r.edge.toFixed(1)}
                      </td>
                    ) : null}
                    <td>{r.scarcity.toFixed(2)}</td>
                    <td>{r.score.toFixed(1)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!showEdge ? (
            <p className="small-note">
              Edge column hidden — in-season opportunity data not integrated. Ranking falls back to
              position-scarcity only.
            </p>
          ) : null}
        </div>
        <div className="universe-sidebar">
          <div className="player-profile-card">
            <div className="momentum-header">FAAB BUDGET</div>
            <DataUnavailable
              title="FAAB budgets not connected"
              description="Real waiver-budget bars need your league's waiver type and remaining-budget fields, surfaced via /api/leagues/[id]/refresh. No real FAAB data is integrated yet, so no placeholder bars are shown."
            />
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

function rankFreeAgents(
  players: PlayerMarketRecord[],
  options: { showEdge: boolean }
): RankedFreeAgent[] {
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
      // When edge is suppressed (opportunity missing), rank by scarcity alone
      // so the column we display is the one we computed against.
      const score = options.showEdge ? edge * 1.4 + scarcity * 6 : scarcity * 10;
      return { player, edge, scarcity, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}
