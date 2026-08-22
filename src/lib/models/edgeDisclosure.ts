/**
 * Disclosure for the reputation edge, after protocol 3 measured it.
 *
 * Audit 2026-08-21 §19/protocol 3. `scarcityGap` is the quantity this product
 * is named for, and until protocol 3 nothing had ever tested it. Tested on 115
 * MyFantasyLeague drafts — 21,714 player-season-league rows, 1,211 distinct
 * player-seasons, all inference clustered on player-season:
 *
 * | hypothesis | result |
 * |---|---|
 * | across positions, edge predicts beating draft cost | +0.058, significant |
 * | **within position, the same test** | **−0.048, significantly INVERTED** |
 * | concordance at matched draft cost, all pairs | 0.532 |
 * | concordance restricted to the SAME position | 0.510, near chance |
 *
 * The cross-position result is an artifact of roster arithmetic, not an
 * inefficiency. Kickers and defenses are drafted late but are few, so they score
 * a mechanically huge edge (45 and 39 versus ~3.4 for skill positions) and then
 * beat a position-blind draft-cost curve because they score steadily.
 * Quarterbacks refute it outright: the LOWEST mean edge of any position (−0.37)
 * and by far the HIGHEST outperformance (+1.16 sd).
 *
 * And the arbitrage step itself earns nothing — `trueValue` alone correlates
 * 0.0628 with beating draft cost, while `trueValue − perceivedValue` correlates
 * 0.0579. Subtracting the consensus rank makes it slightly worse.
 *
 * So the honest description is **positional scarcity**, not mispricing. A draft
 * board's job is within-position ordering, and that is exactly where the signal
 * is absent to inverted.
 *
 * Evidence: reports/2026-08-20/holdout-result-3.md
 * Protocol (frozen before scoring): reports/2026-08-20/holdout-protocol-3.md
 */

/** Headline shown wherever an edge-derived number is decision-facing. */
export const EDGE_DISCLOSURE_HEADLINE = "Positional scarcity — not a market edge";

export const EDGE_DISCLOSURE_DETAIL =
  "Tested on 115 real drafts, this score does not identify mispriced players. " +
  "Across positions it mostly reflects that kickers and defenses go late; among " +
  "players at the SAME position — the choice a draft board actually asks you to " +
  "make — it performed slightly worse than chance. Use it to think about " +
  "positional scarcity, not to find bargains.";

/** Compact form for a table caption or a narrow tile. */
export const EDGE_DISCLOSURE_SHORT =
  "Reflects positional scarcity, not mispricing. Within a position it did not beat chance.";

export const EDGE_DISCLOSURE_EVIDENCE = "reports/2026-08-20/holdout-result-3.md";

/**
 * Honest replacements for labels that asserted an inefficiency.
 *
 * Kept here rather than inline so the wording cannot drift between the panels
 * that share the claim — the same single-source-of-truth reasoning as
 * `scenarioBand.ts`.
 */
export const EDGE_LABELS = {
  /** was: "Find edges. Exploit inefficiencies." */
  marketEyebrow: "Positional scarcity and market context.",
  /** was: "ARBITRAGE PLAYS — |edge| >= 8" */
  largeGaps: "LARGEST SCARCITY GAPS — |gap| >= 8",
  /** was: "Arbitrage Opps" / "High-edge plays" */
  gapCountLabel: "Large Gaps",
  gapCountSub: "Scarcity gaps, not proven bargains",
  /** was: "Edge" */
  column: "Scarcity gap",
  /**
   * was: "Arbitrage" — a TAB on /analytics, and the last user-visible place the
   * refuted claim survived. It was missed when the other labels were replaced
   * because the wording guard that should have caught it was itself broken
   * (a literal backspace byte in its regex made it match nothing). Repairing
   * that guard surfaced this immediately.
   */
  gapsTab: "Scarcity Gaps",
  /**
   * was: "Reputation Edge" / "Reputation Edges" — a KPI label, a panel title, an
   * onboarding bullet and a tooltip. The 2026-08-21 pass replaced the COLUMN
   * header but left these, so the product went on naming the quantity after the
   * mechanism protocol 3 refuted. Renamed with the product on 2026-08-22.
   */
  metricName: "Scarcity gap",
  metricNameTitle: "Scarcity Gap",
  panelTitle: "Scarcity Gaps"
} as const;
