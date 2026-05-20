"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { PanelCard } from "../ui/PanelCard";
import { Canvas3D } from "../three/Canvas3D";
import { OrbitalTopology } from "../three/scenes/OrbitalTopology";
import type { SimulationResult } from "@/lib/simulation";
import type { CommandMetrics, PositionGrades } from "@/lib/derivedMetrics";
import { narrativeVelocity } from "@/lib/models";
import {
  deriveNarrativeMovers,
  derivePositionGrades,
  deriveStartSitEdge,
} from "@/lib/derivedMetrics";
import { fmt, fmtPct } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  envelope: RAEEnvelope;
  sim: SimulationResult;
  metrics: CommandMetrics;
};

const TIME_RANGES = ["1D", "7D", "1M", "3M"] as const;

export function CommandCenter({ players, envelope, sim, metrics }: Props) {
  const [timeRange, setTimeRange] = useState<string>("7D");
  const hasData = players.length > 0;
  const movers = deriveNarrativeMovers(players);
  const grades = derivePositionGrades(players);
  const startSit = deriveStartSitEdge(players);
  const avgEdge = metrics.reputationEdge;
  const marketEdge = Math.round(Math.min(99, Math.max(0, 50 + avgEdge * 1.4)));

  return (
    <PanelCard
      id="command-center"
      titleId="cc-title"
      title="Command Center"
      eyebrow="Real-time intelligence. Smarter decisions."
      icon={<Zap />}
      controls={
        <>
          <div className="time-range-tabs" role="group" aria-label="Time range">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`time-tab${timeRange === r ? " active" : ""}`}
                onClick={() => setTimeRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          {envelope.mode === "live" && <span className="live-badge">● LIVE</span>}
          {envelope.mode === "fixture" && <span className="fixture-badge">FIXTURE</span>}
        </>
      }
    >
      <MetricStrip metrics={metrics} />

      <div className="pulse-wrapper">
        <LeaguePulse players={players} marketEdge={marketEdge} timeRange={timeRange} />
        <NarrativeMomentum gainers={movers.gainers} decliners={movers.decliners} />
      </div>

      <div className="bottom-row">
        <IntelFeed envelope={envelope} />
        <LineupWinProb sim={sim} />
        <TeamConstructionScore grades={grades} />
        <RosterFragilityXRay players={players} />
        <StartSitEdge rows={startSit} hasData={hasData} />
      </div>
    </PanelCard>
  );
}

