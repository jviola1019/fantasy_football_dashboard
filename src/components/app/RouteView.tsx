// Server component: the per-render derivation (a 2,500-iteration season Monte
// Carlo + the 20-replicate bootstrap bands + metrics) now runs on the server and
// streams plain data to the client panels, instead of blocking the client main
// thread during hydration (the former /analytics TBT hotspot). The panels stay
// "use client" for their own interactivity and receive serializable props.
import type { RAEEnvelope } from "@/lib/governance";
import { deriveAppData } from "@/lib/envelope/derive";
import { PanelGrid, PanelRow } from "@/components/shell/PanelGrid";
import { MarketIntelligence } from "@/components/panels/MarketIntelligence";
import { PlayerUniverse } from "@/components/panels/PlayerUniverse";
import { NarrativeEngine } from "@/components/panels/NarrativeEngine";
import { NexusSimulator } from "@/components/panels/NexusSimulator";
import { DraftIntelligence } from "@/components/panels/DraftIntelligence";
import { PreDraftAudit } from "@/components/panels/PreDraftAudit";
import { WaiverWire } from "@/components/panels/WaiverWire";
import { TradeCenter } from "@/components/panels/TradeCenter";
import { NextBestActionPanel } from "@/components/dashboard/NextBestActionPanel";
import { SeasonNotice } from "@/components/dashboard/SeasonNotice";
import { LeagueHealth } from "@/components/dashboard/LeagueHealth";
import { LeaguePulse } from "@/components/dashboard/LeaguePulse";
import { TopInsights } from "@/components/dashboard/TopInsights";
import { TeamSignals } from "@/components/panels/sections/TeamSignals";
import { RosterHealth } from "@/components/panels/sections/RosterHealth";
import { TeamConstruction } from "@/components/panels/sections/TeamConstruction";

export type RouteViewName =
  | "dashboard"
  | "players"
  | "analytics"
  | "draft"
  | "waivers"
  | "trades";

/**
 * Renders the panel(s) for a given route from one shared `deriveAppData(envelope)`
 * computation (pools / sim / metrics). `/dashboard` is a tiled OVERVIEW (League
 * Health + League Pulse + Top Insights + Next Best Actions); the former
 * CommandCenter's deep sections are re-homed to where they're analytically at
 * home — Team Signals on /analytics, Roster Health on /players, Team Construction
 * on /draft. Pool selection is preserved (roster vs market vs universe).
 */
export function RouteView({ view, envelope }: { view: RouteViewName; envelope: RAEEnvelope }) {
  const d = deriveAppData(envelope);

  if (view === "players") {
    return (
      <PanelGrid>
        <PanelRow cols={1}>
          <PlayerUniverse players={d.universePool} envelope={envelope} />
        </PanelRow>
        <PanelRow cols={1}>
          <RosterHealth players={d.players} />
        </PanelRow>
      </PanelGrid>
    );
  }
  if (view === "analytics") {
    return (
      <PanelGrid>
        <PanelRow cols={1}>
          <MarketIntelligence players={d.marketPool} marketMetrics={d.marketMetrics} sim={d.sim} envelope={envelope} />
        </PanelRow>
        <PanelRow cols={2}>
          <NexusSimulator players={d.players} sim={d.sim} scenarios={d.scenarios} confidenceBands={d.confidenceBands} envelope={envelope} />
          <NarrativeEngine players={d.marketPool} envelope={envelope} />
        </PanelRow>
        <PanelRow cols={1}>
          <TeamSignals sim={d.sim} envelope={envelope} players={d.players} />
        </PanelRow>
      </PanelGrid>
    );
  }
  if (view === "draft") {
    const fragilityMissing = new Set(envelope.sourceState.missingFields).has("fragility");
    return (
      <PanelGrid>
        <PanelRow cols={1}>
          <DraftIntelligence players={d.universePool} format={d.leagueFormat} />
        </PanelRow>
        <PanelRow cols={1}>
          <PreDraftAudit players={d.players} envelope={envelope} />
        </PanelRow>
        <PanelRow cols={1}>
          <TeamConstruction
            players={d.players}
            fragilityMissing={fragilityMissing}
            format={d.leagueFormat}
            board={d.universePool}
          />
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

  // dashboard — a tiled OVERVIEW (progressive disclosure): League Health + League
  // Pulse + Top Insights + Next Best Actions, each linking into the deep routes.
  const marketEdge = Math.round(Math.min(99, Math.max(0, 50 + d.commandMetrics.scarcityGap * 1.4)));
  return (
    <>
      <SeasonNotice envelope={envelope} hasPlayers={d.players.length > 0} />
      <PanelGrid>
        <PanelRow cols={2}>
          <LeagueHealth metrics={d.commandMetrics} missingFields={envelope.sourceState.missingFields} />
          <LeaguePulse players={d.players} marketEdge={marketEdge} />
        </PanelRow>
        <PanelRow cols={2}>
          <TopInsights market={d.marketPool} />
          <NextBestActionPanel roster={d.players} market={d.marketPool} draftState={envelope.draftState} />
        </PanelRow>
      </PanelGrid>
    </>
  );
}
