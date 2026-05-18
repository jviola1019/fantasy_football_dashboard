"use client";

import { useState } from "react";
import { runNexusSimulation } from "@/lib/simulation";
import type { RAEEnvelope } from "@/lib/governance";
import {
  deriveCommandMetrics,
  deriveMarketMetrics,
  deriveScenarioComparison,
} from "@/lib/derivedMetrics";
import { Sidebar } from "./Sidebar";
import { CommandCenter } from "./panels/CommandCenter";
import { MarketIntelligence } from "./panels/MarketIntelligence";
import { PlayerUniverse } from "./panels/PlayerUniverse";
import { NarrativeEngine } from "./panels/NarrativeEngine";
import { NexusSimulator } from "./panels/NexusSimulator";
import { DraftIntelligence } from "./panels/DraftIntelligence";

export const systems = [
  "Command Center",
  "Market Intelligence",
  "Player Universe",
  "Narrative Engine",
  "Nexus Simulator",
  "Draft Intelligence",
] as const;

export type SystemName = (typeof systems)[number];

const SIM_PARAMS = { seed: 20260513, iterations: 2500, rosterSlots: 6, riskTolerance: 0.58 } as const;

export function RaeApp({ envelope }: { envelope: RAEEnvelope }) {
  const [activeSystem, setActiveSystem] = useState<string>("Command Center");
  const players = envelope.records;

  const sim = runNexusSimulation(players, SIM_PARAMS);
  const commandMetrics = deriveCommandMetrics(players);
  const marketMetrics = deriveMarketMetrics(players);
  const scenarios = deriveScenarioComparison(players, sim);

  return (
    <div className="rae-shell">
      <Sidebar active={activeSystem} onChange={setActiveSystem} />

      <div className="rae-content">
        <header className="topbar" aria-label="RAE primary navigation">
          <div className="brand">
            <span>RAE</span>
            <small>Reputation<br />Arbitrage<br />Engine</small>
          </div>
          <nav className="system-tabs" aria-label="Top-level systems">
            {systems.map((system, index) => (
              <button
                key={system}
                className={`tab-link${activeSystem === system ? " active" : ""}`}
                onClick={() => setActiveSystem(system)}
              >
                {index + 1}. {system}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <div className="ops-status" aria-live="polite">
              <b className={envelope.mode === "live" ? "status-live" : envelope.mode === "fixture" ? "status-fixture" : "status-err"}>
                {envelope.mode.toUpperCase()}
              </b>
              <span>{envelope.sourceState.freshness}</span>
            </div>
          </div>
        </header>

        <div className="governance-banner" role="status">
          <b>Source state:</b> {envelope.sourceState.source} · freshness {envelope.sourceState.freshness} · confidence {(envelope.sourceState.confidence * 100).toFixed(0)}% · validation {envelope.sourceState.validation}.
          {envelope.sourceState.failure ? <span> Failure: {envelope.sourceState.failure}</span> : null}
        </div>

        <div className="dashboard-grid">
          <CommandCenter
            players={players}
            envelope={envelope}
            sim={sim}
            metrics={commandMetrics}
          />
          <MarketIntelligence
            players={players}
            marketMetrics={marketMetrics}
          />
        </div>

        <div className="bottom-panels">
          <PlayerUniverse players={players} />
          <NarrativeEngine players={players} />
          <NexusSimulator players={players} sim={sim} scenarios={scenarios} />
        </div>

        <div className="bottom-panels">
          <DraftIntelligence players={players} />
        </div>
      </div>
    </div>
  );
}
