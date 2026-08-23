"use client";

import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import type { SimulationResult } from "@/lib/simulation";
import { deriveNarrativeMovers } from "@/lib/derivedMetrics";
import { narrativeVelocity } from "@/lib/models";
import { wilsonInterval } from "@/lib/stats/distribution";
import { ModelScenarioNotice } from "@/components/model/ModelScenarioNotice";
import { ScenarioOutlook } from "@/components/model/ScenarioOutlook";
import { structuralBaseline } from "@/lib/models/scenarioBand";
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
    >
      <div className="bottom-row">
        <LineupWinProb sim={sim} />
        <IntelFeed envelope={envelope} />
        <NarrativeMomentum gainers={movers.gainers} decliners={movers.decliners} unavailable={trendingMissing} />
      </div>
    </PanelCard>
  );
}

/**
 * Playoff scenario tile (audit 2026-08-20 SS3, Strategy B).
 *
 * What was here: a triangle chart with the simulated playoff percentage set in
 * 16px type at its centre, captioned "ESTIMATE", flanked by LOW and HIGH legs
 * from a Wilson interval. Every element of that presentation asserted a
 * calibrated point forecast with quantified error - and the interval was
 * Monte-Carlo sampling error only, which shrinks with iteration count and says
 * nothing about whether the model is right. On the backtest it is not: AUC 0.25
 * with a CI entirely below 0.5.
 *
 * The chart was not kept and re-pointed at the baseline, because with a fixed
 * structural baseline its LOW/HIGH legs carry no information - it would have
 * become decoration, which CLAUDE.md rules out ("no meaningless charts"). The
 * shared scenario presentation is used instead, so this surface and the Nexus
 * panel state the same thing the same way.
 *
 * The Wilson interval is retained, correctly scoped, inside the raw disclosure.
 */
function LineupWinProb({ sim }: { sim: SimulationResult }) {
  const mid = Math.min(100, Math.max(0, sim.playoffProbability));
  // Monte-Carlo SAMPLING error only - it shrinks as iterations grow and does
  // NOT capture model or input uncertainty, which is the dominant term here.
  const ci = wilsonInterval(mid / 100, sim.params.iterations, 0.9);
  const baseline = structuralBaseline(sim.params.numTeams ?? 12, sim.params.playoffTeams ?? 6);
  return (
    <div className="mini-panel">
      <div className="mini-panel-title" id="playoff-scenario-title">
        Playoff Scenario
      </div>
      <ModelScenarioNotice variant="banner" />
      <ScenarioOutlook
        headingId="playoff-scenario-title"
        numTeams={baseline.numTeams}
        playoffTeams={baseline.playoffTeams}
        iterations={sim.params.iterations}
        seed={sim.seed}
        rows={[
          {
            label: "Playoffs",
            scenarioPct: mid,
            baselinePct: baseline.playoffs,
            interval: {
              estimate: mid,
              lower: Math.round(ci.lower * 1000) / 10,
              upper: Math.round(ci.upper * 1000) / 10,
              width: Math.round((ci.upper - ci.lower) * 1000) / 10,
              level: 0.9
            }
          }
        ]}
      />
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
