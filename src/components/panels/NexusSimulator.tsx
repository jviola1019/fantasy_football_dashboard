"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord } from "@/lib/governance";
import type { SimulationResult } from "@/lib/simulation";
import type { ScenarioComparison } from "@/lib/derivedMetrics";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";

type Props = {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  scenarios: ScenarioComparison;
};

const TABS = ["Multiverse", "Scenarios", "Projections", "Sensitivity", "Risk Analysis"] as const;

export function NexusSimulator({ players, sim, scenarios }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Multiverse");
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 900);
  };

  const hasData = players.length > 0;

  return (
    <section className="system-panel panel-nexus" id="nexus-simulator" aria-labelledby="ns-title">
      <div className="panel-header-row">
        <div className="panel-title">
          <div className="panel-icon">⊕</div>
          <div>
            <h2 id="ns-title">Nexus Simulator</h2>
            <p className="panel-eyebrow">Simulate future. Master uncertainty.</p>
          </div>
        </div>
        <div className="panel-header-controls">
          <select className="galaxy-select" defaultValue="Baseline">
            <option>Baseline</option>
            <option>Best Case</option>
            <option>Worst Case</option>
          </select>
          <span className="sim-count">SIMULATIONS {sim.params.iterations.toLocaleString()}</span>
          <button
            className={`run-sim-btn${running ? " running" : ""}`}
            onClick={handleRun}
            disabled={running}
          >
            {running ? "RUNNING…" : "RUN SIMULATION"}
          </button>
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Nexus Simulator tabs">
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

      <div className="nexus-layout">
        {(activeTab === "Multiverse" || activeTab === "Projections") && (
          <>
            <div className="nexus-main">
              <OutcomeMultiverse players={players} sim={sim} running={running} />
            </div>
            <div className="nexus-side">
              <KeyDrivers sim={sim} hasData={hasData} />
              <RiskOfRegret sim={sim} hasData={hasData} />
            </div>
          </>
        )}
        {(activeTab === "Scenarios" || activeTab === "Sensitivity") && (
          <div className="nexus-full">
            <ScenarioComparisonTable scenarios={scenarios} hasData={hasData} />
            <KeyDrivers sim={sim} hasData={hasData} />
          </div>
        )}
        {activeTab === "Risk Analysis" && (
          <div className="nexus-full">
            <RiskOfRegret sim={sim} hasData={hasData} />
            <RiskDetails sim={sim} />
          </div>
        )}
      </div>
    </section>
  );
}

function OutcomeMultiverse({
  players, sim, running,
}: {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  running: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const outcomes = [
    { label: "Championship", pct: sim.championshipProbability, y: 40, color: "#d7a857" },
    { label: "Top 3 Finish", pct: Math.round(sim.championshipProbability * 4.1 * 10) / 10, y: 95, color: "#77d7b0" },
    { label: "Playoffs", pct: sim.playoffProbability, y: 150, color: "#7bb7ce" },
    { label: "Middle Pack", pct: Math.max(0, Math.round((100 - sim.playoffProbability - sim.catastrophicRisk) * 10) / 10), y: 210, color: "#8d9aa0" },
    { label: "Bottom 3", pct: sim.catastrophicRisk, y: 265, color: "#d9866f" },
  ];

  return (
    <div className="multiverse-wrap">
      <div className="section-label">OUTCOME MULTIVERSE — {sim.params.iterations.toLocaleString()} SIMULATIONS</div>
      <div className={reduceMotion ? undefined : "pulse-3d-tilt"}>
      <svg viewBox="0 0 580 310" width="100%" aria-hidden="true">
        <defs>
          <filter id="multiverseGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {outcomes.map((o, i) => (
            <linearGradient key={`grad-${i}`} id={`branchGrad${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={o.color} stopOpacity="0.85" />
              <stop offset="100%" stopColor={o.color} stopOpacity="0.35" />
            </linearGradient>
          ))}
        </defs>

        {/* Vertical guide lines */}
        {[150, 300, 450].map((gx) => (
          <line key={gx} x1={gx} y1={10} x2={gx} y2={300} stroke="rgba(123,183,206,0.05)" strokeWidth="1" />
        ))}

        {/* Source node */}
        <circle cx={60} cy={155} r={16} fill="rgba(9,13,18,0.95)" stroke="rgba(123,183,206,0.55)" strokeWidth="1.5" filter="url(#multiverseGlow)" />
        <circle cx={60} cy={155} r={10} fill="none" stroke="rgba(123,183,206,0.25)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={60} y={159} textAnchor="middle" fontSize="8" fill="var(--blue)" fontWeight="700">NOW</text>

        {/* Branches */}
        {outcomes.map((o, i) => {
          const cpX = 220;
          const d = `M 60 155 C ${cpX} ${155}, ${cpX + 80} ${o.y}, 470 ${o.y}`;
          return (
            <g key={o.label}>
              <motion.path
                d={d}
                fill="none"
                stroke={`url(#branchGrad${i})`}
                strokeWidth="2.5"
                opacity="0.78"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: running ? 0 : 1 }}
                transition={{ duration: 1.2 + i * 0.2, ease: "easeOut" }}
              />
              <circle cx={472} cy={o.y} r={14} fill={o.color} opacity="0.08" />
              <circle cx={472} cy={o.y} r={11} fill="rgba(9,13,18,0.95)" stroke={o.color} strokeWidth="1.8" filter="url(#multiverseGlow)" />
              <text x={490} y={o.y - 4} fontSize="8" fill="var(--muted)" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {o.label}
              </text>
              <text x={490} y={o.y + 8} fontSize="12" fill={o.color} fontWeight="700">
                {o.pct}%
              </text>
            </g>
          );
        })}

        {players.length === 0 && (
          <text x="280" y="150" textAnchor="middle" fontSize="12" fill="rgba(232,225,207,0.3)">
            No player data
          </text>
        )}
      </svg>
      </div>
    </div>
  );
}

