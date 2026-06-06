"use client";

import Link from "next/link";
import type { PlayerMarketRecord } from "@/lib/governance";
import { reputationEdge } from "@/lib/models";
import { PanelCard } from "../ui/PanelCard";

type Tone = "risk" | "sell" | "buy" | "add" | "draft";
interface Action {
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: Tone;
}

const STATUS_LABEL: Record<string, string> = {
  out: "Out",
  ir: "IR",
  questionable: "Questionable",
  bye: "Bye"
};
const STATUS_RANK: Record<string, number> = { out: 4, ir: 4, questionable: 2, bye: 1 };

/**
 * The overview's "what should I do next?" — a few concrete, source-backed actions
 * derived from REAL signals (injury status, hype-vs-value gap, usage/value), each
 * linking to the route where you act on it. Honest empty state when nothing
 * crosses a threshold; never fabricates an action.
 */
export function NextBestActionPanel({
  roster,
  market,
  draftState
}: {
  roster: PlayerMarketRecord[];
  market: PlayerMarketRecord[];
  draftState?: "pre" | "post" | "unknown" | null;
}) {
  const actions: Action[] = [];

  // 1. Injury / availability risk on your roster (real `status`).
  const hurt = roster
    .filter((p) => p.status === "out" || p.status === "ir" || p.status === "questionable")
    .sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0))
    .slice(0, 2);
  for (const p of hurt) {
    actions.push({
      title: `Cover ${p.name}`,
      detail: `${STATUS_LABEL[p.status] ?? p.status} — line up a replacement`,
      href: "/waivers",
      cta: "Waivers",
      tone: "risk"
    });
  }

  // 2. Sell-high: market hype running ahead of value.
  const scored = market.map((p) => ({ p, hype: Math.round(p.trendingMomentum), edge: reputationEdge(p) }));
  const sell = scored.filter((x) => x.hype - x.edge > 15).sort((a, b) => b.hype - b.edge - (a.hype - a.edge))[0];
  if (sell) {
    actions.push({
      title: `Sell high: ${sell.p.name}`,
      detail: `hype +${sell.hype} vs edge ${sell.edge >= 0 ? "+" : ""}${sell.edge} — sell into the story`,
      href: "/trades",
      cta: "Trades",
      tone: "sell"
    });
  }

  // 3. Buy-low: value the market is sleeping on.
  const buy = scored.filter((x) => x.edge - x.hype > 5).sort((a, b) => b.edge - b.hype - (a.edge - a.hype))[0];
  if (buy) {
    actions.push({
      title: `Buy low: ${buy.p.name}`,
      detail: `edge +${buy.edge} the market hasn't caught up to`,
      href: "/trades",
      cta: "Trades",
      tone: "buy"
    });
  }

  // 4. Top market target (waiver/draft pool) by usage when available, else value.
  const anyUsage = market.some((p) => p.opportunity > 0);
  const target = [...market].sort((a, b) => (anyUsage ? b.opportunity - a.opportunity : b.trueValue - a.trueValue))[0];
  if (target) {
    const isPre = draftState === "pre";
    actions.push({
      title: `${isPre ? "Draft target" : "Top market"}: ${target.name}`,
      detail: anyUsage
        ? `${Math.round(target.opportunity)}% snap usage · value ${Math.round(target.trueValue)}`
        : `value ${Math.round(target.trueValue)} · edge ${reputationEdge(target) >= 0 ? "+" : ""}${reputationEdge(target)}`,
      href: isPre ? "/draft" : "/waivers",
      cta: isPre ? "Draft" : "Waivers",
      tone: isPre ? "draft" : "add"
    });
  }

  return (
    <PanelCard id="next-best-actions" titleId="nba-title" title="Next Best Actions" eyebrow="What to do next, from your data.">
      {actions.length === 0 ? (
        <p className="muted-note">No urgent moves right now — explore Players, Analytics, or Waivers.</p>
      ) : (
        <ul className="nba-list">
          {actions.map((a, i) => (
            <li key={i} className="nba-row" data-tone={a.tone}>
              <span className="nba-bar" aria-hidden="true" />
              <span className="nba-body">
                <span className="nba-title">{a.title}</span>
                <span className="nba-detail">{a.detail}</span>
              </span>
              <Link href={a.href} className="nba-cta">
                {a.cta} →
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="small-note">
        Derived from real injury status, Sleeper waiver-trend hype, and FantasyPros value — not fabricated.
      </p>
    </PanelCard>
  );
}
