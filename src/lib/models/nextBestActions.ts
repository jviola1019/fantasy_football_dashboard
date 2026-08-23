import type { PlayerMarketRecord } from "@/lib/governance";
import { scarcityGap } from "@/lib/models";

export type ActionTone = "risk" | "sell" | "buy" | "add" | "draft";

export interface NextBestAction {
  /** Active voice — what happens, named the same way in the header and the panel. */
  title: string;
  /** The real signal that produced it, so the reader can audit the suggestion. */
  detail: string;
  href: string;
  /** Short destination label used by the in-panel row link. */
  cta: string;
  tone: ActionTone;
}

const STATUS_LABEL: Record<string, string> = {
  out: "Out",
  ir: "IR",
  questionable: "Questionable",
  bye: "Bye"
};
const STATUS_RANK: Record<string, number> = { out: 4, ir: 4, questionable: 2, bye: 1 };

/**
 * The "what should I do next?" derivation, in ONE place.
 *
 * This logic used to live inside `NextBestActionPanel`, which meant the only way
 * to show the top action anywhere else was to re-derive it — and two derivations
 * of the same recommendation is exactly how a product starts contradicting
 * itself. The panel and the route header now read the same ordered list, so the
 * headline action and the list can never disagree.
 *
 * Ordering is severity-first and is deliberate, not incidental: an unavailable
 * starter costs points this week, a market edge costs points eventually.
 *
 * Every entry is derived from a REAL field — `status` (injury feed),
 * `trendingMomentum` (Sleeper adds/drops), `trueValue`/`opportunity`
 * (FantasyPros ECR / nflverse snap share). When nothing crosses a threshold the
 * list is EMPTY; it never pads itself to look busy.
 */
export function deriveNextBestActions({
  roster,
  market,
  draftState
}: {
  roster: PlayerMarketRecord[];
  market: PlayerMarketRecord[];
  draftState?: "pre" | "post" | "unknown" | null;
}): NextBestAction[] {
  const actions: NextBestAction[] = [];

  // 1. Availability risk on your own roster (real `status` from the injury feed).
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
  const scored = market.map((p) => ({ p, hype: Math.round(p.trendingMomentum), edge: scarcityGap(p) }));
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
        : `value ${Math.round(target.trueValue)} · edge ${scarcityGap(target) >= 0 ? "+" : ""}${scarcityGap(target)}`,
      href: isPre ? "/draft" : "/waivers",
      cta: isPre ? "Draft" : "Waivers",
      tone: isPre ? "draft" : "add"
    });
  }

  return actions;
}
