"use client";

import { useEffect, useState } from "react";
import type { SourceMeta } from "@/lib/governance";
import type { PlayerValue } from "@/lib/trade/values";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";
import type { GradedTrade } from "@/lib/trade/transactions";
import { loadTradeValues, loadLeagueTrades } from "@/app/trade/actions";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";
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
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    loadTradeValues()
      .then((res) => {
        if (!active) return;
        setPool(res.players);
        setFormat(res.format);
        setSource(res.source);
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
      <PanelTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} ariaLabel="Trade Center tabs" />
      {state === "loading" && <p className="muted-note">Loading trade values…</p>}
      {state === "unavailable" && (
        <p className="muted-note">
          Trade values are unavailable right now (FantasyCalc and the fallback both failed). The
          builder is disabled rather than showing fabricated values.
        </p>
      )}
      {state === "ready" && activeTab === "Trade Builder" && (
        <TradeBuilder players={pool} format={format} />
      )}
      {state === "ready" && activeTab === "Recent League Trades" && (
        <RecentLeagueTrades trades={leagueTrades} />
      )}
    </PanelCard>
  );
}
