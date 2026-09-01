"use client";

import { useMemo, useState } from "react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { PanelCard } from "../ui/PanelCard";
import { THEME } from "@/lib/theme";
import { PanelTabs, TabPanel } from "../ui/PanelTabs";
import { DataUnavailable } from "../ui/DataUnavailable";
import { Heatmap2D, DEFAULT_COLOR } from "@/components/charts/Heatmap2D";
import { BarChart } from "@/components/charts/BarChart";
import type { SimulationResult } from "@/lib/simulation";
import { buildOutcomeHeat } from "@/lib/outcomeHeat";
import type { MarketMetrics } from "@/lib/derivedMetrics";
import { scarcityGap } from "@/lib/models";
import { EdgeDisclosureNotice } from "@/components/model/EdgeDisclosureNotice";
import { EDGE_LABELS } from "@/lib/models/edgeDisclosure";
import { deriveAggregateValueIndex } from "@/lib/derivedMetrics";
import { fmt, surname } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  marketMetrics: MarketMetrics;
  /** The SHARED canonical season sim (same one Nexus uses) — so the Trends
   *  outcome landscape never contradicts the Nexus Multiverse on this route. */
  sim: SimulationResult;
  envelope?: RAEEnvelope;
};

const TABS = ["Market Pulse", "Liquidity Flow", "Sentiment", EDGE_LABELS.gapsTab, "Trends", "Price Discovery"] as const;

export function MarketIntelligence({ players, marketMetrics, sim, envelope }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Market Pulse");

  // Per-tab data-state gating (Feature B follow-on). The Sentiment tab is
  // built entirely on trendingMomentum; the Liquidity Flow tab is built
  // entirely on opportunity. When those fields are missing, the tab body
  // becomes a <DataUnavailable> banner with an honest explanation; tab
  // navigation itself always works.
  // With no envelope we cannot prove the data is real, so default to
  // "unavailable" (honest) rather than "ready" (which would render the
  // behavioral views as if the data were verified).
  const sentimentState = envelope
    ? derivePanelState(envelope, ["trending_momentum"])
    : { status: "unavailable" as const, bannerText: null, unavailable: new Set<string>() };
  const liquidityState = envelope
    ? derivePanelState(envelope, ["opportunity"])
    : { status: "unavailable" as const, bannerText: null, unavailable: new Set<string>() };

  return (
    <PanelCard
      id="market-intelligence"
      titleId="mi-title"
      title="Market Intelligence"
      eyebrow={EDGE_LABELS.marketEyebrow}
    >
      {/* Adjacent to the numbers, on first paint — the SS3 precedent. Protocol 3
          measured this score and it does not identify mispriced players. */}
      <EdgeDisclosureNotice variant="banner" />

      <MarketKPIRow metrics={marketMetrics} players={players} />

      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Market Intelligence tabs"
        idBase="market-intel"
      />

      <TabPanel idBase="market-intel" active={activeTab} className="tab-content">
        {activeTab === "Market Pulse" && (
          <>
            <TopValuationGaps players={marketMetrics.topValuationGaps} />
            <div className="market-charts-row">
              <ValueUsageBoard players={players} />
            </div>
          </>
        )}
        {activeTab === EDGE_LABELS.gapsTab && (
          <TopValuationGaps
            label={EDGE_LABELS.largeGaps}
            players={marketMetrics.topValuationGaps.filter((p) => Math.abs(scarcityGap(p)) >= 8)}
          />
        )}
        {activeTab === "Liquidity Flow" && (
          liquidityState.status === "unavailable" ? (
            <DataUnavailable
              title="Liquidity Flow requires opportunity data"
              description="The Liquidity Flow ranking depends on per-player opportunity (target share, snap share) which has no free integrated data source yet. This becomes available once an in-season snap-count adapter lands."
            />
          ) : (
            <LiquidityFlow players={players} />
          )
        )}
        {activeTab === "Sentiment" && (
          sentimentState.status === "unavailable" ? (
            <DataUnavailable
              title="Sentiment source not integrated"
              description="Sentiment Velocity needs a real news/sentiment feed. The Sleeper-trending proxy populates narrative pressure when you connect a Sleeper league; otherwise this view has nothing real to draw from."
            />
          ) : (
            <SentimentVelocity players={players} />
          )
        )}
        {activeTab === "Trends" && (
          <VolatilitySurface sim={sim} />
        )}
        {activeTab === "Price Discovery" && (
          <PriceDiscoveryView players={players} />
        )}
      </TabPanel>
    </PanelCard>
  );
}

