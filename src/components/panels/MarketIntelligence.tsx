"use client";

import { useState } from "react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { Canvas3D } from "../three/Canvas3D";
import { LiquidityFlow as LiquidityFlowScene } from "../three/scenes/LiquidityFlow";
import { VolatilitySurface as VolatilitySurfaceScene } from "../three/scenes/VolatilitySurface";
import { runNexusSimulation } from "@/lib/simulation";
import type { MarketMetrics } from "@/lib/derivedMetrics";
import { reputationEdge, narrativeVelocity, marketInefficiency, confidenceInterval } from "@/lib/models";
import { deriveLiquidityDepth } from "@/lib/derivedMetrics";
import { LineChart } from "@/components/charts/LineChart";
import { avg, fmt, fmtPct } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  marketMetrics: MarketMetrics;
};

const TABS = ["Market Pulse", "Liquidity Flow", "Sentiment", "Arbitrage", "Trends", "Price Discovery"] as const;
const TIME_LABELS = ["Oct 16", "Oct 23", "Oct 30", "Nov 6", "Now"];

export function MarketIntelligence({ players, marketMetrics }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Market Pulse");

  return (
    <section className="system-panel panel-market" id="market-intelligence" aria-labelledby="mi-title">
      <div className="panel-header-row">
        <div className="panel-title">
          <div className="panel-icon">📊</div>
          <div>
            <h2 id="mi-title">Market Intelligence</h2>
            <p className="panel-eyebrow">Find edges. Exploit inefficiencies.</p>
          </div>
        </div>
      </div>

      <MarketKPIRow metrics={marketMetrics} players={players} />

      <div className="tab-row" role="tablist" aria-label="Market Intelligence tabs">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            className={`tab-btn${activeTab === t ? " active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {(activeTab === "Market Pulse" || activeTab === "Arbitrage") && (
          <>
            <TopInefficiencies players={marketMetrics.topInefficiencies} />
            <div className="market-charts-row">
              <MarketEfficiencyHeatmap players={players} />
            </div>
          </>
        )}
        {activeTab === "Liquidity Flow" && (
          <LiquidityFlow players={players} />
        )}
        {activeTab === "Sentiment" && (
          <SentimentVelocity players={players} />
        )}
        {activeTab === "Trends" && (
          <VolatilitySurface players={players} />
        )}
        {activeTab === "Price Discovery" && (
          <PriceDiscoveryView players={players} />
        )}
      </div>
    </section>
  );
}

function MarketKPIRow({ metrics, players }: { metrics: MarketMetrics; players: PlayerMarketRecord[] }) {
  const depth = deriveLiquidityDepth(players);
  const priceDisc = fmtPct(metrics.priceDiscoveryPct);
  const cards = [
    { label: "Market Inefficiency", value: fmtPct(metrics.inefficiencyPct), sub: "Avg Value Over Replacement", color: "neu" },
    { label: "Liquidity Score", value: `${fmt(metrics.liquidityScore, 1)}/10`, sub: "High", color: "pos" },
    { label: "Arbitrage Opps", value: String(metrics.arbitrageCount), sub: "High Edge Plays", color: metrics.arbitrageCount > 3 ? "pos" : "neu" },
    { label: "Liquidity Depth", value: depth, sub: "Total Market Cap", color: "neu" },
    { label: "Price Discovery", value: priceDisc, sub: "vs Last Week", color: "pos" },
    { label: "Market Regime", value: metrics.marketRegime, sub: "Favorable for Exploitation", color: metrics.marketRegime === "Inefficient" ? "neg" : "pos" },
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

function TopInefficiencies({ players }: { players: PlayerMarketRecord[] }) {
  return (
    <div className="table-wrap">
      <div className="section-label">TOP INEFFICIENCIES</div>
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
                  <td>${p.perceivedValue}</td>
                  <td>
                    ${p.trueValue}{" "}
                    <small>[{ci[0]}, {ci[1]}]</small>
                  </td>
                  <td className={edge >= 0 ? "pos-text" : "neg-text"}>
                    {edge >= 0 ? `+${edge}` : edge}
                  </td>
                  <td>{Math.round(Math.abs(p.ownershipLeverage))}%</td>
                  <td>{narrativeVelocity(p) >= 0 ? "↗" : "↘"}</td>
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
  return (
    <div className="liquidity-flow-wrap">
      <div className="section-label">LIQUIDITY FLOW</div>
      <div className="flow-legend">
        <span className="legend-dot" style={{ background: "#4dd9c0" }} /> High Liquidity
        <span className="legend-dot" style={{ background: "#f0abfc", marginLeft: 12 }} /> High Inefficiency
      </div>
      <Canvas3D
        ariaLabel="3-D liquidity flow ribbons encoding opportunity and market inefficiency"
        height={220}
      >
        <LiquidityFlowScene players={players} />
      </Canvas3D>
    </div>
  );
}

function MarketEfficiencyHeatmap({ players }: { players: PlayerMarketRecord[] }) {
  const positions = ["QB", "RB", "WR", "TE"];
  return (
    <div className="heatmap-wrap">
      <div className="section-label">MARKET EFFICIENCY HEATMAP — By Position</div>
      {positions.map((pos) => {
        const group = players.filter((p) => p.position === pos);
        const baseIneff = group.length ? avg(group.map(marketInefficiency)) : 0;
        return (
          <div className="heat-row" key={pos}>
            <b>{pos}</b>
            {Array.from({ length: 10 }).map((_, i) => {
              const intensity = baseIneff + i * 2.2;
              const frac = Math.min(1, intensity / 40);
              return (
                <span
                  key={i}
                  className="heat-cell"
                  style={{
                    background: `rgba(${Math.round(215 + frac * 40)}, ${Math.round(150 - frac * 80)}, ${Math.round(130 - frac * 60)}, ${0.2 + frac * 0.65})`,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SentimentVelocity({ players }: { players: PlayerMarketRecord[] }) {
  const base = (scale: number) =>
    TIME_LABELS.map((_, i) => {
      const t = i / (TIME_LABELS.length - 1);
      const baseVal = avg(players.map((p) => Math.max(0, p.narrativePressure * scale))) || 30;
      return Math.round(baseVal * (0.8 + 0.4 * Math.sin(t * Math.PI + scale)));
    });

  const series = [
    { label: "Positive", color: "#77d7b0", points: base(0.8) },
    { label: "Neutral", color: "#8d9aa0", points: base(0) },
    { label: "Negative", color: "#d9866f", points: base(-0.6) },
  ];

  return (
    <div className="chart-wrap">
      <div className="section-label">SENTIMENT VELOCITY — 7-Day Projection</div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className="legend-item">
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <LineChart series={series} labels={TIME_LABELS} height={130} />
    </div>
  );
}

function VolatilitySurface({ players }: { players: PlayerMarketRecord[] }) {
  const sim = runNexusSimulation(players, { seed: 20260513, iterations: 1000, rosterSlots: 6, riskTolerance: 0.5 });
  return (
    <div className="chart-wrap">
      <div className="section-label">VOLATILITY SURFACE — Simulated Envelope</div>
      <Canvas3D
        ariaLabel="3-D volatility surface encoding playoff probability and catastrophic risk"
        height={220}
      >
        <VolatilitySurfaceScene sim={sim} />
      </Canvas3D>
      <div className="vol-surface-legend">
        <span className="muted-text">High Volatility</span>
        <span className="pos-text">Low Volatility</span>
      </div>
    </div>
  );
}

function PriceDiscoveryView({ players }: { players: PlayerMarketRecord[] }) {
  const series = [
    {
      label: "Market Value",
      color: "#7bb7ce",
      points: [...players].sort((a, b) => a.perceivedValue - b.perceivedValue).map((p) => p.perceivedValue),
    },
    {
      label: "True Value",
      color: "#77d7b0",
      points: [...players].sort((a, b) => a.perceivedValue - b.perceivedValue).map((p) => p.trueValue),
    },
  ];
  const labels = [...players].sort((a, b) => a.perceivedValue - b.perceivedValue).map((p) =>
    p.name.split(" ").pop() ?? ""
  );
  return (
    <div className="chart-wrap">
      <div className="section-label">PRICE DISCOVERY — Market vs True Value</div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className="legend-item">
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <LineChart series={series} labels={labels} height={140} />
    </div>
  );
}
