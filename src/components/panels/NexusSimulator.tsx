"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { derivePanelState } from "@/lib/panelState";
import { type SimulationResult } from "@/lib/simulation";
import { type ReplicationRange } from "@/lib/envelope/derive";
import { deriveOutcomeDistribution, type ScenarioComparison } from "@/lib/derivedMetrics";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { Heatmap2D, DEFAULT_COLOR } from "@/components/charts/Heatmap2D";
import { buildOutcomeHeat } from "@/lib/outcomeHeat";
import { surname } from "@/lib/utils";
import { ReliabilityDiagram } from "@/components/charts/ReliabilityDiagram";
import { ModelScenarioNotice } from "@/components/model/ModelScenarioNotice";
import { ScenarioOutlook } from "@/components/model/ScenarioOutlook";
import { structuralBaseline } from "@/lib/models/scenarioBand";
import { PanelCard } from "../ui/PanelCard";
import { THEME, OUTCOME_COLORS } from "@/lib/theme";
import { PanelTabs, TabPanel } from "../ui/PanelTabs";

type Props = {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
  scenarios: ScenarioComparison;
  /** Server-computed Monte-Carlo replication range (null when no roster). */
  replicationRange?: ReplicationRange | null;
  envelope?: RAEEnvelope;
};

const TABS = ["Multiverse", "Scenarios", "Risk Analysis"] as const;

// Data-state notice per panel-data-state.
//
// This used to also carry CI MULTIPLIERS — 1.5x for degraded, 2.5x for
// unavailable — that stretched the displayed interval when inputs were missing.
// Removed 2026-08-22 (audit P0-4). The interval is a Monte-Carlo REPLICATION
// range: it measures how much the number moves across random seeds with every
// input held fixed. Multiplying it does not turn it into a measure of input
// uncertainty; it just prints a wider number with no measurement behind it, and
// 1.5 and 2.5 were chosen for legibility rather than derived from anything.
// Missing inputs are now stated in words, which is what we can actually support.
const DATA_STATE_NOTICE: Record<"ready" | "degraded" | "unavailable", string> = {
  ready: "",
  degraded: "Some inputs are missing — read the frequencies below as partial.",
  unavailable: "Trending-momentum and opportunity are unavailable; these frequencies rest on the roster alone."
};

