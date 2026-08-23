"use client";

import Link from "next/link";
import type { PlayerMarketRecord } from "@/lib/governance";
import { deriveNextBestActions } from "@/lib/models/nextBestActions";
import { PanelCard } from "../ui/PanelCard";

/**
 * The overview's "what should I do next?" — concrete, source-backed actions
 * derived from REAL signals (injury status, hype-vs-value gap, usage/value),
 * each linking to the route where you act on it. Honest empty state when
 * nothing crosses a threshold; never fabricates an action.
 *
 * The derivation itself lives in `@/lib/models/nextBestActions` so the route
 * header can headline the SAME top action this panel lists first. Two copies of
 * a recommendation is how a product starts contradicting itself.
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
  const actions = deriveNextBestActions({ roster, market, draftState });

  return (
    <PanelCard
      id="next-best-actions"
      titleId="nba-title"
      title="Next Best Actions"
      eyebrow="What to do next, from your data."
    >
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
