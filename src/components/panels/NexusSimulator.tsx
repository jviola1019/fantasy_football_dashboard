"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { runNexusSimulation, type SimulationResult } from "@/lib/simulation";
import { deriveOutcomeDistribution, type ScenarioComparison } from "@/lib/derivedMetrics";
import { bootstrapCI } from "@/lib/stats/distribution";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { Heatmap2D, DEFAULT_COLOR } from "@/components/charts/Heatmap2D";
import { buildOutcomeHeat } from "@/lib/outcomeHeat";
import { surname } from "@/lib/utils";
import { ReliabilityDiagram } from "@/components/charts/ReliabilityDiagram";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";

type Props = {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  scenarios: ScenarioComparison;
  envelope?: RAEEnvelope;
};

const TABS = ["Multiverse", "Scenarios", "Risk Analysis"] as const;

// CI multipliers per panel-data-state. The simulation itself always runs;
// what changes is how loud we are about the uncertainty bands. degraded
// widens the CI 1.5x and labels "Wide CI: data partial"; unavailable
// widens 2.5x and labels "Speculative". Numbers chosen so the label
// boundary stays interpretable rather than triggering on every tiny gap.
const CI_MULTIPLIER: Record<"ready" | "degraded" | "unavailable", number> = {
  ready: 1,
  degraded: 1.5,
  unavailable: 2.5
};

const CI_LABEL: Record<"ready" | "degraded" | "unavailable", string> = {
  ready: "",
  degraded: "Wide CI: data partial",
  unavailable: "Speculative — trending-momentum + opportunity unavailable"
};

export function NexusSimulator({ players, sim, scenarios, envelope }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Multiverse");
  const [running, setRunning] = useState(false);
  // Honor OS "reduce motion": the JS-driven Motion path-draw + replay can't be
  // stopped by the global CSS media query, so gate them here.
  const reduceMotion = useReducedMotion();

  // Build the weekly projections Map from the envelope (plain Record → Map).
  const weeklyProjections = useMemo(() => {
    const proj = envelope?.weeklyProjections;
    if (!proj || Object.keys(proj).length === 0) return null;
    return new Map(Object.entries(proj));
  }, [envelope?.weeklyProjections]);

  // The simulator depends on trending_momentum (chaosExposure) and
  // opportunity to interpret risk + driver weights. When both are missing,
  // the CI bands shown to the user need to widen so the displayed
  // probabilities aren't read as precise. The actual numbers from
  // runNexusSimulation stay the same — we only modify the displayed CI
  // width + add a banner.
  const panelState = envelope
    ? derivePanelState(envelope, ["trending_momentum", "opportunity"])
    : // No envelope ⇒ no provenance; widen the CI and label speculative (UX-05).
      {
        status: "unavailable" as const,
        bannerText: "No data envelope — simulation inputs unverified.",
        unavailable: new Set<string>(["trending_momentum", "opportunity"])
      };
  const ciMultiplier = CI_MULTIPLIER[panelState.status];

  // When weekly projections are wired, override the CI label to show the
  // week/date stamp. The label is empty when projections are absent and the
  // panel state is "ready" (no missing fields to disclose).
  const projMeta = envelope?.weeklyProjectionsMeta;
  const ciLabel = weeklyProjections && projMeta
    ? `Live week-${projMeta.week} projections (${new Date(projMeta.fetchedAt).toLocaleDateString()})`
    : CI_LABEL[panelState.status];

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 900);
  };

  const hasData = players.length > 0;

  return (
    <PanelCard
      id="nexus-simulator"
      titleId="ns-title"
      title="Nexus Simulator"
      eyebrow="Simulate future. Master uncertainty."
      source={envelope?.sourceState}
      controls={
        <>
          <span className="sim-count">SIMULATIONS {sim.params.iterations.toLocaleString()}</span>
          {!reduceMotion && (
            <button
              type="button"
              className={`run-sim-btn${running ? " running" : ""}`}
              onClick={handleRun}
              disabled={running}
              aria-label="Replay the outcome animation"
            >
              {running ? "REPLAYING…" : "REPLAY"}
            </button>
          )}
        </>
      }
    >
      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Nexus Simulator tabs"
      />

      {ciLabel ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: "rgba(245,231,196,0.04)",
            border: "1px solid rgba(245,231,196,0.12)",
            color: "var(--cream)",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            margin: "8px 0",
            letterSpacing: 0.2
          }}
        >
          {ciLabel} — CI bands widened {ciMultiplier.toFixed(1)}× from the seeded simulation.
        </div>
      ) : null}

      <div className="nexus-layout">
        {activeTab === "Multiverse" && (
          <>
            <div className="nexus-main">
              <OutcomeMultiverse players={players} sim={sim} running={running} />
            </div>
            <div className="nexus-side">
              <ConfidenceBands players={players} sim={sim} ciMultiplier={ciMultiplier} weeklyProjections={weeklyProjections} />
              <KeyDrivers sim={sim} hasData={hasData} />
              <RiskOfRegret sim={sim} hasData={hasData} />
            </div>
          </>
        )}
        {activeTab === "Scenarios" && (
          <div className="nexus-full">
            <ScenarioComparisonTable scenarios={scenarios} hasData={hasData} />
            <KeyDrivers sim={sim} hasData={hasData} />
          </div>
        )}
        {activeTab === "Risk Analysis" && (
          <div className="nexus-full">
            <RiskOfRegret sim={sim} hasData={hasData} />
            <div className="mini-panel">
              <div className="mini-panel-title">Calibration — Reliability Diagram</div>
              <ReliabilityDiagram
                caption="Run scripts/brier-backtest.ts to populate with real 2025 backtest data."
              />
            </div>
            <RiskDetails sim={sim} />
          </div>
        )}
      </div>
    </PanelCard>
  );
}

