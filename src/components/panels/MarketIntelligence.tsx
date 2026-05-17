"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
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
  const reduceMotion = useReducedMotion();
  if (players.length === 0) {
    return <div className="empty-state"><b>No data</b></div>;
  }
  return (
    <div className="liquidity-flow-wrap">
      <div className="section-label">LIQUIDITY FLOW</div>
      <div className="flow-legend">
        <span className="legend-dot" style={{ background: "#4dd9c0" }} /> High Liquidity
        <span className="legend-dot" style={{ background: "#d9866f", marginLeft: 12 }} /> Low Liquidity
      </div>
      <svg viewBox="0 0 580 220" width="100%" aria-hidden="true">
        {players.map((p, i) => {
          const isHigh = p.opportunity > 60;
          const color = isHigh ? "#4dd9c0" : "#d9866f";
          const y0 = 30 + (i / (players.length - 1 || 1)) * 160;
          const cp1x = 180 + p.opportunity * 0.8;
          const cp1y = y0 - p.volatility * 0.4;
          const cp2x = 360 - p.fragility * 0.5;
          const cp2y = y0 + p.volatility * 0.3;
          const y1 = 30 + ((players.length - 1 - i) / (players.length - 1 || 1)) * 160;
          const d = `M 10 ${y0} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, 570 ${y1}`;
          return (
            <motion.path
              key={p.id}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1 + p.confidence * 1.5}
              opacity="0.5"
              className="flow-path"
              initial={false}
              animate={reduceMotion ? {} : { pathLength: [0.2, 1, 0.2] }}
              transition={{ duration: 6 + i * 0.4, repeat: Infinity }}
            />
          );
        })}
      </svg>
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
  const cols = 7;
  const rows = 4;
  const W = 560;
  const H = 180;
  const amplitude = avg(players.map((p) => p.volatility)) / 2 || 20;
  const cellW = W / (cols - 1);
  const baseY = H / 2;

  const vertices = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const x = col * cellW;
      const y = baseY + Math.sin(col * 0.9 + row * 0.7) * amplitude * (0.5 + row * 0.2);
      return { x, y };
    })
  );

  return (
    <div className="chart-wrap">
      <div className="section-label">VOLATILITY SURFACE — Simulated Envelope</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        {vertices.map((rowPts, row) => (
          <polyline
            key={`h-${row}`}
            points={rowPts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={`rgba(123,183,206,${0.15 + row * 0.08})`}
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: cols }, (_, col) => (
          <polyline
            key={`v-${col}`}
            points={vertices.map((r) => `${r[col]?.x},${r[col]?.y}`).join(" ")}
            fill="none"
            stroke="rgba(123,183,206,0.12)"
            strokeWidth="1"
          />
        ))}
        <text x="0" y={H - 4} fontSize="9" fill="var(--muted)">High Volatility</text>
        <text x={W} y={H - 4} fontSize="9" fill="var(--green)" textAnchor="end">Low Volatility</text>
      </svg>
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
