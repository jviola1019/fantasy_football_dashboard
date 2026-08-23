"use client";

import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { scarcityGap } from "@/lib/models";
import { PanelCard } from "../ui/PanelCard";

type Props = {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
};

interface NarrRow {
  p: PlayerMarketRecord;
  hype: number;
  edge: number;
  gap: number;
}

/**
 * Narrative Engine, rebuilt as a single focused, actionable view: HYPE vs.
 * VALUE. Every player is scored by the gap between how the market is trending on
 * them (hype = trendingMomentum) and what they're actually worth (edge =
 * scarcityGap, true − market). Two boards fall out of that one number:
 *   - SELL-HIGH: hype running ahead of value → sell into the story.
 *   - BUY-LOW:   value the market is sleeping on → buy the dip.
 *
 * Both signals are real. When the trending source isn't connected the hype axis
 * is simply zero, so the board degrades honestly to a pure value-mispricing
 * ranking (edge is always present) rather than blanking out — replacing the old
 * four-tab panel of abstract pseudo-metrics (half-life, viral velocity, an
 * always-"unavailable" time-series tab) that the data could never support.
 */
export function NarrativeEngine({ players, envelope }: Props) {
  const panelState = envelope
    ? derivePanelState(envelope, ["trending_momentum"])
    : // No envelope ⇒ no provenance; claiming "ready" would fabricate trust (UX-05).
      {
        status: "unavailable" as const,
        bannerText: "No data envelope — hype signals unavailable.",
        unavailable: new Set<string>(["trending_momentum"])
      };
  const withHype = panelState.status !== "unavailable";

  const ranked: NarrRow[] = players.map((p) => {
    const hype = withHype ? Math.round(p.trendingMomentum) : 0;
    const edge = scarcityGap(p);
    return { p, hype, edge, gap: hype - edge };
  });

  // gap > 0 ⇒ hyped beyond value (sell). gap < 0 ⇒ value beyond hype (buy).
  const sellHigh = ranked.filter((r) => r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 8);
  const buyLow = ranked.filter((r) => r.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 8);

  const up = withHype ? players.filter((p) => p.trendingMomentum > 5).length : 0;
  const down = withHype ? players.filter((p) => p.trendingMomentum < -5).length : 0;

  return (
    <PanelCard
      id="narrative-engine"
      titleId="ne-title"
      title="Narrative Engine"
      eyebrow="Hype vs. value — sell the story, buy the dip."
    >
      <div className="narr-summary">
        {withHype ? (
          <span>
            {up} trending up · {down} trending down across the market · ranked by how far waiver hype sits from true value.
          </span>
        ) : (
          <span>
            Trending/sentiment source not connected — ranked by <b>value mispricing</b> only. Connect a Sleeper league
            to add the live hype axis.
          </span>
        )}
      </div>

      {players.length === 0 ? (
        <div className="empty-state">
          <b>No players to analyse</b>
        </div>
      ) : (
        <div className="narr-cols" aria-label="Narrative — hype vs value board">
          <NarrBoard
            tone="sell"
            title="SELL-HIGH"
            sub={withHype ? "hyped beyond value" : "overpriced vs. true value"}
            rows={sellHigh}
            withHype={withHype}
          />
          <NarrBoard
            tone="buy"
            title="BUY-LOW"
            sub={withHype ? "value the market is sleeping on" : "underpriced vs. true value"}
            rows={buyLow}
            withHype={withHype}
          />
        </div>
      )}
    </PanelCard>
  );
}

function NarrBoard({
  tone,
  title,
  sub,
  rows,
  withHype
}: {
  tone: "sell" | "buy";
  title: string;
  sub: string;
  rows: NarrRow[];
  withHype: boolean;
}) {
  return (
    <div className="narr-board">
      <div className="narr-board-head">
        <span className={`narr-board-title narr-${tone}`}>{title}</span>
        <span className="narr-board-sub">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted-note">No qualifying players.</p>
      ) : (
        <ol className="narr-list">
          {rows.map((r, i) => (
            <li key={r.p.id} className="narr-row">
              <span className="narr-rank">{i + 1}</span>
              <span className="narr-id">
                <span className="narr-name" title={r.p.name}>{r.p.name}</span>
                <span className="narr-pos">{r.p.position}</span>
              </span>
              {withHype && (
                <span
                  className={`narr-stat ${r.hype >= 0 ? "pos-text" : "neg-text"}`}
                  title="trending hype"
                  aria-label={`trending hype ${r.hype >= 0 ? "+" : ""}${r.hype}`}
                >
                  {r.hype >= 0 ? "+" : ""}{r.hype}
                </span>
              )}
              <span
                className={`narr-stat ${r.edge >= 0 ? "pos-text" : "neg-text"}`}
                title="value edge (true − market)"
                aria-label={`value edge ${r.edge >= 0 ? "+" : ""}${r.edge}`}
              >
                {r.edge >= 0 ? "+" : ""}{r.edge}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="narr-legend">
        {withHype ? "columns: trending hype · value edge (true − market)" : "column: value edge (true − market)"}
      </div>
    </div>
  );
}