function MarketKPIRow({ metrics, players }: { metrics: MarketMetrics; players: PlayerMarketRecord[] }) {
  const valueIndex = deriveAggregateValueIndex(players);
  // Qualifiers are derived from the actual values — not hardcoded strings that
  // would print "High" / "Favorable" regardless of the number shown.
  const liq = metrics.liquidityScore;
  const regimeKnown = metrics.marketRegime === "Inefficient" || metrics.marketRegime === "Efficient";
  const cards = [
    // Inefficiency + volatility are unitless mispricing/variance INDICES
    // (0-100-ish), not percentages — show the raw index, no "%".
    { label: EDGE_LABELS.gapMagnitude, value: fmt(metrics.valuationGapPct, 1), sub: EDGE_LABELS.gapMagnitudeSub, color: "neu" },
    { label: "Liquidity Score", value: `${fmt(liq, 1)}/10`, sub: liq >= 6.5 ? "High" : liq >= 3.5 ? "Moderate" : "Low", color: liq >= 6.5 ? "pos" : "neu" },
    { label: EDGE_LABELS.gapCountLabel, value: String(metrics.largeGapCount), sub: EDGE_LABELS.gapCountSub, color: "neu" },
    { label: "Aggregate Value", value: valueIndex, sub: "Roster value index (ECR)", color: "neu" },
    { label: "Volatility Index", value: fmt(metrics.priceDiscoveryPct, 1), sub: "Avg week-to-week variance", color: "neu" },
    { label: "Market Regime", value: regimeKnown ? metrics.marketRegime : "—", sub: !regimeKnown ? "No market data" : metrics.marketRegime === "Inefficient" ? "Favorable for exploitation" : "Efficiently priced", color: !regimeKnown ? "neu" : metrics.marketRegime === "Inefficient" ? "neg" : "pos" },
  ];
  return (
    <>
      <div className="kpi-row kpi-row-sm">
        {cards.map((c) => (
          <div key={c.label} className={`kpi-card kpi-${c.color}`}>
            <small>{c.label}</small>
            <strong>{c.value}</strong>
            <span>{c.sub}</span>
          </div>
        ))}
      </div>
      <p className="small-note">
        Indexes combine real market inputs with fixed hand-tuned weights — not yet
        fitted to observed outcomes (QNT-01).
      </p>
    </>
  );
}

