"use client";

import { useState } from "react";
import { runNexusSimulation } from "@/lib/simulation";
import type { RAEEnvelope } from "@/lib/governance";
import {
  deriveCommandMetrics,
  deriveMarketMetrics,
  deriveScenarioComparison,
} from "@/lib/derivedMetrics";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./shell/AppSidebar";
import { TopBar } from "./shell/TopBar";
import { PanelGrid, PanelRow } from "./shell/PanelGrid";
import { CommandCenter } from "./panels/CommandCenter";
import { MarketIntelligence } from "./panels/MarketIntelligence";
import { PlayerUniverse } from "./panels/PlayerUniverse";
import { NarrativeEngine } from "./panels/NarrativeEngine";
import { NexusSimulator } from "./panels/NexusSimulator";
import { DraftIntelligence } from "./panels/DraftIntelligence";
import { PreDraftAudit } from "./panels/PreDraftAudit";
import { WaiverWire } from "./panels/WaiverWire";
import { TradeCenter } from "./panels/TradeCenter";
import { DemoBanner } from "./topbar/DemoBanner";
import { SYSTEM_ANCHORS } from "./systems";

export { systems, type SystemName } from "./systems";

const SIM_PARAMS = { seed: 20260513, iterations: 2500, rosterSlots: 6, riskTolerance: 0.58 } as const;

export function RaeApp({ envelope }: { envelope: RAEEnvelope }) {
  const [activeSystem, setActiveSystem] = useState<string>("Command Center");
  const players = envelope.records;

  const sim = runNexusSimulation(players, SIM_PARAMS);
  const commandMetrics = deriveCommandMetrics(players);
  const marketMetrics = deriveMarketMetrics(players);
  const scenarios = deriveScenarioComparison(players, sim);

  // Selecting a system highlights its nav entry AND scrolls its panel into
  // view. scroll-mt-* on PanelCard clears the sticky TopBar.
  const goToSystem = (system: string) => {
    setActiveSystem(system);
    const anchor = SYSTEM_ANCHORS[system];
    if (!anchor) return;
    const el = typeof document !== "undefined" ? document.getElementById(anchor) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <SidebarProvider>
      <AppSidebar active={activeSystem} onSelect={goToSystem} />
      <SidebarInset>
        <TopBar envelope={envelope} active={activeSystem} onSelect={goToSystem} />

        <DemoBanner visible={envelope.mode === "fixture"} />

        <div className="governance-banner" role="status">
          <b>Source state:</b> {envelope.sourceState.source} · freshness {envelope.sourceState.freshness} · confidence {(envelope.sourceState.confidence * 100).toFixed(0)}% · validation {envelope.sourceState.validation}.
          {envelope.sourceState.failure ? <span> Failure: {envelope.sourceState.failure}</span> : null}
        </div>

        <PanelGrid>
          <PanelRow cols={2}>
            <CommandCenter
              players={players}
              envelope={envelope}
              sim={sim}
              metrics={commandMetrics}
            />
            <MarketIntelligence players={players} marketMetrics={marketMetrics} />
          </PanelRow>

          <PanelRow cols={3}>
            <PlayerUniverse players={players} />
            <NarrativeEngine players={players} />
            <NexusSimulator players={players} sim={sim} scenarios={scenarios} />
          </PanelRow>

          <PanelRow cols={1}>
            <DraftIntelligence players={players} />
          </PanelRow>

          <PanelRow cols={3}>
            <PreDraftAudit players={players} />
            <WaiverWire players={players} />
            <TradeCenter players={players} />
          </PanelRow>
        </PanelGrid>
      </SidebarInset>
    </SidebarProvider>
  );
}