function OutcomeMultiverse({
  players, sim, running,
}: {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  running: boolean;
}) {
  // JS-driven Motion path-draw can't be stopped by the global reduced-motion CSS.
  const reduceMotion = useReducedMotion();
  // Five mutually exclusive final-standing buckets that always sum to 100 and
  // are each ≥ 0 — no impossible >100% or negative percentages.
  const dist = deriveOutcomeDistribution(sim);
  const outcomes = [
    { label: "Championship", pct: dist.championship, y: 50, color: "#d7a857" },
    { label: "Top 3 Finish", pct: dist.topThree, y: 100, color: "#77d7b0" },
    { label: "Wild Card", pct: dist.playoffs, y: 150, color: "#7bb7ce" },
    { label: "Middle Pack", pct: dist.middlePack, y: 200, color: "#8d9aa0" },
    { label: "Bottom 3", pct: dist.bottomThree, y: 250, color: "#d9866f" },
  ];

  // Honest, useful heatmap: P(playoff outcome | regular-season wins) from the
  // season Monte Carlo — each column (a win total) sums to 100%, so the Champion
  // share rises left→right with wins. Conditioning on wins (vs. the raw joint)
  // avoids the trap where a rare 14-0 column looks dim and misreads as "winning
  // more lowers your title odds". Replaces the old dead-flat risk sweep.
  const heat = useMemo(() => buildOutcomeHeat(sim.distribution), [sim.distribution]);

  return (
    <div className="multiverse-wrap">
      <div className="section-label">OUTCOME MULTIVERSE</div>
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
      <svg viewBox="0 0 560 300" width="100%" aria-hidden="true">
        <defs>
          <filter id="multiverseGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="50" cy="150" r="12" fill="rgba(9,13,18,0.9)" stroke="rgba(123,183,206,0.6)" strokeWidth="1.5" />
        <text x="50" y="154" textAnchor="middle" fontSize="8" fill="var(--blue)">NOW</text>
        {outcomes.map((o, i) => {
          const cpX = 220;
          const d = `M 50 150 C ${cpX} ${150}, ${cpX + 80} ${o.y}, 460 ${o.y}`;
          return (
            <g key={o.label}>
              <motion.path
                d={d}
                fill="none"
                stroke={o.color}
                strokeWidth="1.5"
                opacity="0.65"
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: reduceMotion ? 1 : running ? 0 : 1 }}
                transition={{ duration: reduceMotion ? 0 : 1.2 + i * 0.2, ease: "easeOut" }}
              />
              <circle cx="460" cy={o.y} r="8" fill="rgba(9,13,18,0.9)" stroke={o.color} strokeWidth="1.5" filter="url(#multiverseGlow)" />
              <text x="470" y={o.y + 4} fontSize="9" fill={o.color}>{o.pct}%</text>
              <text x="470" y={o.y - 6} fontSize="8" fill="var(--muted)">{o.label}</text>
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
  );
}

/**
 * Widen a CI's bounds symmetrically around its point estimate by the given
 * multiplier. Bounded to [0, 100] so we never display impossible probabilities.
 * Used by ConfidenceBands when the envelope's data state is degraded/unavailable —
 * the underlying simulation is unchanged; we just communicate honest uncertainty.
 */
function widen(
  ci: { estimate: number; lower: number; upper: number; width: number; level: number },
  multiplier: number
) {
  if (multiplier === 1) return ci;
  const halfWidthLow = ci.estimate - ci.lower;
  const halfWidthHigh = ci.upper - ci.estimate;
  const lower = Math.max(0, ci.estimate - halfWidthLow * multiplier);
  const upper = Math.min(100, ci.estimate + halfWidthHigh * multiplier);
  return { ...ci, lower, upper, width: upper - lower };
}

function ConfidenceBands({
  players,
  sim,
  ciMultiplier = 1,
  weeklyProjections
}: {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  ciMultiplier?: number;
  weeklyProjections?: Map<string, number> | null;
}) {
  const REPLICATES = 20;
  const ITER = 800;
  const bands = useMemo(() => {
    if (players.length === 0) return null;
    const champ: number[] = [];
    const playoff: number[] = [];
    for (let i = 0; i < REPLICATES; i++) {
      const r = runNexusSimulation(players, {
        seed: sim.params.seed + i,
        iterations: ITER,
        rosterSlots: sim.params.rosterSlots,
        riskTolerance: sim.params.riskTolerance,
        weeklyProjections
      });
      champ.push(r.championshipProbability);
      playoff.push(r.playoffProbability);
    }
    const champCI = bootstrapCI(champ, 0.95, 500, 1019);
    const playoffCI = bootstrapCI(playoff, 0.95, 500, 1019);
    return {
      championship: widen(champCI, ciMultiplier),
      playoff: widen(playoffCI, ciMultiplier)
    };
  }, [players, sim.params.seed, sim.params.rosterSlots, sim.params.riskTolerance, ciMultiplier, weeklyProjections]);

  if (!bands) {
    return (
      <div className="mini-panel">
        <div className="mini-panel-title">Confidence Bands</div>
        <p className="muted-note">No data — confidence intervals unavailable.</p>
      </div>
    );
  }

  return (
    <div className="mini-panel">
      <div className="mini-panel-title">95% Confidence Bands</div>
      <ul className="ci-list">
        <li className="ci-row">
          <span>Championship</span>
          <b>
            {sim.championshipProbability.toFixed(1)}%
            <small className="ci-range">
              {" "}[{bands.championship.lower.toFixed(1)} – {bands.championship.upper.toFixed(1)}]
            </small>
          </b>
        </li>
        <li className="ci-row">
          <span>Playoffs</span>
          <b>
            {sim.playoffProbability.toFixed(1)}%
            <small className="ci-range">
              {" "}[{bands.playoff.lower.toFixed(1)} – {bands.playoff.upper.toFixed(1)}]
            </small>
          </b>
        </li>
      </ul>
      <p className="small-note">{REPLICATES} replicates × {ITER.toLocaleString()} iterations · bootstrap N=500.</p>
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
    <div className="table-wrap" tabIndex={0}>
      <div className="section-label">SCENARIO COMPARISON</div>
      {!hasData ? (
        <p className="muted-note">No data available.</p>
      ) : (
        <table className="scenario-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Metric</span>
              </th>
              <th scope="col" className="pos-text">Best Case</th>
              <th scope="col">Baseline</th>
              <th scope="col" className="neg-text">Worst Case</th>
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
  // Each driver's contribution is its projected weekly points — show the REAL
  // pts/week (not an abstract 0-100), so the bars read as "what each starter
  // actually adds per week."
  const items = sim.keyDrivers.map((d) => ({
    label: surname(d.name),
    value: Math.round(d.contribution * 10) / 10,
    color: "#77d7b0",
  }));
  const maxV = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Key Drivers — proj pts/week</div>
      <BarChart items={items} max={maxV} valueSuffix="" />
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
