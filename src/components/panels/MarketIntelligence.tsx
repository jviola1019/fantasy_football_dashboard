"use client";

import { useMemo, useState } from "react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";
import { DataUnavailable } from "../ui/DataUnavailable";
import { Heatmap2D, DEFAULT_COLOR } from "@/components/charts/Heatmap2D";
import { BarChart } from "@/components/charts/BarChart";
import { runNexusSimulation } from "@/lib/simulation";
import { buildOutcomeHeat } from "@/lib/outcomeHeat";
import type { MarketMetrics } from "@/lib/derivedMetrics";
import { reputationEdge, confidenceInterval } from "@/lib/models";
import { deriveAggregateValueIndex } from "@/lib/derivedMetrics";
import { fmt, surname } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  marketMetrics: MarketMetrics;
  envelope?: RAEEnvelope;
};

const TABS = ["Market Pulse", "Liquidity Flow", "Sentiment", "Arbitrage", "Trends", "Price Discovery"] as const;

export function MarketIntelligence({ players, marketMetrics, envelope }: Props) {
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
      eyebrow="Find edges. Exploit inefficiencies."
    >
      <MarketKPIRow metrics={marketMetrics} players={players} />

      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Market Intelligence tabs"
      />

      <div className="tab-content">
        {activeTab === "Market Pulse" && (
          <>
            <TopInefficiencies players={marketMetrics.topInefficiencies} />
            <div className="market-charts-row">
              <MarketEfficiencyHeatmap players={players} />
            </div>
          </>
        )}
        {activeTab === "Arbitrage" && (
          <TopInefficiencies
            label="ARBITRAGE PLAYS — |edge| ≥ 8"
            players={marketMetrics.topInefficiencies.filter((p) => Math.abs(reputationEdge(p)) >= 8)}
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
          <VolatilitySurface players={players} />
        )}
        {activeTab === "Price Discovery" && (
          <PriceDiscoveryView players={players} />
        )}
      </div>
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
    // Inefficiency + volatility are unitless VOR/variance INDICES (0-100-ish),
    // not percentages — show the raw index, no "%".
    { label: "Market Inefficiency", value: fmt(metrics.inefficiencyPct, 1), sub: "Avg value-over-replacement index", color: "neu" },
    { label: "Liquidity Score", value: `${fmt(liq, 1)}/10`, sub: liq >= 6.5 ? "High" : liq >= 3.5 ? "Moderate" : "Low", color: liq >= 6.5 ? "pos" : "neu" },
    { label: "Arbitrage Opps", value: String(metrics.arbitrageCount), sub: "High-edge plays", color: metrics.arbitrageCount > 3 ? "pos" : "neu" },
    { label: "Aggregate Value", value: valueIndex, sub: "Roster value index (ECR)", color: "neu" },
    { label: "Volatility Index", value: fmt(metrics.priceDiscoveryPct, 1), sub: "Avg week-to-week variance", color: "neu" },
    { label: "Market Regime", value: regimeKnown ? metrics.marketRegime : "—", sub: !regimeKnown ? "No market data" : metrics.marketRegime === "Inefficient" ? "Favorable for exploitation" : "Efficiently priced", color: !regimeKnown ? "neu" : metrics.marketRegime === "Inefficient" ? "neg" : "pos" },
  ];
  return (
    <div className="kpi-row kpi-row-sm">
      {cards.map((c) => (
        <div key={c.label} className={`kpi-card kpi-${c.color}`}>
          <small>{c.label}</small>
          <strong>{c.value}</strong>
          <span>{c.sub}</span>
        </div>
      ))}
    </div>
  );
}

