"use client";

import { Zap } from "lucide-react";
import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import { PanelCard } from "../ui/PanelCard";
import { DataUnavailable } from "../ui/DataUnavailable";
import type { SimulationResult } from "@/lib/simulation";
import { PositionBadge } from "../PlayerRow";
import { PlayerHeadshot } from "../PlayerHeadshot";
import { fixtureHeadshotFallbacks } from "@/lib/fixtures";
import type { CommandMetrics, PositionGrades } from "@/lib/derivedMetrics";
import { narrativeVelocity } from "@/lib/models";
import {
  deriveNarrativeMovers,
  derivePositionGrades,
  deriveStartSitEdge,
} from "@/lib/derivedMetrics";
import { derivePanelState } from "@/lib/panelState";
import { fmt } from "@/lib/utils";

type Props = {
  players: PlayerMarketRecord[];
  envelope: RAEEnvelope;
  sim: SimulationResult;
  metrics: CommandMetrics;
};

export function CommandCenter({ players, envelope, sim, metrics }: Props) {
  const hasData = players.length > 0;
  const movers = deriveNarrativeMovers(players);
  const grades = derivePositionGrades(players);
  const startSit = deriveStartSitEdge(players);
  const avgEdge = metrics.reputationEdge;
  const marketEdge = Math.round(Math.min(99, Math.max(0, 50 + avgEdge * 1.4)));
  const missing = new Set(envelope.sourceState.missingFields);
  const trendingMissing = missing.has("trending_momentum");
  const fragilityMissing = missing.has("fragility");

  return (
    <PanelCard
      id="command-center"
      titleId="cc-title"
      title="Command Center"
      eyebrow="Real-time intelligence. Smarter decisions."
      icon={<Zap />}
      controls={
        <>
          {envelope.mode === "live" && <span className="live-badge">● LIVE</span>}
          {envelope.mode === "fixture" && <span className="fixture-badge">FIXTURE</span>}
        </>
      }
    >
      <MetricStrip metrics={metrics} missingFields={envelope.sourceState.missingFields} />

      <div className="pulse-wrapper">
        <LeaguePulse players={players} marketEdge={marketEdge} />
        <NarrativeMomentum gainers={movers.gainers} decliners={movers.decliners} unavailable={trendingMissing} />
      </div>

      <div className="bottom-row">
        <IntelFeed envelope={envelope} />
        <LineupWinProb sim={sim} />
        <TeamConstructionScore grades={grades} fragilityMissing={fragilityMissing} />
        <RosterFragilityXRay players={players} envelope={envelope} />
        <StartSitEdge rows={startSit} hasData={hasData} />
      </div>
    </PanelCard>
  );
}

