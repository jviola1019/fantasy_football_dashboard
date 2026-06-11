"use client";

import { useMemo, useState } from "react";
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
  const [query, setQuery] = useState("");
  const panelState = envelope
    ? derivePanelState(envelope, ["opportunity"])
    : // No envelope ⇒ no provenance; claiming "ready" would fabricate trust (UX-05).
      {
        status: "unavailable" as const,
        bannerText: "No data envelope — opportunity signals unavailable.",
        unavailable: new Set<string>(["opportunity"])
      };
  const showEdge = panelState.status === "ready";

  const filtered = useMemo(
    () => (query ? players.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) : players),
    [players, query]
  );
  const CAP = query ? 100 : 25;
  const ranked = useMemo(
    () => rankFreeAgents(filtered, { showEdge, limit: CAP }),
    [filtered, showEdge, CAP]
  );

  return (
    <PanelCard
      id="waiver-wire"
      titleId="ww-title"
      title="Waiver Wire"
      source={envelope?.sourceState}
      eyebrow={
        showEdge
          ? "Rank free agents by value, opportunity & scarcity."
          : "Pre-draft / off-season — ranks by value & position scarcity."
      }
      controls={
        <input
          className="galaxy-search"
          type="search"
          placeholder="Find a free agent..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search free agents"
        />
      }
    >
      <div className="universe-layout">
        <div className="table-wrap" tabIndex={0}>
          <div className="section-label">
            RANKED FREE AGENTS{!query && players.length > ranked.length ? ` — top ${ranked.length} of ${players.length}` : ""}
          </div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Position</th>
                <th>Team</th>
                <th>Value</th>
                {showEdge ? <th>Edge</th> : null}
                <th>Scarcity</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={showEdge ? 7 : 6}>
                    {query ? "No free agents match your search." : "No free agents in the current envelope. Connect a real league to populate."}
                  </td>
                </tr>
              ) : (
                ranked.map((r) => (
                  <tr key={r.player.id}>
                    <td>{r.player.name}</td>
                    <td>{r.player.position}</td>
                    <td>{r.player.team ?? "—"}</td>
                    <td>{Math.round(r.player.trueValue)}</td>
                    {showEdge ? (
                      <td className={r.edge >= 0 ? "pos-text" : "neg-text"}>
                        {r.edge >= 0 ? "+" : ""}
                        {r.edge.toFixed(1)}
                      </td>
                    ) : null}
                    <td>{r.scarcity.toFixed(0)}</td>
                    <td>{r.score.toFixed(1)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!showEdge ? (
            <p className="small-note">
              Edge/opportunity hidden — in-season opportunity data not integrated yet. Ranking uses
              player value + position scarcity (both real).
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
  options: { showEdge: boolean; limit: number }
): RankedFreeAgent[] {
  if (players.length === 0) return [];
  // Position scarcity = how THIN your options are, not how rare the position is
  // in the pool: count the startable-quality free agents (value >= 50) at each
  // position. A position with few quality options left is scarcer → a small
  // importance bump. (The old `total / count` made rare-in-pool QBs rank top
  // regardless of value.)
  const quality: Record<PlayerMarketRecord["position"], number> = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0
  };
  for (const p of players) if (p.trueValue >= 50) quality[p.position] += 1;

  return [...players]
    .map((player) => {
      const edge = reputationEdge(player);
      // Importance is driven by the player's own VALUE (the best available
      // player is the most important pickup); undervaluation (edge) and
      // in-season opportunity add to it only when those signals are real; a thin
      // position gets a modest scarcity bump. 0..~12, higher = scarcer position.
      const scarcity = Math.max(0, 12 - quality[player.position]);
      const score = options.showEdge
        ? player.trueValue + edge * 0.4 + player.opportunity * 0.4 + scarcity * 0.8
        : player.trueValue + scarcity * 0.8;
      return { player, edge, scarcity, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}
