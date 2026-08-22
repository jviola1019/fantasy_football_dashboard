"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { scarcityGap } from "@/lib/models";
import { PanelCard } from "../ui/PanelCard";

/**
 * Top Insights overview tile — the biggest market mispricings (largest
 * |true − market| gaps) from the market pool, using the canonical
 * `scarcityGap`. The plan's missing overview element; no new data — it reads
 * the same pool/metric the Market Intelligence panel does.
 */
export function TopInsights({ market }: { market: PlayerMarketRecord[] }) {
  const ranked = [...market]
    .map((p) => ({ p, e: scarcityGap(p) }))
    .filter((x) => Number.isFinite(x.e))
    .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
    .slice(0, 6);
  return (
    <PanelCard id="top-insights" titleId="ti-title" title="Top Insights" eyebrow="Biggest market mispricings.">
      {ranked.length === 0 ? (
        <p className="muted-note">No market data to surface insights.</p>
      ) : (
        <ul className="ti-list">
          {ranked.map(({ p, e }) => {
            const rounded = Math.round(e);
            return (
              <li key={p.id} className="ti-row" data-tone={e >= 0 ? "under" : "over"}>
                <span className="ti-name">{p.name}</span>
                <span className="ti-pos">{p.position}</span>
                <span className="ti-edge">
                  {e >= 0 ? `Undervalued +${rounded}` : `Overvalued ${rounded}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}