export function NexusSimulator({ players, sim, scenarios, replicationRange, envelope }: Props) {
  const [activeTab, setActiveTab] = useState<string>("Multiverse");

  // Build the weekly projections Map from the envelope (plain Record → Map).
  const weeklyProjections = useMemo(() => {
    const proj = envelope?.weeklyProjections;
    if (!proj || Object.keys(proj).length === 0) return null;
    return new Map(Object.entries(proj));
  }, [envelope?.weeklyProjections]);

  // The simulator depends on trending_momentum (chaosExposure) and opportunity
  // to interpret risk + driver weights. When they are missing the numbers from
  // runNexusSimulation are unchanged — what changes is what we say about them.
  const panelState = envelope
    ? derivePanelState(envelope, ["trending_momentum", "opportunity"])
    : // No envelope ⇒ no provenance to stand on (UX-05).
      {
        status: "unavailable" as const,
        bannerText: "No data envelope — simulation inputs unverified.",
        unavailable: new Set<string>(["trending_momentum", "opportunity"])
      };

  // When weekly projections are wired, the notice reports their week/date stamp
  // instead. Empty when projections are absent and the panel state is "ready".
  const projMeta = envelope?.weeklyProjectionsMeta;
  const dataStateNotice = weeklyProjections && projMeta
    ? `Live week-${projMeta.week} projections (${new Date(projMeta.fetchedAt).toLocaleDateString()})`
    : DATA_STATE_NOTICE[panelState.status];

  const hasData = players.length > 0;

  return (
    <PanelCard
      id="nexus-simulator"
      titleId="ns-title"
      title="Nexus Simulator"
      eyebrow="Simulate future. Master uncertainty."
      controls={
        <span className="sim-count">{sim.params.iterations.toLocaleString()} simulations</span>
      }
    >
      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Nexus Simulator tabs"
        idBase="nexus-sim"
      />

      {dataStateNotice ? (
        // No role="status"/aria-live. This is standing context about the data
        // behind the panel, recomputed on every request — as a live region it
        // interrupted a screen reader on each navigation to re-read a sentence
        // that had not meaningfully changed. Audit 2026-08-22, same class of
        // defect as the governance banner and the mode pill.
        <p
          style={{
            background: "rgba(245,231,196,0.04)",
            border: "1px solid rgba(245,231,196,0.12)",
            color: "var(--cream)",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: "var(--text-sm)",
            margin: "8px 0",
            letterSpacing: "0.02em"
          }}
        >
          {dataStateNotice}
        </p>
      ) : null}

      <TabPanel idBase="nexus-sim" active={activeTab}>
        <div className="nexus-layout">
          {activeTab === "Multiverse" && (
            <>
              <div className="nexus-main">
                <OutcomeMultiverse players={players} sim={sim} />
              </div>
              <div className="nexus-side">
                <ScenarioBands sim={sim} range={replicationRange ?? null} />
                <KeyDrivers sim={sim} hasData={hasData} />
                <RiskOfRegret sim={sim} hasData={hasData} />
              </div>
            </>
          )}
          {activeTab === "Scenarios" && (
            <div className="nexus-full">
              {/* Same model, same failure - the notice travels with the numbers. */}
              <ModelScenarioNotice variant="banner" />
              <ScenarioComparisonTable scenarios={scenarios} hasData={hasData} />
              <KeyDrivers sim={sim} hasData={hasData} />
            </div>
          )}
          {activeTab === "Risk Analysis" && (
            <div className="nexus-full">
              <ModelScenarioNotice variant="banner" />
              <p className="section-intro">
                How much to trust this scenario: the regret index quantifies downside exposure, the
                reliability diagram shows whether simulated frequencies match real outcomes, and the
                assumptions list states what the simulation took as given.
              </p>
              <RiskOfRegret sim={sim} hasData={hasData} />
              <div className="mini-panel">
                <div className="mini-panel-title">Calibration — Reliability Diagram</div>
                <ReliabilityDiagram
                  caption="Calibration is measured offline against real 2025 outcomes (model-governance report). This panel draws the live curve only once a backtest feed is wired in — it never fabricates one."
                />
              </div>
              <RiskDetails sim={sim} />
            </div>
          )}
        </div>
      </TabPanel>
    </PanelCard>
  );
}