function TopValuationGaps({ players, label = EDGE_LABELS.topGapsTable }: { players: PlayerMarketRecord[]; label?: string }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <div className="section-label">{label}</div>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Position</th>
            <th>Market</th>
            <th>True</th>
            <th>{EDGE_LABELS.column}</th>
            <th>Owned %</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {players.length === 0 ? (
            <tr>
              <td colSpan={7}>No validated market records. Enable fixture mode or connect adapters.</td>
            </tr>
          ) : (
            players.map((p) => {
              const edge = scarcityGap(p);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.position}</td>
                  <td>{p.perceivedValue}</td>
                  <td>{p.trueValue}</td>
                  <td className={edge >= 0 ? "pos-text" : "neg-text"}>
                    {edge >= 0 ? `+${edge}` : edge}
                  </td>
                  <td>{Math.round(Math.abs(p.ownershipLeverage))}%</td>
                  <td>{p.trendingMomentum > 0 ? "↗" : p.trendingMomentum < 0 ? "↘" : "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function LiquidityFlow({ players }: { players: PlayerMarketRecord[] }) {
  if (players.length === 0) {
    return <div className="empty-state"><b>No data</b></div>;
  }
  const sorted = [...players].sort((a, b) => b.opportunity - a.opportunity).slice(0, 12);
  const items = sorted.map((p) => ({
    label: surname(p.name),
    value: Math.round(p.opportunity),
    color: p.opportunity > 70 ? "var(--green)" : p.opportunity > 40 ? "var(--amber)" : "var(--muted)",
  }));

  return (
    <div className="liquidity-flow-wrap">
      <div className="section-label">LIQUIDITY FLOW — Players by Opportunity</div>
      <div className="flow-legend">
        <span className="legend-dot liquidity-dot-high" /> High Opportunity
        <span className="legend-dot liquidity-dot-mid legend-dot-ml" /> Moderate
        <span className="legend-dot liquidity-dot-low legend-dot-ml" /> Low
      </div>
      <BarChart items={items} max={100} valueSuffix="" />
      <p className="small-note liquidity-note">
        Bar length = opportunity score (0–100). Green = high-liquidity / high-upside players.
      </p>
    </div>
  );
}

type BoardSort = "value" | "usage" | "edge";

function ValueUsageBoard({ players }: { players: PlayerMarketRecord[] }) {
  // Replaces the old clustered position-grid. A clean, sortable leaderboard:
  // every row carries the player's TRUE value (ECR-derived) bar, a USAGE bar
  // (nflverse snap share, when cached), and the scarcity GAP — so you can
  // rank by what matters and read value/usage/mispricing at a glance instead of
  // squinting at a wall of tinted squares. All three signals are real; usage
  // bars simply don't render when the snap-share source isn't integrated.
  const [sort, setSort] = useState<BoardSort>("value");
  const anyUsage = players.some((p) => p.opportunity > 0);
  const key: BoardSort = sort === "usage" && !anyUsage ? "value" : sort;

  const rows = useMemo(() => {
    const scored = players.map((p) => ({
      p,
      value: Math.max(0, Math.min(100, p.trueValue)),
      usage: Math.max(0, Math.min(100, p.opportunity)),
      edge: scarcityGap(p)
    }));
    scored.sort((a, b) =>
      key === "edge" ? b.edge - a.edge : key === "usage" ? b.usage - a.usage : b.value - a.value
    );
    return scored.slice(0, 14);
  }, [players, key]);
  const maxVal = Math.max(1, ...rows.map((r) => r.value));

  if (players.length === 0) {
    return (
      <div className="vub-wrap">
        <div className="section-label">VALUE × USAGE BOARD</div>
        <p className="muted-note">No validated market records.</p>
      </div>
    );
  }

  const sorters: { k: BoardSort; label: string }[] = [
    { k: "value", label: "Value" },
    ...(anyUsage ? [{ k: "usage" as const, label: "Usage" }] : []),
    { k: "edge", label: "Edge" }
  ];

  return (
    <div className="vub-wrap">
      <div className="vub-head">
        <div className="section-label">VALUE × USAGE BOARD — top players, sortable</div>
        <div className="vub-sorts" role="group" aria-label="Sort the board">
          {sorters.map(({ k, label }) => (
            <button
              key={k}
              type="button"
              className={`vub-sort${key === k ? " active" : ""}`}
              onClick={() => setSort(k)}
              aria-pressed={key === k}
            >
              {label}
              {key === k ? " ↓" : ""}
            </button>
          ))}
        </div>
      </div>
      <ol className="vub-board" aria-label={`Players sorted by ${key}`}>
        {rows.map((r, i) => (
          <li key={r.p.id} className="vub-row">
            <span className="vub-rank">{i + 1}</span>
            <span className="vub-id">
              <span className="vub-name" title={r.p.name}>{r.p.name}</span>
              <span className="vub-pos">{r.p.position}</span>
            </span>
            <span className="vub-bars">
              <span className="vub-bar-track" title={`True value ${Math.round(r.value)}`}>
                <span className="vub-bar vub-bar-value" style={{ ["--w" as string]: `${(r.value / maxVal) * 100}%` }} />
              </span>
              {anyUsage && (
                <span className="vub-bar-track" title={r.usage > 0 ? `Snap usage ${Math.round(r.usage)}%` : "No usage data"}>
                  <span className="vub-bar vub-bar-usage" style={{ ["--w" as string]: `${r.usage}%` }} />
                </span>
              )}
            </span>
            <span className="vub-value">{Math.round(r.value)}</span>
            <span className={`vub-edge ${r.edge >= 0 ? "pos-text" : "neg-text"}`}>
              {r.edge >= 0 ? `+${r.edge}` : r.edge}
            </span>
          </li>
        ))}
      </ol>
      <p className="small-note">
        True value (ECR-derived) with a snap-share usage bar when available, and the scarcity gap (true − market, adjusted).
        {anyUsage ? "" : " Usage bars appear once nflverse snap data is cached."}
      </p>
    </div>
  );
}

function SentimentVelocity({ players }: { players: PlayerMarketRecord[] }) {
  // Real current-snapshot sentiment: count players by the SIGN of their actual
  // trending-momentum. There is no per-day sentiment time-series in the data
  // pipeline, so this is one honest snapshot — not the fabricated 5-point
  // `Math.sin` "7-Day Projection" this previously rendered.
  const positive = players.filter((p) => p.trendingMomentum > 5).length;
  const negative = players.filter((p) => p.trendingMomentum < -5).length;
  const neutral = players.length - positive - negative;
  const items = [
    // From the theme, not from hex literals -- these reach SVG presentation
    // attributes, which cannot resolve var(). Design audit 2026-08-22, D-5.
    { label: "Positive", value: positive, color: THEME.green },
    { label: "Neutral", value: neutral, color: THEME.muted },
    { label: "Negative", value: negative, color: THEME.red },
  ];
  return (
    <div className="chart-wrap">
      <div className="section-label">SENTIMENT DISTRIBUTION — Current snapshot</div>
      <BarChart items={items} max={Math.max(1, players.length)} valueSuffix="" />
      <p className="small-note">
        Players grouped by the sign of their current trending-momentum. No per-day
        sentiment source is integrated, so this is a single snapshot — not a forecast.
      </p>
    </div>
  );
}

function VolatilitySurface({ sim }: { sim: SimulationResult }) {
  // P(playoff outcome | regular-season wins) from the SHARED canonical season
  // sim — the SAME `sim` the Nexus "Outcome Multiverse" reads (deriveAppData,
  // seeded over the user's roster with the real league format). Previously this
  // re-ran an INDEPENDENT sim over the market pool with hardcoded params, so the
  // two outcome heatmaps on /analytics could disagree. Now they always match.
  const heat = useMemo(() => buildOutcomeHeat(sim.distribution), [sim.distribution]);

  return (
    <div className="chart-wrap vol-surface-wrap">
      <div className="section-label">OUTCOME PROBABILITY LANDSCAPE</div>
      {heat ? (
        <Heatmap2D
          xLabels={heat.xLabels}
          yLabels={heat.yLabels}
          data={heat.data}
          colorScale={(v) => DEFAULT_COLOR(heat.maxCell > 0 ? v / heat.maxCell : 0)}
          caption={heat.caption}
          rowAxisLabel="Outcome"
          colAxisLabel="Wins"
        />
      ) : (
        <p className="muted-note">No simulated seasons to chart yet.</p>
      )}
    </div>
  );
}

// Price Discovery as a value-vs-market SCATTER with a PARITY diagonal (y = x).
// Not a "fair value" line: that would assert our number is the fair one and the
// market is in error, which is the claim protocol 3 could not demonstrate.
// A 600-point twin line graph was unreadable; a scatter directly shows
// mispricing: points ABOVE the diagonal are undervalued (true > market),
// BELOW are overvalued. The N most valuable players are plotted (bounded).
const PD_W = 520;
const PD_H = 300;
const PD_PAD = 34;
const PD_MAX_POINTS = 150;

function PriceDiscoveryView({ players }: { players: PlayerMarketRecord[] }) {
  const pts = [...players]
    .filter((p) => p.trueValue > 0 || p.perceivedValue > 0)
    .sort((a, b) => b.trueValue - a.trueValue)
    .slice(0, PD_MAX_POINTS);

  if (pts.length === 0) {
    return (
      <div className="chart-wrap">
        <div className="section-label">PRICE DISCOVERY — True vs Market Value</div>
        <p className="muted-note">No validated market records to chart.</p>
      </div>
    );
  }

  const maxV = Math.max(100, ...pts.map((p) => Math.max(p.trueValue, p.perceivedValue)));
  const x = (v: number) => PD_PAD + (v / maxV) * (PD_W - 2 * PD_PAD);
  const y = (v: number) => PD_H - PD_PAD - (v / maxV) * (PD_H - 2 * PD_PAD);
  // Label the three biggest mispricings (largest |true − market|).
  const labelled = new Set(
    [...pts].sort((a, b) => Math.abs(b.trueValue - b.perceivedValue) - Math.abs(a.trueValue - a.perceivedValue))
      .slice(0, 3)
      .map((p) => p.id)
  );

  return (
    <div className="chart-wrap">
      <div className="section-label">PRICE DISCOVERY — True vs Market Value</div>
      <div className="flow-legend">
        <span className="legend-dot pd-dot-under" /> {EDGE_LABELS.scatterLegendAbove}
        <span className="legend-dot pd-dot-over legend-dot-ml" /> {EDGE_LABELS.scatterLegendBelow}
      </div>
      {/* S5. Every <text> that used to live inside this SVG is now HTML.
          `fontSize="8"` is EIGHT USER UNITS, and this viewBox is laid out at
          whatever width the panel gets: on a 390px phone the UI audit measured
          all six labels reaching the screen at 4.4px. Nothing in CSS could
          reach them, because SVG presentation attributes cannot resolve a
          var(). The desktop-only audit run never saw this; the mobile project
          did, which is the entire reason both viewports are scanned.
          The point labels are positioned as a percentage of the same scales the
          circles use, so a name stays attached to its dot while being real text
          at a real size. */}
      <div className="pd-scatter-wrap">
      <svg viewBox={`0 0 ${PD_W} ${PD_H}`} width="100%" aria-hidden="true"
        className="pd-scatter">
        {/* axes */}
        <line x1={PD_PAD} y1={PD_H - PD_PAD} x2={PD_W - PD_PAD} y2={PD_H - PD_PAD} stroke="var(--line)" strokeWidth="1" />
        <line x1={PD_PAD} y1={PD_PAD} x2={PD_PAD} y2={PD_H - PD_PAD} stroke="var(--line)" strokeWidth="1" />
        {/* parity diagonal y = x — where our value equals the market's */}
        <line x1={x(0)} y1={y(0)} x2={x(maxV)} y2={y(maxV)} stroke="rgba(141,154,160,0.45)" strokeWidth="1" strokeDasharray="4 3" />
        {/* points */}
        {pts.map((p) => {
          const under = p.trueValue >= p.perceivedValue;
          const cx = x(p.perceivedValue);
          const cy = y(p.trueValue);
          const big = labelled.has(p.id);
          return (
            <g key={p.id}>
              <circle cx={cx} cy={cy} r={big ? 4 : 2.6}
                fill={under ? "var(--green)" : "var(--red)"} opacity={big ? 0.95 : 0.6}>
                <title>{`${p.name} — market ${p.perceivedValue}, true ${p.trueValue} (${under ? "+" : ""}${p.trueValue - p.perceivedValue})`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
        {pts
          .filter((p) => labelled.has(p.id))
          .map((p) => (
            <span
              key={p.id}
              className="pd-point-label"
              style={{
                left: `${(x(p.perceivedValue) / PD_W) * 100}%`,
                top: `${(y(p.trueValue) / PD_H) * 100}%`
              }}
            >
              {surname(p.name)}
            </span>
          ))}
        <span className="pd-axis-y">True value &uarr;</span>
        <span className="pd-axis-x">Market value &rarr;</span>
        <span className="pd-parity-label">{EDGE_LABELS.scatterParity}</span>
      </div>
      <p className="small-note">
        {EDGE_LABELS.scatterNote} {pts.length} players shown.
      </p>
      {/* The SVG is aria-hidden, so this is the accessible representation of the
          plot. It carries the same three labelled mispricings the graphic
          highlights, with their actual numbers. */}
      <p className="sr-only">
        {EDGE_LABELS.scatterAria} Largest mispricings:{" "}
        {pts
          .filter((p) => labelled.has(p.id))
          .map(
            (p) =>
              `${p.name}, market ${p.perceivedValue}, true ${p.trueValue}`
          )
          .join("; ")}
        .
      </p>
    </div>
  );
}
