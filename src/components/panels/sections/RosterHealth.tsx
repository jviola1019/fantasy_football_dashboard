"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { deriveStartSitEdge } from "@/lib/derivedMetrics";
import { surname } from "@/lib/utils";
import { PanelCard } from "../../ui/PanelCard";

/**
 * Roster Health (/players) — the availability X-ray + start/sit edge mini-panels,
 * re-homed verbatim from the former CommandCenter so roster-management signals sit
 * with the player views.
 */
export function RosterHealth({ players }: { players: PlayerMarketRecord[] }) {
  const startSit = deriveStartSitEdge(players);
  return (
    <PanelCard id="roster-health" titleId="rh-title" title="Roster Health" eyebrow="Availability + start/sit edge.">
      <div className="bottom-row">
        <RosterFragilityXRay players={players} />
        <StartSitEdge rows={startSit} hasData={players.length > 0} />
      </div>
    </PanelCard>
  );
}

// Availability risk straight from each player's REAL injury designation
// (Sleeper injury_status / ESPN injuryStatus → out/ir/questionable/bye).
const STATUS_RISK: Record<
  PlayerMarketRecord["status"],
  { score: number; tier: "high" | "elev" | "low"; label: string; rank: number }
> = {
  out: { score: 100, tier: "high", label: "Out", rank: 5 },
  ir: { score: 100, tier: "high", label: "IR", rank: 5 },
  questionable: { score: 55, tier: "elev", label: "Questionable", rank: 3 },
  bye: { score: 40, tier: "elev", label: "Bye", rank: 2 },
  unknown: { score: 15, tier: "low", label: "—", rank: 1 },
  active: { score: 5, tier: "low", label: "Active", rank: 0 }
};

function RosterFragilityXRay({ players }: { players: PlayerMarketRecord[] }) {
  const ranked = [...players]
    .map((p) => ({ p, r: STATUS_RISK[p.status] ?? STATUS_RISK.unknown }))
    .sort((a, b) => b.r.rank - a.r.rank || b.r.score - a.r.score);
  const flagged = ranked.filter((x) => x.r.rank >= 2);
  const shown = flagged.slice(0, 5);
  const outN = players.filter((p) => p.status === "out" || p.status === "ir").length;
  const qN = players.filter((p) => p.status === "questionable").length;
  const byeN = players.filter((p) => p.status === "bye").length;

  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Roster Availability X-Ray</div>
      {players.length === 0 ? (
        <p className="muted-note">No roster to scan.</p>
      ) : flagged.length === 0 ? (
        <p className="frag-allclear">✓ Roster healthy — no injury or bye flags.</p>
      ) : (
        <>
          <div className="frag-summary">
            {outN > 0 && <span className="frag-chip frag-chip-high">{outN} out / IR</span>}
            {qN > 0 && <span className="frag-chip frag-chip-elev">{qN} questionable</span>}
            {byeN > 0 && <span className="frag-chip frag-chip-elev">{byeN} on bye</span>}
          </div>
          <ul className="frag-rows">
            {shown.map(({ p, r }) => (
              <li key={p.id} className="frag-row" data-tier={r.tier}>
                <span className="frag-name" title={p.name}>{p.name}</span>
                <span className="frag-pos">{p.position}</span>
                <span className="frag-track" aria-hidden="true">
                  <span className="frag-fill" style={{ ["--f" as string]: `${r.score}%` }} />
                </span>
                <span className="frag-label">{r.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small-note frag-note">Live injury / bye designations from your connected league.</p>
    </div>
  );
}

function StartSitEdge({ rows, hasData }: { rows: ReturnType<typeof deriveStartSitEdge>; hasData: boolean }) {
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Start / Sit Edge</div>
      {!hasData ? (
        <p className="muted-note">No data available.</p>
      ) : (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Value</th>
              <th>Best Alternative</th>
              <th>Value Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, value, bestAlt, edge }) => (
              <tr key={player.id}>
                <td>{surname(player.name)}</td>
                <td>{value}</td>
                <td>{bestAlt}</td>
                <td className={edge > 0 ? "pos-text" : "neg-text"}>{edge > 0 ? `+${edge}` : edge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasData ? (
        <p className="small-note">
          Value gap = the player&apos;s consensus value score minus the best same-position
          alternative on your roster (unitless 0–100 index from consensus rankings, not
          projected points; positive favors starting).
        </p>
      ) : null}
    </div>
  );
}
