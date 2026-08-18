import type { PlayerMarketRecord } from "@/lib/governance";
import { PanelCard } from "../ui/PanelCard";
import { PositionBadge } from "../PlayerRow";
import { PlayerHeadshot } from "../PlayerHeadshot";
import { fixtureHeadshotFallbacks } from "@/lib/fixtures";

/**
 * Bars are coloured by MEANING, not by position (audit F-012).
 *
 * They used to take the position palette, and `--pos-qb` (#ef5c7a) is
 * effectively the same hue as `--red` (#eb5f54) — the design system's RISK
 * colour. So the single most valuable quarterback on a roster rendered a
 * full-width red bar, which reads as the strongest possible warning about the
 * player you are most pleased to own.
 *
 * Position is already on every row via `PositionBadge`, so the bar was
 * duplicating an encoding that was available anyway and paying for it with the
 * risk semantics. It now uses the informational accent throughout, per
 * CLAUDE.md's colour contract (blue = informational, red = risk).
 */
const PULSE_BAR_COLOR = "var(--blue)";
const PULSE_MAX_ROWS = 14;

/**
 * League Pulse overview tile — the value-ranked player leaderboard extracted
 * verbatim from the former CommandCenter. The Market Edge pill moves to the
 * panel header controls; the `.lp-board` rows/bars/values are unchanged.
 */
export function LeaguePulse({ players, marketEdge }: { players: PlayerMarketRecord[]; marketEdge: number }) {
  const ranked = [...players].sort((a, b) => b.trueValue - a.trueValue).slice(0, PULSE_MAX_ROWS);
  const maxVal = Math.max(ranked[0]?.trueValue ?? 1, 1);
  return (
    <PanelCard
      id="league-pulse"
      titleId="lp-title"
      title="League Pulse"
      eyebrow="Your roster, ranked by true value."
      controls={
        <span
          className="league-pulse-edge-pill"
          title="Market Edge index: your roster's average reputation edge (consensus value minus market price) rescaled so 50 = neutral. Above 50 = the market underprices your roster; below 50 = overprices. Same model as League Health's Avg Edge."
        >
          <span className="league-pulse-edge-val">{marketEdge}</span>
          <span className="league-pulse-edge-lbl">Market Edge · 50 = neutral</span>
        </span>
      }
    >
      <div className="league-pulse" role="region" aria-label="League pulse player leaderboard">
        {players.length === 0 ? (
          <div className="league-pulse-empty" role="status">
            <span className="lp-empty-icon">—</span>
            <span>Awaiting league data</span>
          </div>
        ) : (
          <ol className="lp-board" aria-label="Players ranked by true value">
            {ranked.map((p, idx) => {
              const value = Math.round(p.trueValue);
              const pct = p.trueValue > 0 ? Math.max(4, (p.trueValue / maxVal) * 100) : 0;
              return (
                <li key={p.id} className="lp-row">
                  <span className="lp-rank">{idx + 1}</span>
                  <PlayerHeadshot player={p} fallbacks={fixtureHeadshotFallbacks[p.id] ?? []} size={26} />
                  <span className="lp-id">
                    <span className="lp-name">{p.name}</span>
                    <PositionBadge position={p.position} />
                  </span>
                  <span className="lp-bar-track" aria-hidden="true">
                    <span
                      className="lp-bar"
                      style={{
                        ["--bar-w" as string]: `${pct}%`,
                        ["--bar-c" as string]: PULSE_BAR_COLOR
                      }}
                    />
                  </span>
                  <span className="lp-value">{value}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </PanelCard>
  );
}
