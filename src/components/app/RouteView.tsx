"use client";

import { useMemo } from "react";
import type { RAEEnvelope } from "@/lib/governance";
import { deriveAppData } from "@/lib/envelope/derive";
import { PanelGrid, PanelRow } from "@/components/shell/PanelGrid";
import { CommandCenter } from "@/components/panels/CommandCenter";
import { MarketIntelligence } from "@/components/panels/MarketIntelligence";
import { PlayerUniverse } from "@/components/panels/PlayerUniverse";
import { NarrativeEngine } from "@/components/panels/NarrativeEngine";
import { NexusSimulator } from "@/components/panels/NexusSimulator";
import { DraftIntelligence } from "@/components/panels/DraftIntelligence";
import { PreDraftAudit } from "@/components/panels/PreDraftAudit";
import { WaiverWire } from "@/components/panels/WaiverWire";
import { TradeCenter } from "@/components/panels/TradeCenter";

export type RouteViewName =
  | "dashboard"
  | "players"
  | "analytics"
  | "draft"
  | "waivers"
  | "trades";

/**
 * Renders the panel(s) for a given route from one shared `deriveAppData(envelope)`
 * computation (pools / sim / metrics) — the decomposed body of the former
 * single-page `RaeApp`. Each route's server page passes the resolved envelope;
 * panels keep their existing prop contracts and pool selection (Command Center /
 * Nexus = roster; market/narrative/waiver = market pool; draft/players = universe).
 */
export function RouteView({ view, envelope }: { view: RouteViewName; envelope: RAEEnvelope }) {
  const d = useMemo(() => deriveAppData(envelope), [envelope]);

  if (view === "players") {
    return <PlayerUniverse players={d.universePool} envelope={envelope} />;
  }
  if (view === "analytics") {
    return (
      <PanelGrid>
        <PanelRow cols={1}>
          <MarketIntelligence players={d.marketPool} marketMetrics={d.marketMetrics} envelope={envelope} />
        </PanelRow>
        <PanelRow cols={2}>
          <NexusSimulator players={d.players} sim={d.sim} scenarios={d.scenarios} envelope={envelope} />
          <NarrativeEngine players={d.marketPool} envelope={envelope} />
        </PanelRow>
      </PanelGrid>
    );
  }
  if (view === "draft") {
    return (
      <PanelGrid>
        <PanelRow cols={1}>
          <DraftIntelligence players={d.universePool} />
        </PanelRow>
        <PanelRow cols={1}>
          <PreDraftAudit players={d.players} envelope={envelope} />
        </PanelRow>
      </PanelGrid>
    );
  }
  if (view === "waivers") {
    return <WaiverWire players={d.marketPool} envelope={envelope} />;
  }
  if (view === "trades") {
    return <TradeCenter />;
  }

  // dashboard — the full nine-system board (Sprint 1: verbatim; becomes a true
  // overview in Sprint 2).
  return (
    <PanelGrid>
      <PanelRow cols={2}>
        <CommandCenter players={d.players} envelope={envelope} sim={d.sim} metrics={d.commandMetrics} />
        <MarketIntelligence players={d.marketPool} marketMetrics={d.marketMetrics} envelope={envelope} />
      </PanelRow>
      <PanelRow cols={3}>
        <PlayerUniverse players={d.universePool} envelope={envelope} />
        <NarrativeEngine players={d.marketPool} envelope={envelope} />
        <NexusSimulator players={d.players} sim={d.sim} scenarios={d.scenarios} envelope={envelope} />
      </PanelRow>
      <PanelRow cols={1}>
        <DraftIntelligence players={d.universePool} />
      </PanelRow>
      <PanelRow cols={3}>
        <PreDraftAudit players={d.players} envelope={envelope} />
        <WaiverWire players={d.marketPool} envelope={envelope} />
        <TradeCenter />
      </PanelRow>
    </PanelGrid>
  );
}
