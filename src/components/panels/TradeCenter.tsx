"use client";

import { useEffect, useState } from "react";
import type { SourceMeta } from "@/lib/governance";
import type { PlayerValue } from "@/lib/trade/values";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";
import type { GradedTrade } from "@/lib/trade/transactions";
import {
  loadTradeValues,
  loadLeagueTrades,
  type TradeLeagueIdentity
} from "@/app/trade/actions";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs, TabPanel } from "../ui/PanelTabs";
import { TradeBuilder } from "./trade/TradeBuilder";
import { RecentLeagueTrades } from "./trade/RecentLeagueTrades";

const TABS = ["Trade Builder", "Recent League Trades"] as const;

export function TradeCenter() {
  const [activeTab, setActiveTab] = useState<string>("Trade Builder");
  const [pool, setPool] = useState<PlayerValue[]>([]);
  const [format, setFormat] = useState<LeagueFormat>(DEFAULT_FORMAT);
  const [leagueTrades, setLeagueTrades] = useState<GradedTrade[]>([]);
  // Trade values come from FantasyCalc/KTC/DynastyProcess — a different
  // upstream than the envelope described by the route-level GovernanceBanner —
  // so this panel carries its own lineage badge (audit 2026-07-08 F-02).
  const [source, setSource] = useState<SourceMeta | null>(null);
  // Which league produced these numbers (audit P2 §8). A value pool is only
  // meaningful beside the league whose size, scoring and horizon priced it.
  const [league, setLeague] = useState<TradeLeagueIdentity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    loadTradeValues()
      .then((res) => {
        if (!active) return;
        setPool(res.players);
        setFormat(res.format);
        setSource(res.source);
        setLeague(res.league);
        setState(res.available ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    loadLeagueTrades()
      .then((trades) => {
        if (active) setLeagueTrades(trades);
      })
      .catch(() => {
        /* no connected league — RecentLeagueTrades shows its empty state */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PanelCard
      id="trade-center"
      titleId="tc-title"
      title="Trade Center"
      eyebrow="Value trades on real market data."
      source={source ?? undefined}
    >
      <PanelTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        ariaLabel="Trade Center tabs"
        idBase="trade-center"
      />
      <TradeLeagueLine league={league} format={format} state={state} />
      {state === "loading" && <p className="muted-note">Loading trade values…</p>}
      {state === "unavailable" && (
        <p className="muted-note">
          Trade values are unavailable right now (FantasyCalc and the fallback both failed). The
          builder is disabled rather than showing fabricated values.
        </p>
      )}
      <TabPanel idBase="trade-center" active={activeTab}>
        {state === "ready" && activeTab === "Trade Builder" && (
          <TradeBuilder players={pool} format={format} />
        )}
        {state === "ready" && activeTab === "Recent League Trades" && (
          <RecentLeagueTrades trades={leagueTrades} />
        )}
      </TabPanel>
    </PanelCard>
  );
}

/**
 * Name the league the numbers belong to (audit P2 §8).
 *
 * Trade Center previously priced against `leagues[0]` while the header showed
 * whichever league the user had actually selected — so the wrong values could
 * appear beneath the right league name with nothing to give it away. Stating
 * the league and its shape here makes that class of mismatch self-evident.
 *
 * Uses `.trade-league-line`, NOT `.muted-note`: e2e treats a `.muted-note`
 * inside #trade-center as the "values unavailable" sentinel, and this line is
 * always present, so sharing the class broke that assertion whenever values
 * loaded successfully.
 */
function TradeLeagueLine({
  league,
  format,
  state
}: {
  league: TradeLeagueIdentity | null;
  format: LeagueFormat;
  state: "loading" | "ready" | "unavailable";
}) {
  if (state === "loading") return null;

  const shape =
    `${format.numTeams}-team · ${format.scoringFormat}` +
    `${format.numQbs === 2 ? " · superflex" : ""} · ${format.leagueType}`;

  if (!league) {
    return (
      <p className="trade-league-line">
        No league connected — values use the default {shape} shape.{" "}
        <a className="demo-banner-cta" href="/settings/leagues">
          Connect a league →
        </a>
      </p>
    );
  }

  return (
    <p className="trade-league-line">
      Priced for <strong>{league.label}</strong> ({league.platform.toUpperCase()} {league.season}) ·{" "}
      {shape}
      {league.reason === "selection-unavailable" && (
        <>
          {" "}
          — your previously selected league is no longer available, so this is your first league
          instead.
        </>
      )}
      {league.reason === "no-selection" && league.leagueCount > 1 && (
        <> — showing your first of {league.leagueCount} leagues; switch in the header.</>
      )}
    </p>
  );
}
