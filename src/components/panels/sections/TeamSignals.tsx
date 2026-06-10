"use client";

import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import type { SimulationResult } from "@/lib/simulation";
import { deriveNarrativeMovers } from "@/lib/derivedMetrics";
import { narrativeVelocity } from "@/lib/models";
import { wilsonInterval } from "@/lib/stats/distribution";
import { PanelCard } from "../../ui/PanelCard";

/**
 * Team Signals (/analytics) — the lineup win-probability, intelligence feed, and
 * narrative-momentum mini-panels, re-homed verbatim from the former CommandCenter
 * so they sit with the rest of the analytics/narrative views.
 */
export function TeamSignals({
  sim,
  envelope,
  players
}: {
  sim: SimulationResult;
  envelope: RAEEnvelope;
  players: PlayerMarketRecord[];
}) {
  const movers = deriveNarrativeMovers(players);
  const trendingMissing = new Set(envelope.sourceState.missingFields).has("trending_momentum");
  return (
    <PanelCard
      id="team-signals"
      titleId="ts-title"
      title="Team Signals"
      eyebrow="Win odds, intel, and momentum."
      source={envelope.sourceState}
    >
      <div className="bottom-row">
        <LineupWinProb sim={sim} />
        <IntelFeed envelope={envelope} />
        <NarrativeMomentum gainers={movers.gainers} decliners={movers.decliners} unavailable={trendingMissing} />
      </div>
    </PanelCard>
  );
}

function LineupWinProb({ sim }: { sim: SimulationResult }) {
  const mid = Math.min(100, Math.max(0, sim.playoffProbability));
  // Honest uncertainty: the Wilson 90% interval for the simulated playoff
  // FREQUENCY over the actual number of seasons. This is Monte-Carlo SAMPLING
  // error only — it shrinks as iterations grow and does NOT capture model/input
  // uncertainty. (Replaces a former fabricated ±32% "P10/P90" band.)
  const ci = wilsonInterval(mid / 100, sim.params.iterations, 0.9);
  const lo = Math.round(ci.lower * 1000) / 10;
  const hi = Math.round(ci.upper * 1000) / 10;
  const tCx = 60;
  const tTop = 10;
  const tBot = 95;
  const halfW = 50;
  return (
    <div className="mini-panel">
      <div className="mini-panel-title">Playoff Probability</div>
      <div className="triangle-wrap">
        <svg viewBox="-14 -6 148 138" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <polygon
            points={`${tCx},${tTop} ${tCx - halfW},${tBot} ${tCx + halfW},${tBot}`}
            fill="rgba(119,215,176,0.08)"
            stroke="rgba(119,215,176,0.5)"
            strokeWidth="1.5"
          />
          <text x={tCx} y={tTop - 2} textAnchor="middle" fontSize="8" fill="var(--muted)">ESTIMATE</text>
          <text x={tCx} y={(tTop + tBot) / 2 + 4} textAnchor="middle" fontSize="16" fill="var(--cream)" fontWeight="700">{mid}%</text>
          <text x={tCx - halfW} y={tBot + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">LOW</text>
          <text x={tCx - halfW} y={tBot + 26} textAnchor="middle" fontSize="10" fill="var(--red)">{lo}%</text>
          <text x={tCx + halfW} y={tBot + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">HIGH</text>
          <text x={tCx + halfW} y={tBot + 26} textAnchor="middle" fontSize="10" fill="var(--green)">{hi}%</text>
        </svg>
      </div>
      <div className="small-note">
        90% Monte-Carlo interval over {sim.params.iterations.toLocaleString()} simulated seasons
        — sampling error only, excludes model uncertainty.
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

function NarrativeMomentum({
  gainers,
  decliners,
  unavailable
}: {
  gainers: PlayerMarketRecord[];
  decliners: PlayerMarketRecord[];
  unavailable: boolean;
}) {
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
        <a href="/analytics#narrative-engine" className="view-all-link">View All →</a>
      </div>
    </div>
  );
}
