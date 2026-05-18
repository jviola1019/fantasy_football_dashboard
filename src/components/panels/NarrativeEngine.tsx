"use client";

import { useState } from "react";
import type { PlayerMarketRecord } from "@/lib/governance";
import { Canvas3D } from "../three/Canvas3D";
import { NarrativeField } from "../three/scenes/NarrativeField";

import {
  deriveNarrativeHalfLife,
  deriveViralVelocity,
  deriveStoryCollisions,
} from "@/lib/derivedMetrics";
import { LineChart } from "@/components/charts/LineChart";
import { avg } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
};

const TABS = ["Narrative Flow", "Impact Over Time", "Collisions", "Sentiment Map"] as const;
const TIME_LABELS = ["Oct 16", "Oct 23", "Oct 30", "Nov 6", "Now"];

export function NarrativeEngine({ players }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Narrative Flow");
  const [timeRange, setTimeRange] = useState("7D");
  const halfLife = deriveNarrativeHalfLife(players);
  const viralVel = deriveViralVelocity(players);
  const tone = avg(players.map((p) => p.narrativePressure)) / 100;
  const collisions = deriveStoryCollisions(players);

  return (
    <section className="system-panel panel-narrative" id="narrative-engine" aria-labelledby="ne-title">
      <div className="panel-header-row">
        <div className="panel-title">
          <div className="panel-icon">〜</div>
          <div>
            <h2 id="ne-title">Narrative Engine</h2>
            <p className="panel-eyebrow">Decode stories. Anticipate outcomes.</p>
          </div>
        </div>
        <div className="panel-header-controls">
          <select className="galaxy-select" value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            {["1D", "7D", "30D", "3M"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Narrative Engine tabs">
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

      {activeTab === "Narrative Flow" && (
        <div className="narrative-layout">
          <NarrativeFlowField players={players} />
          <div className="narrative-metrics">
            <HalfLifeCard halfLife={halfLife} />
            <ToneGauge tone={tone} />
            <VelocityBadge velocity={viralVel} />
          </div>
        </div>
      )}
      {activeTab === "Impact Over Time" && (
        <NarrativeImpactChart players={players} />
      )}
      {activeTab === "Collisions" && (
        <StoryCollisions collisions={collisions} />
      )}
      {activeTab === "Sentiment Map" && (
        <SentimentMap players={players} />
      )}
    </section>
  );
}

function NarrativeFlowField({ players }: { players: PlayerMarketRecord[] }) {
  if (players.length === 0) {
    return <div className="empty-state"><b>No narrative data</b></div>;
  }
  return (
    <div className="narrative-flow-svg" aria-label="3-D narrative flow field">
      <Canvas3D
        ariaLabel="3-D narrative ribbons encoding velocity and direction"
        height={260}
      >
        <NarrativeField players={players} />
      </Canvas3D>
    </div>
  );
}

function HalfLifeCard({ halfLife }: { halfLife: number }) {
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">NARRATIVE HALF-LIFE</div>
      <div className="nm-value">{Number.isFinite(halfLife) ? `${halfLife} Days` : "—"}</div>
      <div className="nm-sub">Avg story decay rate</div>
    </div>
  );
}

function ToneGauge({ tone }: { tone: number }) {
  const r = 36;
  const cx = 50;
  const cy = 48;
  const pct = Math.min(1, Math.max(0, (tone + 1) / 2));
  const angle = -180 + pct * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);
  const label = tone > 0.1 ? "Positive" : tone < -0.1 ? "Slightly Negative" : "Neutral";
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">EMOTIONAL TONE</div>
      <svg viewBox="0 0 100 60" width="100%" aria-hidden="true">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="rgba(214,226,226,0.1)" strokeWidth="8" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * pct * 2 - r} ${cy - r * Math.sin(pct * Math.PI)}`}
          fill="none" stroke={tone >= 0 ? "#77d7b0" : "#d9866f"} strokeWidth="8" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--cream)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="var(--cream)" />
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--cream)" fontWeight="600">
          {Number.isFinite(tone) ? tone.toFixed(2) : "—"}
        </text>
      </svg>
      <div className="nm-sub">{label}</div>
    </div>
  );
}

function VelocityBadge({ velocity }: { velocity: string }) {
  const color = velocity === "High" ? "#77d7b0" : velocity === "Medium" ? "#d7a857" : "#d9866f";
  return (
    <div className="narrative-metric-card">
      <div className="nm-label">VIRAL VELOCITY</div>
      <div className="nm-value" style={{ color }}>{velocity}</div>
      <div className="nm-sub">Current momentum tier</div>
    </div>
  );
}

function NarrativeImpactChart({ players }: { players: PlayerMarketRecord[] }) {
  const makePoints = (scale: number) =>
    TIME_LABELS.map((_, i) => {
      const t = i / (TIME_LABELS.length - 1);
      const base = avg(players.map((p) => Math.abs(p.narrativePressure) * scale)) || 25;
      return Math.round(base * (0.7 + 0.6 * Math.sin(t * Math.PI + scale)));
    });

  const series = [
    { label: "Positive", color: "#77d7b0", points: makePoints(0.8) },
    { label: "Negative", color: "#d9866f", points: makePoints(-0.5) },
    { label: "Neutral", color: "#8d9aa0", points: makePoints(0.1) },
  ];

  return (
    <div className="chart-wrap">
      <div className="section-label">NARRATIVE IMPACT OVER TIME</div>
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

function StoryCollisions({
  collisions,
}: {
  collisions: ReturnType<typeof deriveStoryCollisions>;
}) {
  return (
    <div className="table-wrap">
      <div className="section-label">STORY COLLISIONS</div>
      <table>
        <thead>
          <tr>
            <th>Story</th>
            <th>Player</th>
            <th>Impact</th>
          </tr>
        </thead>
        <tbody>
          {collisions.length === 0 ? (
            <tr><td colSpan={3}>No significant collisions detected.</td></tr>
          ) : (
            collisions.map(({ player, story, impact }) => (
              <tr key={player.id}>
                <td>{story}</td>
                <td>{player.name}</td>
                <td className={impact === "High" ? "pos-text" : "neu-text"}>{impact}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SentimentMap({ players }: { players: PlayerMarketRecord[] }) {
  return (
    <div className="table-wrap">
      <div className="section-label">TOP NARRATIVES — Sentiment Map</div>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Injury</th>
            <th>Breakout</th>
            <th>Trade</th>
            <th>Regression</th>
            <th>Controversy</th>
            <th>Off Field</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className={p.fragility > 50 ? "neg-text" : "pos-text"}>{p.fragility > 50 ? "+risk" : "—"}</td>
              <td className={p.opportunity > 70 ? "pos-text" : "muted-text"}>{p.opportunity > 70 ? "+surge" : "—"}</td>
              <td className={p.ownershipLeverage < -20 ? "neg-text" : "muted-text"}>{p.ownershipLeverage < -20 ? "+rumors" : "—"}</td>
              <td className={p.perceivedValue > p.trueValue + 10 ? "neg-text" : "muted-text"}>{p.perceivedValue > p.trueValue + 10 ? "+risk" : "—"}</td>
              <td className={Math.abs(p.narrativePressure) > 50 ? "neg-text" : "muted-text"}>{Math.abs(p.narrativePressure) > 50 ? "+active" : "—"}</td>
              <td className="muted-text">—</td>
            </tr>
          ))}
          {players.length === 0 && (
            <tr><td colSpan={7}>No data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