function MetricStrip({
  metrics,
  missingFields
}: {
  metrics: CommandMetrics;
  missingFields: string[];
}) {
  // Per-tile data dependencies. When any dependency is in missingFields,
  // the tile renders "—" with a "data unavailable" subtitle instead of a
  // number derived from a zeroed field. Keeps the dashboard honest when
  // a partial dataset (e.g. Sleeper + FantasyPros without sentiment) is
  // driving the panels.
  const missing = new Set(missingFields);
  const trendingUnavailable = missing.has("trending_momentum");
  const chaosUnavailable = missing.has("trending_momentum") || missing.has("opportunity");

  const cards = [
    {
      label: "Reputation Edge",
      value: fmt(metrics.reputationEdge, 1),
      sub: "Avg True – Market Value",
      color: metrics.reputationEdge >= 0 ? "pos" : "neg"
    },
    {
      label: "Market Inefficiency",
      // VOR magnitude (unitless index), not a percentage — no "%".
      value: fmt(metrics.marketInefficiency, 1),
      sub: "Avg Value Over Replacement",
      color: "neu"
    },
    trendingUnavailable
      ? { label: "Narrative Velocity", value: "—", sub: "Data source not integrated", color: "neu" }
      : {
          label: "Narrative Velocity",
          value: fmt(metrics.narrativeVelocity, 1),
          sub: metrics.narrativeVelocity > 10 ? "High" : metrics.narrativeVelocity > 0 ? "Moderate" : "Low",
          color: metrics.narrativeVelocity >= 0 ? "pos" : "neg"
        },
    {
      label: "League Advantage",
      // Empty/pre-draft rosters yield NaN here; show "—" rather than "NaN%".
      value: Number.isFinite(metrics.leagueAdvantage) ? `${metrics.leagueAdvantage}%` : "—",
      sub: "vs League Median",
      color: !Number.isFinite(metrics.leagueAdvantage)
        ? "neu"
        : metrics.leagueAdvantage >= 50
          ? "pos"
          : "neg"
    },
    chaosUnavailable
      ? { label: "Chaos Exposure", value: "—", sub: "Data source not integrated", color: "neu" }
      : {
          label: "Chaos Exposure",
          value: `${fmt(metrics.chaosExposure, 0)}/100`,
          sub: metrics.chaosExposure > 50 ? "High" : "Moderate",
          color: metrics.chaosExposure > 60 ? "neg" : "neu"
        }
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

const PULSE_POS_COLOR: Record<string, string> = {
  QB: "var(--pos-qb)",
  RB: "var(--pos-rb)",
  WR: "var(--pos-wr)",
  TE: "var(--pos-te)",
  K: "var(--muted)",
  DEF: "var(--muted)"
};
const PULSE_MAX_ROWS = 14;

function LeaguePulse({ players, marketEdge }: { players: PlayerMarketRecord[]; marketEdge: number }) {
  const ranked = [...players].sort((a, b) => b.trueValue - a.trueValue).slice(0, PULSE_MAX_ROWS);
  // Scale bars to the strongest player shown (top = full track). A 4% floor
  // keeps a low-but-nonzero value visible without distorting the comparison.
  const maxVal = Math.max(ranked[0]?.trueValue ?? 1, 1);
  return (
    <div className="league-pulse" role="region" aria-label="League pulse player leaderboard">
      <div className="league-pulse-topbar">
        <span className="league-pulse-label">LEAGUE PULSE</span>
        <span className="league-pulse-edge-pill">
          <span className="league-pulse-edge-val">{marketEdge}</span>
          <span className="league-pulse-edge-lbl">Market Edge</span>
        </span>
      </div>

      {players.length === 0 ? (
        <div className="league-pulse-empty" role="status">
          <span className="lp-empty-icon">—</span>
          <span>Awaiting league data</span>
        </div>
      ) : (
        <ol className="lp-board" aria-label="Players ranked by true value">
          {ranked.map((p, idx) => {
            const value = Math.round(p.trueValue);
            const pct = p.trueValue > 0 ? Math.max(4, (p.trueValue / maxVal) * 100) : 0;
            return (
              <li key={p.id} className="lp-row">
                <span className="lp-rank">{idx + 1}</span>
                <PlayerHeadshot player={p} fallbacks={fixtureHeadshotFallbacks[p.id] ?? []} size={26} />
                <span className="lp-id">
                  <span className="lp-name">{p.name}</span>
                  <PositionBadge position={p.position} />
                </span>
                <span className="lp-bar-track" aria-hidden="true">
                  <span
                    className="lp-bar"
                    style={{
                      ["--bar-w" as string]: `${pct}%`,
                      ["--bar-c" as string]: PULSE_POS_COLOR[p.position] ?? "var(--green)"
                    }}
                  />
                </span>
                <span className="lp-value">{value}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function NarrativeMomentum({
  gainers,
  decliners,
  unavailable,
}: {
  gainers: PlayerMarketRecord[];
  decliners: PlayerMarketRecord[];
  unavailable: boolean;
}) {
  // Honest gating: narrative momentum derives from trendingMomentum. When that
  // field is declared missing (no news/trending source), don't rank "gainers"
  // off a zeroed signal — say so, mirroring the Narrative Velocity KPI.
  if (unavailable) {
    return (
      <div className="narrative-momentum">
        <div className="momentum-header">NARRATIVE MOMENTUM</div>
        <p className="muted-note">Trending/sentiment source not integrated — no momentum to rank.</p>
      </div>
    );
  }
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
  // These are provenance lines (data assumptions / adapter state), not
  // time-stamped events — so we show the ONE real timestamp the envelope
  // carries (when the data was fetched) once, rather than fabricating a
  // per-row "Xm ago" age that would read as real event times.
  const alerts = [
    ...envelope.sourceState.assumptions,
    envelope.sourceState.failure ?? "Adapter state nominal.",
    `Mode: ${envelope.mode.toUpperCase()} · Freshness: ${envelope.sourceState.freshness}`,
  ].filter(Boolean);
  const stampSource = envelope.sourceState.fetchedAt ?? envelope.generatedAt;
  const asOf = stampSource ? new Date(stampSource) : null;
  const asOfLabel = asOf && !Number.isNaN(asOf.getTime())
    ? asOf.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Intelligence Feed</div>
      {asOfLabel && <div className="intel-asof">As of {asOfLabel}</div>}
      <ul className="intel-list">
        {alerts.map((a, i) => (
          <li key={i} className="intel-item">
            <span className="intel-dot" aria-hidden="true" />
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
          {/* Three distinct points: median in the centre, P10 (downside) and
              P90 (upside) on the two base corners. The apex carries the small
              "median" caption — not a duplicate P90. */}
          <text x={tCx} y={tTop - 2} textAnchor="middle" fontSize="8" fill="var(--muted)">MEDIAN</text>
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

function TeamConstructionScore({ grades, fragilityMissing }: { grades: PositionGrades; fragilityMissing: boolean }) {
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Team Construction Score</div>
      <div className="overall-grade">{grades.overall}</div>
      <div className="position-grades">
        {grades.positions.map(({ pos, grade }) => {
          // The DEF grade is driven by fragility; when that field is missing it
          // is a constant, so show "—" rather than a fabricated letter grade.
          const show = pos === "DEF" && fragilityMissing ? "—" : grade;
          return (
            <div key={pos} className="pos-grade-row">
              <span className="pos-label">{pos}</span>
              <span className={`grade-val grade-${show[0]?.toLowerCase()}`}>{show}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RosterFragilityXRay({
  players,
  envelope
}: {
  players: PlayerMarketRecord[];
  envelope: RAEEnvelope;
}) {
  // Honest degradation: without an injury / snap-share adapter, every player's
  // fragility is 0 (the Sleeper/FantasyPros pipeline declares the field as
  // missing). Render the DataUnavailable banner rather than a dot-grid where
  // every dot is the same colour. Same pattern as Sprint-2 NarrativeEngine.
  const fragilityState = derivePanelState(envelope, ["fragility"]);
  if (fragilityState.status === "unavailable") {
    return (
      <div className="mini-panel">
        <div className="mini-panel-title">Roster Fragility X-Ray</div>
        <DataUnavailable
          title="Injury / snap-share source not integrated"
          description="Per-player fragility requires a snap-count or injury-trend feed. nflverse / PFR / ESPN don't expose this on a free public endpoint; the fragility column stays neutral pending a paid adapter."
        />
      </div>
    );
  }

  const topFragile = [...players].sort((a, b) => b.fragility - a.fragility).slice(0, 5);
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Roster Fragility X-Ray</div>
      {topFragile.length === 0 ? (
        <p className="muted-note">No data.</p>
      ) : (
        <ul className="frag-rows">
          {topFragile.map((p) => {
            const f = Math.max(0, Math.min(100, p.fragility));
            const tier = f > 60 ? "high" : f > 35 ? "elev" : "low";
            const label = f > 60 ? "High" : f > 35 ? "Elevated" : "Low";
            return (
              <li key={p.id} className="frag-row" data-tier={tier}>
                <span className="frag-name" title={p.name}>{p.name}</span>
                <span className="frag-pos">{p.position}</span>
                <span className="frag-track" aria-hidden="true">
                  <span className="frag-fill" style={{ ["--f" as string]: `${f}%` }} />
                </span>
                <span className="frag-label">{label}</span>
                <span className="frag-score">{Math.round(f)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="small-note frag-note">Relative injury / snap-volatility risk (0–100).</p>
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
