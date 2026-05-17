"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import type { SimulationResult } from "@/lib/simulation";
import type { CommandMetrics, PositionGrades } from "@/lib/derivedMetrics";
import { reputationEdge, narrativeVelocity } from "@/lib/models";
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
    <section className="system-panel panel-command" id="command-center" aria-labelledby="cc-title">
      <PanelHeader
        title="Command Center"
        eyebrow="Real-time intelligence. Smarter decisions."
        mode={envelope.mode}
        timeRanges={TIME_RANGES as unknown as string[]}
        activeRange={timeRange}
        onRange={setTimeRange}
      />

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
    </section>
  );
}

function PanelHeader({
  title, eyebrow, mode, timeRanges, activeRange, onRange,
}: {
  title: string; eyebrow: string; mode: string;
  timeRanges: string[]; activeRange: string; onRange: (r: string) => void;
}) {
  return (
    <div className="panel-header-row">
      <div className="panel-title">
        <div className="panel-icon">⚡</div>
        <div>
          <h2 id="cc-title">{title}</h2>
          <p className="panel-eyebrow">{eyebrow}</p>
        </div>
      </div>
      <div className="panel-header-controls">
        <div className="time-range-tabs" role="group" aria-label="Time range">
          {timeRanges.map((r) => (
            <button
              key={r}
              className={`time-tab${activeRange === r ? " active" : ""}`}
              onClick={() => onRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        {mode === "live" && <span className="live-badge">● LIVE</span>}
        {mode === "fixture" && <span className="fixture-badge">FIXTURE</span>}
      </div>
    </div>
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
  const reduceMotion = useReducedMotion();
  const cx = 310;
  const cy = 155;

  // Subset to top 16 by trueValue — typical fantasy league size; keeps the graph readable.
  const top = [...players].sort((a, b) => b.trueValue - a.trueValue).slice(0, 16);

  const nodePositions = top.map((p, i) => {
    const angle = (i / Math.max(top.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 95 + p.trueValue * 0.55;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) * 0.68, player: p };
  });

  const edges: Array<[number, number]> = [];
  for (let a = 0; a < nodePositions.length; a++) {
    for (let b = a + 1; b < nodePositions.length; b++) {
      if (Math.abs(nodePositions[a].player.trueValue - nodePositions[b].player.trueValue) < 14) {
        edges.push([a, b]);
      }
    }
  }
  const edgeSubset = edges.slice(0, 40);

  return (
    <div className="league-pulse" aria-label="League pulse network topology">
      <div className="league-pulse-label">LEAGUE PULSE · NETWORK TOPOLOGY · TOP {top.length}</div>
      <div className={reduceMotion ? undefined : "pulse-3d-tilt"}>
        <svg viewBox="0 0 620 310" width="100%" aria-hidden="true">
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(123,183,206,0.28)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <radialGradient id="nodeHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(119,215,176,0.4)" />
              <stop offset="100%" stopColor="rgba(119,215,176,0)" />
            </radialGradient>
            <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="centerGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="edgeGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(119,215,176,0.08)" />
              <stop offset="50%" stopColor="rgba(119,215,176,0.32)" />
              <stop offset="100%" stopColor="rgba(119,215,176,0.08)" />
            </linearGradient>
          </defs>

          {/* atmospheric core glow */}
          <ellipse cx={cx} cy={cy} rx={290} ry={150} fill="url(#coreGlow)" />

          {/* four concentric orbital rings */}
          {[
            { rx: 55, op: 0.18, dash: undefined },
            { rx: 110, op: 0.12, dash: "4 8" },
            { rx: 165, op: 0.09, dash: undefined },
            { rx: 220, op: 0.06, dash: "2 10" },
          ].map(({ rx, op, dash }) => (
            <ellipse key={rx} cx={cx} cy={cy} rx={rx} ry={rx * 0.66}
              fill="none"
              stroke={`rgba(123,183,206,${op})`}
              strokeWidth="1"
              strokeDasharray={dash}
            />
          ))}

          {/* twelve radial spokes */}
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i / 12) * Math.PI * 2;
            return (
              <line
                key={`spoke-${i}`}
                x1={cx} y1={cy}
                x2={cx + 220 * Math.cos(angle)}
                y2={cy + 145 * Math.sin(angle)}
                stroke="rgba(123,183,206,0.05)"
                strokeWidth="1"
              />
            );
          })}

          {/* edges */}
          {edgeSubset.map(([a, b], i) => (
            <line
              key={`edge-${i}`}
              x1={nodePositions[a].x} y1={nodePositions[a].y}
              x2={nodePositions[b].x} y2={nodePositions[b].y}
              stroke="url(#edgeGrad1)"
              strokeWidth="0.9"
              opacity="0.7"
            />
          ))}

          {top.length === 0 && (
            <text x={cx} y={cy} textAnchor="middle" fill="rgba(232,225,207,0.3)" fontSize="13">No data</text>
          )}

          {/* nodes */}
          {nodePositions.map(({ x, y, player }, i) => {
            const edge = reputationEdge(player);
            const r = 7 + player.opportunity / 12;
            const color = edge >= 0 ? "#77d7b0" : "#d9866f";
            return (
              <motion.g
                key={player.id}
                animate={reduceMotion ? {} : { y: [0, -2 - player.volatility / 24, 0] }}
                transition={{ duration: 4 + i * 0.35, repeat: Infinity, ease: "easeInOut" }}
              >
                <circle cx={x} cy={y} r={r + 8} fill={color} opacity="0.05" />
                <circle cx={x} cy={y} r={r + 3} fill={color} opacity="0.10" />
                <circle
                  cx={x} cy={y} r={r}
                  fill="rgba(5,8,14,0.92)"
                  stroke={color} strokeWidth="1.6"
                  filter="url(#nodeGlow)"
                  className="pulse-node"
                />
                <text x={x} y={y - r - 5} textAnchor="middle" fontSize="8.5" fill="rgba(232,225,207,0.92)">
                  {player.name.split(" ").pop()}
                </text>
                <text x={x} y={y - r - 14} textAnchor="middle" fontSize="7.5" fill="rgba(141,154,160,0.8)">
                  {player.position}·{player.team}
                </text>
              </motion.g>
            );
          })}

          {/* center hub */}
          <circle cx={cx} cy={cy} r={44} fill="rgba(7,11,18,0.95)" stroke="rgba(123,183,206,0.45)" strokeWidth="1.5" filter="url(#centerGlow)" />
          <circle cx={cx} cy={cy} r={38} fill="none" stroke="rgba(123,183,206,0.18)" strokeWidth="1" strokeDasharray="6 4" />
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize="28" fill="var(--cream)" fontWeight="900" style={{ letterSpacing: "-0.04em" }}>
            {marketEdge}
          </text>
          <text x={cx} y={cy + 6} textAnchor="middle" fontSize="7.5" fill="rgba(123,183,206,0.7)" style={{ textTransform: "uppercase", letterSpacing: "0.15em" }}>
            MARKET EDGE
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="8.5" fill="var(--green)">
            {timeRange} · {players.length}P
          </text>

          {/* animated pulse rings from center */}
          {!reduceMotion && (
            <>
              <motion.circle
                cx={cx} cy={cy}
                fill="none" stroke="rgba(123,183,206,0.45)" strokeWidth="1.5"
                animate={{ r: [44, 80, 44], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.circle
                cx={cx} cy={cy}
                fill="none" stroke="rgba(119,215,176,0.32)" strokeWidth="1"
                animate={{ r: [44, 72, 44], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 3.5, delay: 1.2, repeat: Infinity, ease: "easeOut" }}
              />
            </>
          )}
        </svg>
      </div>
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
  const mid = sim.playoffProbability;
  const p10 = Math.round(mid * 0.68 * 10) / 10;
  const p90 = Math.round(mid * 1.32 * 10) / 10;
  const tCx = 60;
  const tTop = 10;
  const tBot = 95;
  const halfW = 50;
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Lineup Win Probability</div>
      <div className="triangle-wrap">
        <svg viewBox="0 0 120 110" width="100%" aria-hidden="true">
          <polygon
            points={`${tCx},${tTop} ${tCx - halfW},${tBot} ${tCx + halfW},${tBot}`}
            fill="rgba(119,215,176,0.08)"
            stroke="rgba(119,215,176,0.5)"
            strokeWidth="1.5"
          />
          <text x={tCx} y={tTop - 2} textAnchor="middle" fontSize="9" fill="var(--muted)">P90</text>
          <text x={tCx} y={tTop + 10} textAnchor="middle" fontSize="10" fill="var(--green)">{p90}%</text>
          <text x={tCx} y={(tTop + tBot) / 2 + 4} textAnchor="middle" fontSize="16" fill="var(--cream)" fontWeight="700">{mid}%</text>
          <text x={tCx - halfW - 2} y={tBot + 10} textAnchor="middle" fontSize="9" fill="var(--muted)">P10</text>
          <text x={tCx - halfW - 2} y={tBot + 20} textAnchor="middle" fontSize="10" fill="var(--red)">{p10}%</text>
          <text x={tCx + halfW + 2} y={tBot + 10} textAnchor="middle" fontSize="9" fill="var(--muted)">P90</text>
          <text x={tCx + halfW + 2} y={tBot + 20} textAnchor="middle" fontSize="10" fill="var(--green)">{p90}%</text>
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