function OutcomeMultiverse({
  players, sim,
}: {
  players: PlayerMarketRecord[];
  sim: SimulationResult;
}) {
  // One-time entrance draw on mount only (no replay control — the chart's value
  // is the outcome fan, not the animation). JS-driven Motion path-draw can't be
  // stopped by the global reduced-motion CSS, so gate it here.
  const reduceMotion = useReducedMotion();
  // Five mutually exclusive final-standing buckets that always sum to 100 and
  // are each ≥ 0 — no impossible >100% or negative percentages.
  const dist = deriveOutcomeDistribution(sim);
  const outcomes = [
    // Colours come from OUTCOME_COLORS, not from hex literals. These are SVG
    // presentation attributes (`stroke=`, `fill=`), which cannot resolve
    // var(), which is exactly why a PRE-REPAINT palette survived here long
    // after the tokens moved. Design audit 2026-08-22, D-5.
    { label: "Championship", pct: dist.championship, y: 50, color: OUTCOME_COLORS.championship },
    { label: "Top 3 Finish", pct: dist.topThree, y: 100, color: OUTCOME_COLORS.topThree },
    { label: "Wild Card", pct: dist.playoffs, y: 150, color: OUTCOME_COLORS.playoffs },
    { label: "Middle Pack", pct: dist.middlePack, y: 200, color: OUTCOME_COLORS.middlePack },
    { label: "Bottom 3", pct: dist.bottomThree, y: 250, color: OUTCOME_COLORS.bottomThree },
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
          rowAxisLabel="Outcome"
          colAxisLabel="Wins"
        />
      ) : (
        <p className="muted-note">No simulated seasons to chart yet.</p>
      )}
      {/* aria-hidden, and deliberately. The HTML legend below lists every
          outcome and its probability as real text, so an aria-label here would
          make a screen reader read the same figures twice — once as a flat
          sentence and once as a list. The graphic is the redundant encoding. */}
      <svg viewBox="0 0 560 300" width="100%" aria-hidden="true">
        <defs>
          <filter id="multiverseGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="50" cy="150" r="12" fill="rgba(9,13,18,0.9)" stroke="rgba(123,183,206,0.6)" strokeWidth="1.5" />
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
                animate={{ pathLength: 1 }}
                transition={{ duration: reduceMotion ? 0 : 1.2 + i * 0.2, ease: "easeOut" }}
              />
              <circle cx="460" cy={o.y} r="8" fill="rgba(9,13,18,0.9)" stroke={o.color} strokeWidth="1.5" filter="url(#multiverseGlow)" />
            </g>
          );
        })}
      </svg>
      {/* Both of these were SVG <text> until S5, and both were sub-floor: "NOW"
          at 14 user units and "No player data" at 18, in a 560-unit viewBox laid
          out around 280px. The UI audit measured "NOW" reaching the screen at
          7.1px. The audit of 2026-08-23 had already moved the OUTCOME labels out
          of this same SVG for the same reason and left these two behind, which
          is how a fix that is correct in principle leaves a remainder nobody
          looks for again.
          "NOW" is not merely re-sized: three letters inside a node explained the
          chart only to someone who already understood it, so it is replaced by a
          sentence that says what the fan actually shows. */}
      {players.length === 0 ? (
        <p className="muted-note">No player data, so no outcome paths are drawn.</p>
      ) : (
        <p className="small-note multiverse-hint">
          Each path leaves today, at the left, and ends at one end-of-season outcome on the right.
          Path height carries no meaning; the probabilities are listed below.
        </p>
      )}
      {/* The outcome labels are HTML, not SVG <text>.
          Audit 2026-08-23. They used to live inside the chart at 8 and 9 USER
          UNITS, and this SVG is a 560-wide viewBox rendered around 371px — a
          0.66 scale, so those labels reached the screen at roughly 5 and 6 CSS
          pixels. Below the declared 9px floor, below anything the type scale
          governs, and invisible to every gate: CSS tooling does not measure
          scaled SVG user units.
          Bumping them in place was not an option — the fan leaves ~90 user
          units to the right of the nodes, and text large enough to survive the
          scale would not fit. So the chart keeps the geometry and the labels
          move out to where the type scale applies and they can reflow. */}
      {players.length > 0 && (
        <ul className="multiverse-legend">
          {outcomes.map((o) => (
            <li key={o.label} className="multiverse-legend-row">
              <span className="multiverse-legend-dot" style={{ background: o.color }} aria-hidden="true" />
              <span className="multiverse-legend-label">{o.label}</span>
              <span className="multiverse-legend-pct">{o.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Strategy B replacement for the former "95% Confidence Bands" tile
 * (audit 2026-08-20 SS3).
 *
 * What was here: `Championship 12.4% [8.1 - 17.0]` under a heading that said
 * "95% Confidence Bands", on the DEFAULT tab, with the model-failure notice
 * three components away inside a different tab. That presentation asserted a
 * calibrated forecast the backtest had already refuted.
 *
 * What is here now: the league's structural baseline as the prominent number,
 * the model's output as a band relative to it, the failure notice immediately
 * above, and the raw frequencies one keyboard-reachable disclosure away.
 *
 * The interval passed through is a Monte-Carlo REPLICATION range, not a
 * confidence interval, and `deriveReplicationRange` explains at length why the
 * distinction matters. The `widen()` helper that used to stretch it by 1.5x or
 * 2.5x when inputs were missing is gone (audit 2026-08-22, P0-4): widening a
 * replication range does not make it measure input uncertainty, and the two
 * multipliers were never derived from a measurement.
 */
function ScenarioBands({
  sim,
  range
}: {
  sim: SimulationResult;
  /** Server-computed replication range (deriveReplicationRange). */
  range: ReplicationRange | null;
}) {
  const baseline = structuralBaseline(sim.params.numTeams ?? 12, sim.params.playoffTeams ?? 6);

  if (!range) {
    return (
      <div className="mini-panel">
        <div className="mini-panel-title">Scenario Outlook</div>
        <p className="muted-note">No roster to simulate - connect a league.</p>
      </div>
    );
  }

  return (
    <div className="mini-panel">
      <div className="mini-panel-title" id="scenario-outlook-title">
        Scenario Outlook
      </div>
      {/* Adjacent, not behind a tab. This is the SS3/SS20 requirement. */}
      <ModelScenarioNotice variant="banner" />
      <ScenarioOutlook
        headingId="scenario-outlook-title"
        numTeams={baseline.numTeams}
        playoffTeams={baseline.playoffTeams}
        iterations={sim.params.iterations}
        seed={sim.seed}
        rows={[
          {
            label: "Playoffs",
            scenarioPct: sim.playoffProbability,
            baselinePct: baseline.playoffs,
            interval: range.playoff
          },
          {
            label: "Championship",
            scenarioPct: sim.championshipProbability,
            baselinePct: baseline.championship,
            interval: range.championship
          }
        ]}
      />
    </div>
  );
}

function ScenarioComparisonTable({ scenarios, hasData }: { scenarios: ScenarioComparison; hasData: boolean }) {
  // Labels name the quantity: these are scenario frequencies, and the notice
  // above the table states the model has no demonstrated skill (audit SS3).
  const rows = [
    { label: "Championship (scenario %)", best: `${scenarios.bestCase.championship}%`, base: `${scenarios.baseline.championship}%`, worst: `${scenarios.worstCase.championship}%` },
    { label: "Top 3 Finish (scenario %)", best: `${scenarios.bestCase.topThree}%`, base: `${scenarios.baseline.topThree}%`, worst: `${scenarios.worstCase.topThree}%` },
    { label: "Playoffs (scenario %)", best: `${scenarios.bestCase.playoffs}%`, base: `${scenarios.baseline.playoffs}%`, worst: `${scenarios.worstCase.playoffs}%` },
    { label: "Points For", best: scenarios.bestCase.pointsFor, base: scenarios.baseline.pointsFor, worst: scenarios.worstCase.pointsFor },
    { label: "Points Against", best: scenarios.bestCase.pointsAgainst, base: scenarios.baseline.pointsAgainst, worst: scenarios.worstCase.pointsAgainst },
    { label: "Final Rank", best: scenarios.bestCase.finalRank, base: scenarios.baseline.finalRank, worst: scenarios.worstCase.finalRank },
  ];

  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Scenario comparison table">
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
      {hasData ? (
        <p className="small-note">
          Best/Worst re-run the same seeded simulation at risk tolerance 0.9 / 0.15, then apply
          a +12% / −13% outcome-shaping factor — directional stress bounds, not simulated
          frequencies. Top 3 Finish is an estimate (≈3× championship, capped at playoffs); the
          bracket simulation itself tracks champion, finalist, playoffs, and missed.
        </p>
      ) : null}
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
    color: THEME.green,
  }));
  const maxV = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Key Drivers — projected points / week</div>
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
  const color = regret > 60 ? THEME.red : regret > 30 ? THEME.amber : THEME.green;
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
          {/* Was assumptions.slice(0, 3) truncated to 60 chars, which cut the
              out-of-sample failure notice (assumptions[4]) out entirely. The
              notice now renders in full, as a component, below. */}
          {sim.assumptions.slice(0, 3).map((a, i) => (
            <li key={i}>{a.slice(0, 60)}{a.length > 60 ? "…" : ""}</li>
          ))}
        </ul>
      </div>
      <ModelScenarioNotice variant="inline" />
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