function TopInefficiencies({ players, label = "TOP INEFFICIENCIES" }: { players: PlayerMarketRecord[]; label?: string }) {
  return (
    <div className="table-wrap" tabIndex={0}>
      <div className="section-label">{label}</div>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Market</th>
            <th>True</th>
            <th>Edge</th>
            <th>Own%</th>
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
              const edge = reputationEdge(p);
              const ci = confidenceInterval(p.trueValue, p.confidence);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.position}</td>
                  <td>{p.perceivedValue}</td>
                  <td>
                    {p.trueValue}{" "}
                    <small>[{ci[0]}, {ci[1]}]</small>
                  </td>
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

const HEAT_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
// Players shown per position. The row grid is driven off this via the
// `--heat-cols` custom property, and the wrap scrolls horizontally on narrow
// screens, so this can grow without crushing the cells.
const HEAT_COLS = 8;

function MarketEfficiencyHeatmap({ players }: { players: PlayerMarketRecord[] }) {
  // A readable Value × Usage map. Per position, the top HEAT_COLS players by
  // value; each labelled cell encodes TWO real signals: background intensity =
  // value (0-100, FantasyPros ECR), and a bottom bar = usage (nflverse snap
  // share, when the opportunity cron has run). The old version was unlabelled
  // colour squares — you couldn't tell who or what.
  const anyUsage = players.some((p) => p.opportunity > 0);
  return (
    <div className="heatmap-wrap">
      <div className="section-label">VALUE × USAGE — top players by position</div>
      <div className="heat-axis-hint" aria-hidden="true">most valuable →</div>
      {HEAT_POSITIONS.map((pos) => {
        const group = players
          .filter((p) => p.position === pos)
          .sort((a, b) => b.trueValue - a.trueValue)
          .slice(0, HEAT_COLS);
        return (
          <div className="heat-row2" key={pos} style={{ ["--heat-cols" as string]: String(HEAT_COLS) }}>
            <span className="heat-pos">{pos}</span>
            {Array.from({ length: HEAT_COLS }).map((_, i) => {
              const p = group[i];
              if (!p) return <span key={i} className="heat-cell2 heat-cell-empty" aria-hidden="true" />;
              const v = Math.max(0, Math.min(100, p.trueValue));
              const frac = v / 100;
              const usage = Math.max(0, Math.min(100, p.opportunity));
              const edge = reputationEdge(p);
              const last = surname(p.name);
              return (
                <span
                  key={p.id}
                  className="heat-cell2"
                  title={`${p.name} — value ${Math.round(v)}${usage > 0 ? `, usage ${Math.round(usage)}% snaps` : ""}, edge ${edge >= 0 ? "+" : ""}${edge}`}
                  /* Cap the slate fill so the cream label clears WCAG AA 4.5:1
                     even on the most-valuable (darkest-text) cell. */
                  style={{ ["--heat-f" as string]: String(0.12 + frac * 0.4) }}
                >
                  <span className="heat-cell-name">{last}</span>
                  <span className="heat-cell-val">{Math.round(v)}</span>
                  {usage > 0 && (
                    <span className="heat-usage" aria-hidden="true">
                      <span className="heat-usage-fill" style={{ ["--u" as string]: `${usage}%` }} />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
      <div className="heat-legend2">
        <span className="heat-legend-swatch" /> value (cell)
        {anyUsage ? <><span className="heat-legend-bar2" /> usage = snap %</> : <span className="heat-legend-note2">usage bar appears once snap data is cached</span>}
      </div>
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
    { label: "Positive", value: positive, color: "#77d7b0" },
    { label: "Neutral", value: neutral, color: "#8d9aa0" },
    { label: "Negative", value: negative, color: "#d9866f" },
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

function VolatilitySurface({ players }: { players: PlayerMarketRecord[] }) {
  // Honest landscape: P(playoff outcome | regular-season wins) from the season
  // sim — each win-total column sums to 100% (a real conditional distribution),
  // so more wins reads as never-worse title odds. The old version swept five
  // risk-tolerance columns, whose rows came out dead-flat for any real team.
  const heat = useMemo(() => {
    if (players.length === 0) return null;
    const sim = runNexusSimulation(players, {
      seed: 20260513,
      iterations: 2500,
      rosterSlots: 6,
      riskTolerance: 0.5
    });
    return buildOutcomeHeat(sim.distribution);
  }, [players]);

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
        />
      ) : (
        <p className="muted-note">No simulated seasons to chart yet.</p>
      )}
    </div>
  );
}

// Price Discovery as a value-vs-market SCATTER with a fair-value diagonal.
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
        <span className="legend-dot pd-dot-under" /> Undervalued (true &gt; market)
        <span className="legend-dot pd-dot-over legend-dot-ml" /> Overvalued
      </div>
      <svg viewBox={`0 0 ${PD_W} ${PD_H}`} width="100%" role="img"
        aria-label="Scatter of true value versus market value; points above the diagonal are undervalued"
        className="pd-scatter">
        {/* axes */}
        <line x1={PD_PAD} y1={PD_H - PD_PAD} x2={PD_W - PD_PAD} y2={PD_H - PD_PAD} stroke="var(--line)" strokeWidth="1" />
        <line x1={PD_PAD} y1={PD_PAD} x2={PD_PAD} y2={PD_H - PD_PAD} stroke="var(--line)" strokeWidth="1" />
        {/* fair-value diagonal y = x */}
        <line x1={x(0)} y1={y(0)} x2={x(maxV)} y2={y(maxV)} stroke="rgba(141,154,160,0.45)" strokeWidth="1" strokeDasharray="4 3" />
        <text x={x(maxV) - 4} y={y(maxV) - 6} fontSize="8" fill="var(--muted)" textAnchor="end">fair value</text>
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
              {big && (
                <text x={cx + 5} y={cy - 4} fontSize="8" fill="var(--cream)">{surname(p.name)}</text>
              )}
            </g>
          );
        })}
        <text x={PD_W - PD_PAD} y={PD_H - PD_PAD + 14} fontSize="8" fill="var(--muted)" textAnchor="end">Market value →</text>
        <text x={PD_PAD - 6} y={PD_PAD - 6} fontSize="8" fill="var(--muted)">True value ↑</text>
      </svg>
      <p className="small-note">
        Each dot is a player; distance from the dashed fair-value line = mispricing. {pts.length} players shown.
      </p>
    </div>
  );
}