function ScenarioComparisonTable({ scenarios, hasData }: { scenarios: ScenarioComparison; hasData: boolean }) {
  const rows = [
    { label: "Championship %", best: `${scenarios.bestCase.championship}%`, base: `${scenarios.baseline.championship}%`, worst: `${scenarios.worstCase.championship}%` },
    { label: "Top 3 Finish %", best: `${scenarios.bestCase.topThree}%`, base: `${scenarios.baseline.topThree}%`, worst: `${scenarios.worstCase.topThree}%` },
    { label: "Playoffs %", best: `${scenarios.bestCase.playoffs}%`, base: `${scenarios.baseline.playoffs}%`, worst: `${scenarios.worstCase.playoffs}%` },
    { label: "Points For", best: scenarios.bestCase.pointsFor, base: scenarios.baseline.pointsFor, worst: scenarios.worstCase.pointsFor },
    { label: "Points Against", best: scenarios.bestCase.pointsAgainst, base: scenarios.baseline.pointsAgainst, worst: scenarios.worstCase.pointsAgainst },
    { label: "Final Rank", best: scenarios.bestCase.finalRank, base: scenarios.baseline.finalRank, worst: scenarios.worstCase.finalRank },
  ];

  return (
    <div className="table-wrap">
      <div className="section-label">SCENARIO COMPARISON</div>
      {!hasData ? (
        <p className="muted-note">No data available.</p>
      ) : (
        <table className="scenario-table">
          <thead>
            <tr>
              <th></th>
              <th className="pos-text">Best Case</th>
              <th>Baseline</th>
              <th className="neg-text">Worst Case</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="pos-text">{row.best}</td>
                <td>{row.base}</td>
                <td className="neg-text">{row.worst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function KeyDrivers({ sim, hasData }: { sim: SimulationResult; hasData: boolean }) {
  if (!hasData || sim.keyDrivers.length === 0) {
    return <div className="mini-panel"><div className="mini-panel-title">Key Drivers</div><p className="muted-note">No data.</p></div>;
  }
  const maxContrib = Math.max(...sim.keyDrivers.map((d) => d.contribution), 1);
  const items = sim.keyDrivers.map((d) => ({
    label: d.name.split(" ").pop() ?? d.name,
    value: Math.round((d.contribution / maxContrib) * 100),
    color: "#77d7b0",
  }));
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Key Drivers</div>
      <BarChart items={items} max={100} />
    </div>
  );
}

function RiskOfRegret({ sim, hasData }: { sim: SimulationResult; hasData: boolean }) {
  if (!hasData) {
    return <div className="mini-panel"><div className="mini-panel-title">Risk of Regret</div><p className="muted-note">No data.</p></div>;
  }
  const regret = sim.regretIndex;
  const level = regret > 60 ? "High" : regret > 30 ? "Moderate" : "Low";
  const color = regret > 60 ? "#d9866f" : regret > 30 ? "#d7a857" : "#77d7b0";
  const segments = [
    { label: level, value: regret, color },
    { label: "OK", value: 100 - regret, color: "rgba(255,255,255,0.06)" },
  ];
  return (
    <div className="mini-panel risk-panel">
      <div className="mini-panel-title">Risk of Regret</div>
      <div className="risk-layout">
        <DonutChart segments={segments} centerValue={`${regret}%`} centerLabel={level} />
        <ul className="risk-list">
          {sim.assumptions.slice(0, 3).map((a, i) => (
            <li key={i}>{a.slice(0, 60)}{a.length > 60 ? "…" : ""}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RiskDetails({ sim }: { sim: SimulationResult }) {
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Risk Detail — Assumptions</div>
      <ul className="risk-detail-list">
        {sim.assumptions.map((a, i) => <li key={i}>{a}</li>)}
      </ul>
      <p className="small-note">Seed: {sim.seed} · Iterations: {sim.params.iterations.toLocaleString()}</p>
    </div>
  );
}
