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

export interface LeagueOption {
  id: string;
  label: string;
  platform: "sleeper" | "espn";
}

export interface RaeAppProps {
  envelope: RAEEnvelope;
  /** Connected leagues for the signed-in user. Empty array for anonymous. */
  leagueOptions?: LeagueOption[];
  /** Currently-active league id (cookie-resolved). Null when no league active. */
  activeLeagueId?: string | null;
}

export function RaeApp({ envelope, leagueOptions = [], activeLeagueId = null }: RaeAppProps) {
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
        <TopBar
          envelope={envelope}
          active={activeSystem}
          onSelect={goToSystem}
          leagueOptions={leagueOptions}
          activeLeagueId={activeLeagueId}
        />

        <DemoBanner visible={envelope.mode === "fixture"} />

        <div className="governance-banner" role="status">
          <b>Source state:</b> {envelope.sourceState.source} · freshness {envelope.sourceState.freshness} · confidence {(envelope.sourceState.confidence * 100).toFixed(0)}% · validation {envelope.sourceState.validation}.
          {envelope.sourceState.failure ? <span> Failure: {envelope.sourceState.failure}</span> : null}
          {envelope.sourceState.missingFields.length > 0 ? (
            <span>
              {" · "}<b>Metrics without a data source yet:</b>{" "}
              {envelope.sourceState.missingFields.join(", ")}.
              Tiles or panels that depend on these render &quot;—&quot; instead of a number.
            </span>
          ) : null}
        </div>

        <PanelGrid>
          <PanelRow cols={2}>
            <CommandCenter
              players={players}
              envelope={envelope}
              sim={sim}
              metrics={commandMetrics}
            />
            <MarketIntelligence
              players={players}
              marketMetrics={marketMetrics}
              envelope={envelope}
            />
          </PanelRow>

          <PanelRow cols={3}>
            <PlayerUniverse players={players} envelope={envelope} />
            <NarrativeEngine players={players} envelope={envelope} />
            <NexusSimulator
              players={players}
              sim={sim}
              scenarios={scenarios}
              envelope={envelope}
            />
          </PanelRow>

          <PanelRow cols={1}>
            <DraftIntelligence players={players} />
          </PanelRow>

          <PanelRow cols={3}>
            <PreDraftAudit players={players} envelope={envelope} />
            <WaiverWire players={players} envelope={envelope} />
            <TradeCenter />
          </PanelRow>
        </PanelGrid>
      </SidebarInset>
    </SidebarProvider>
  );
}