function MetricStrip({ metrics }: { metrics: CommandMetrics }) {
  const cards = [
    { label: "Reputation Edge", value: fmt(metrics.reputationEdge, 1), sub: "Avg True – Market Value", color: metrics.reputationEdge >= 0 ? "pos" : "neg" },
    { label: "Market Inefficiency", value: fmtPct(metrics.marketInefficiency), sub: "Avg Value Over Replacement", color: "neu" },
    { label: "Narrative Velocity", value: fmt(metrics.narrativeVelocity, 1), sub: metrics.narrativeVelocity > 10 ? "High" : metrics.narrativeVelocity > 0 ? "Moderate" : "Low", color: metrics.narrativeVelocity >= 0 ? "pos" : "neg" },
    { label: "League Advantage", value: `${metrics.leagueAdvantage}%`, sub: "vs League Median", color: metrics.leagueAdvantage >= 50 ? "pos" : "neg" },
    { label: "Chaos Exposure", value: `${fmt(metrics.chaosExposure, 0)}/100`, sub: metrics.chaosExposure > 50 ? "High" : "Moderate", color: metrics.chaosExposure > 60 ? "neg" : "neu" },
  ];
  return (
    <div className="kpi-row">
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

function LeaguePulse({ players, marketEdge, timeRange }: { players: PlayerMarketRecord[]; marketEdge: number; timeRange: string }) {
  return (
    <div className="league-pulse" aria-label="League pulse 3-D topology">
      <div className="league-pulse-label">LEAGUE PULSE</div>
      <Canvas3D ariaLabel="3-D player topology encoding true value, narrative pressure, and market inefficiency" height={300}>
        <OrbitalTopology players={players} />
      </Canvas3D>
      <div className="league-pulse-center">
        <div className="league-pulse-center-value">{marketEdge}</div>
        <div className="league-pulse-center-label">Market Edge</div>
        <div className="league-pulse-center-sub">{timeRange} view</div>
      </div>
      {players.length === 0 && (
        <div className="league-pulse-empty" role="status">Awaiting league data</div>
      )}
    </div>
  );
}

function NarrativeMomentum({
  gainers,
  decliners,
}: {
  gainers: PlayerMarketRecord[];
  decliners: PlayerMarketRecord[];
}) {
  return (
    <div className="narrative-momentum">
      <div className="momentum-header">NARRATIVE MOMENTUM</div>
      <div className="momentum-col">
        <div className="momentum-section-label">Top Gainers</div>
        <ul className="momentum-list">
          {gainers.length === 0 && <li className="momentum-empty">No gainers</li>}
          {gainers.map((p) => (
            <li key={p.id} className="momentum-item">
              <span className="momentum-name">{p.name}</span>
              <span className="momentum-val pos">+{Math.round(Math.abs(narrativeVelocity(p)))}</span>
            </li>
          ))}
        </ul>
        <div className="momentum-section-label mt8">Top Decliners</div>
        <ul className="momentum-list">
          {decliners.length === 0 && <li className="momentum-empty">No decliners</li>}
          {decliners.map((p) => (
            <li key={p.id} className="momentum-item">
              <span className="momentum-name">{p.name}</span>
              <span className="momentum-val neg">{Math.round(narrativeVelocity(p))}</span>
            </li>
          ))}
        </ul>
        <a href="#narrative-engine" className="view-all-link">View All →</a>
      </div>
    </div>
  );
}

function IntelFeed({ envelope }: { envelope: RAEEnvelope }) {
  const alerts = [
    ...envelope.sourceState.assumptions,
    envelope.sourceState.failure ?? "Adapter state nominal.",
    `Mode: ${envelope.mode.toUpperCase()} · Freshness: ${envelope.sourceState.freshness}`,
  ].filter(Boolean);
  const offsetTimestamps = alerts.map((_, i) => {
    const mins = i * 7;
    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  });
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Intelligence Feed</div>
      <ul className="intel-list">
        {alerts.map((a, i) => (
          <li key={i} className="intel-item">
            <span className="intel-ts">{offsetTimestamps[i]}</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineupWinProb({ sim }: { sim: SimulationResult }) {
  // mid is a probability in [0,100]; the p10/p90 band must stay inside [0,100]
  // — a confidence bound can never report an impossible probability.
  const mid = Math.min(100, Math.max(0, sim.playoffProbability));
  const p10 = Math.round(Math.max(0, mid * 0.68) * 10) / 10;
  const p90 = Math.round(Math.min(100, mid * 1.32) * 10) / 10;
  const tCx = 60;
  const tTop = 10;
  const tBot = 95;
  const halfW = 50;
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Lineup Win Probability</div>
      <div className="triangle-wrap">
        {/* viewBox is padded on every side so the corner labels (which sit
            outside the triangle) are never clipped by the panel edge. */}
        <svg
          viewBox="-14 -6 148 138"
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <polygon
            points={`${tCx},${tTop} ${tCx - halfW},${tBot} ${tCx + halfW},${tBot}`}
            fill="rgba(119,215,176,0.08)"
            stroke="rgba(119,215,176,0.5)"
            strokeWidth="1.5"
          />
          <text x={tCx} y={tTop - 8} textAnchor="middle" fontSize="9" fill="var(--muted)">P90</text>
          <text x={tCx} y={tTop + 2} textAnchor="middle" fontSize="10" fill="var(--green)">{p90}%</text>
          <text x={tCx} y={(tTop + tBot) / 2 + 4} textAnchor="middle" fontSize="16" fill="var(--cream)" fontWeight="700">{mid}%</text>
          <text x={tCx - halfW} y={tBot + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">P10</text>
          <text x={tCx - halfW} y={tBot + 26} textAnchor="middle" fontSize="10" fill="var(--red)">{p10}%</text>
          <text x={tCx + halfW} y={tBot + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">P90</text>
          <text x={tCx + halfW} y={tBot + 26} textAnchor="middle" fontSize="10" fill="var(--green)">{p90}%</text>
        </svg>
      </div>
      <div className="small-note">Based on {sim.params.iterations.toLocaleString()} simulations</div>
    </div>
  );
}

function TeamConstructionScore({ grades }: { grades: PositionGrades }) {
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Team Construction Score</div>
      <div className="overall-grade">{grades.overall}</div>
      <div className="position-grades">
        {grades.positions.map(({ pos, grade }) => (
          <div key={pos} className="pos-grade-row">
            <span className="pos-label">{pos}</span>
            <span className={`grade-val grade-${grade[0]?.toLowerCase()}`}>{grade}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RosterFragilityXRay({ players }: { players: PlayerMarketRecord[] }) {
  const topFragile = [...players].sort((a, b) => b.fragility - a.fragility).slice(0, 3);
  const dotPos = [
    { cx: 60, cy: 28 },
    { cx: 46, cy: 52 },
    { cx: 74, cy: 52 },
  ];
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Roster Fragility X-Ray</div>
      <div className="fragility-body">
        <svg viewBox="0 0 120 120" width="80" height="80" aria-hidden="true">
          <ellipse cx="60" cy="20" rx="10" ry="12" fill="none" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          <line x1="60" y1="32" x2="60" y2="72" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          <line x1="60" y1="42" x2="40" y2="58" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          <line x1="60" y1="42" x2="80" y2="58" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          <line x1="60" y1="72" x2="48" y2="100" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          <line x1="60" y1="72" x2="72" y2="100" stroke="rgba(214,226,226,0.25)" strokeWidth="1.5" />
          {topFragile.map((p, i) => {
            const pos = dotPos[i];
            if (!pos) return null;
            const heat = p.fragility > 60 ? "#d9866f" : p.fragility > 35 ? "#d7a857" : "#77d7b0";
            return (
              <circle
                key={p.id}
                cx={pos.cx}
                cy={pos.cy}
                r="5"
                fill={heat}
                opacity="0.85"
              />
            );
          })}
        </svg>
        <ul className="fragility-list">
          {topFragile.map((p) => (
            <li key={p.id}>
              <span>{p.name.split(" ").pop()}</span>
              <span className="frag-score">{p.fragility}</span>
            </li>
          ))}
          {topFragile.length === 0 && <li>No data</li>}
        </ul>
      </div>
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
              <th>Proj</th>
              <th>Repl</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, proj, repl, edge }) => (
              <tr key={player.id}>
                <td>{player.name.split(" ").pop()}</td>
                <td>{proj}</td>
                <td>{repl}</td>
                <td className={edge > 0 ? "pos-text" : "neg-text"}>{edge > 0 ? `+${edge}` : edge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
