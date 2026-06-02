"use client";

import { useEffect, useRef, useState } from "react";
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
import { SYSTEM_ANCHORS, systems } from "./systems";

export { systems, type SystemName } from "./systems";

const SIM_BASE = { seed: 20260513, iterations: 2500, riskTolerance: 0.58 } as const;

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

  // Sprint 5: market-facing panels (Market Intelligence, Waiver, Player
  // Universe) show the whole league universe PRE-draft and only free agents
  // POST-draft; Command Center + Nexus always stay on the user's own roster.
  // `unknown` (fixtures, pre-Sprint-5 payloads) falls back to the roster.
  const draftState = envelope.draftState ?? "unknown";
  const universePool =
    envelope.leagueUniverse && envelope.leagueUniverse.length > 0
      ? envelope.leagueUniverse
      : envelope.draftPool && envelope.draftPool.length > 0
        ? envelope.draftPool
        : players;
  const freeAgentPool =
    envelope.freeAgents && envelope.freeAgents.length > 0 ? envelope.freeAgents : universePool;
  const marketPool =
    draftState === "pre" ? universePool : draftState === "post" ? freeAgentPool : players;

  // Season-sim params from the connected league (falls back to a standard
  // 12-team / 6-playoff / 9-starter league for the demo or unknown formats),
  // wired with the real weekly projections when the cron has them.
  const fmt = envelope.leagueFormat;
  const rosterSlots = fmt?.starters
    ? Math.max(1, Object.values(fmt.starters).reduce((a, b) => a + b, 0))
    : 9;
  const weeklyProjections = envelope.weeklyProjections
    ? new Map(Object.entries(envelope.weeklyProjections))
    : null;
  const simParams = {
    ...SIM_BASE,
    rosterSlots,
    numTeams: fmt?.numTeams ?? 12,
    playoffTeams: fmt?.playoffTeams ?? 6,
    regularSeasonWeeks: fmt?.playoffWeekStart ? Math.max(1, fmt.playoffWeekStart - 1) : 14,
    weeklyProjections
  };

  const sim = runNexusSimulation(players, simParams);
  const commandMetrics = deriveCommandMetrics(players);
  // Market metrics describe the market set the panel actually shows.
  const marketMetrics = deriveMarketMetrics(marketPool);
  const scenarios = deriveScenarioComparison(players, sim);

  // Suppress the scroll-spy briefly after a click so the programmatic smooth
  // scroll doesn't make the highlight flicker through intervening panels.
  const programmaticUntilRef = useRef(0);

  // Selecting a system highlights its nav entry AND scrolls its panel into
  // view. scroll-mt-* on PanelCard clears the sticky TopBar.
  const goToSystem = (system: string) => {
    setActiveSystem(system);
    programmaticUntilRef.current = Date.now() + 900;
    const anchor = SYSTEM_ANCHORS[system];
    if (!anchor) return;
    const el = typeof document !== "undefined" ? document.getElementById(anchor) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Scroll-spy: as the user scrolls, highlight the system whose panel is most
  // in view (below the sticky TopBar). Tracks every panel's intersection ratio
  // and picks the dominant one. Honors the click guard above.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const byId = new Map<string, string>();
    const targets: HTMLElement[] = [];
    for (const system of systems) {
      const el = document.getElementById(SYSTEM_ANCHORS[system] ?? "");
      if (el) {
        byId.set(el.id, system);
        targets.push(el);
      }
    }
    if (targets.length === 0) return;
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        if (Date.now() < programmaticUntilRef.current) return;
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, r] of ratios) {
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        const sys = bestId ? byId.get(bestId) : null;
        if (sys) setActiveSystem(sys);
      },
      { rootMargin: "-110px 0px -45% 0px", threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] }
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          {fmt ? (
            <span>
              <b>League:</b> {fmt.scoringFormat === "PPR" ? "PPR" : fmt.scoringFormat === "HALF" ? "Half-PPR" : "Standard"}
              {" · "}{fmt.numTeams}-team
              {envelope.season ? ` · ${envelope.season.completed ? `${envelope.season.completed}→` : ""}${envelope.season.upcoming}` : ""}
              {draftState !== "unknown" ? ` · ${draftState === "pre" ? "pre-draft (full universe)" : "post-draft (free agents)"}` : ""}
              {" · "}
            </span>
          ) : null}
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
              players={marketPool}
              marketMetrics={marketMetrics}
              envelope={envelope}
            />
          </PanelRow>

          <PanelRow cols={3}>
            <PlayerUniverse players={universePool} envelope={envelope} />
            <NarrativeEngine players={players} envelope={envelope} />
            <NexusSimulator
              players={players}
              sim={sim}
              scenarios={scenarios}
              envelope={envelope}
            />
          </PanelRow>

          <PanelRow cols={1}>
            {/* The draft board needs the FULL player pool (every rankable
                player incl. incoming rookies), not just your ~15-player roster.
                `universePool` is the Sleeper-keyed league universe (falls back to
                the FantasyPros draftPool, then the roster). */}
            <DraftIntelligence players={universePool} />
          </PanelRow>

          <PanelRow cols={3}>
            <PreDraftAudit players={players} envelope={envelope} />
            <WaiverWire players={marketPool} envelope={envelope} />
            <TradeCenter />
          </PanelRow>
        </PanelGrid>
      </SidebarInset>
    </SidebarProvider>
  );
}
