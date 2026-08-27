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
  panelTitle: "Scarcity Gaps",
  /**
   * ─── The 2026-08-26 pass: "mispricing" outlived "mispriced" ──────────────
   *
   * The 2026-08-22 rename replaced "edge" and "arbitrage" everywhere and left
   * a whole second vocabulary standing, because both guards banned the exact
   * string `mispriced` and neither banned the stem. So three live surfaces went
   * on asserting the refuted claim while the tests written to forbid it passed:
   *
   *   - `MarketIntelligence` KPI sub  "Avg market mispricing index"  (/analytics)
   *   - `PlayerUniverse` stat box     "Avg Market Mispricing"        (/players)
   *   - `PlayerUniverse` stat box     "Undervalued"                  (/players)
   *
   * `e2e/20-model-failure-disclosure.spec.ts` even documents the intended rule
   * in prose -- "any assertion of arbitrage, mispricing or exploitable
   * inefficiency fails" -- while its regex read `mispriced`. The prose was
   * right and the pattern was narrower than the prose. Third failure of this
   * one guard: first a literal backspace byte made it vacuous, then it missed
   * the "Arbitrage" tab, now the noun form. Both guards are now stem-based.
   *
   * WHY THESE LABELS ARE WRONG, not merely off-brand. `valuationGap` is
   * |trueValue - perceivedValue| weighted by confidence. Protocol 3 D4 measured
   * that exact construction: `trueValue` alone correlates 0.0628 with beating
   * draft cost and `trueValue - perceivedValue` correlates 0.0579. Subtracting
   * the consensus makes it slightly WORSE. So a gap between the two values is
   * not evidence of mispricing, and "Undervalued" -- a bare count of
   * `trueValue > perceivedValue` -- asserts precisely the bargain-finding the
   * protocol failed to demonstrate.
   *
   * The quantity is real and worth showing. It is a dispersion measure: how far
   * our positional re-weighting sits from the consensus. That is what it is now
   * called.
   */
  /** was: "Market Inefficiency" (KPI tile, two panels). */
  gapMagnitude: "Valuation Gap",
  /** was: "Avg market mispricing index". */
  gapMagnitudeSub: "Mean distance from consensus, confidence-weighted",
  /** was: "TOP INEFFICIENCIES" (table heading). */
  topGapsTable: "LARGEST VALUATION GAPS",
  /** was: "Avg Market Mispricing" (Player Universe stat box). */
  avgGapStat: "Avg Valuation Gap",
  /** was: "Undervalued" -- a count of trueValue > perceivedValue. */
  aboveConsensus: "Value Above Consensus",

  /*
   * The remaining seven surfaces, found by widening the guard to the stem.
   * Directional wording is the subtle half: "Undervalued / Overvalued" asserts
   * the market is WRONG and by implication that we are right. "Above / below
   * consensus" states the same arithmetic and claims nothing protocol 3 refuted.
   */
  /** was: "Undervalued +N" (Top Insights row). */
  aboveShort: "Above consensus",
  /** was: "Overvalued -N" (Top Insights row). */
  belowShort: "Below consensus",
  /** was: "Biggest market mispricings." (Top Insights eyebrow, /dashboard). */
  insightsEyebrow: "Largest gaps from consensus.",
  /** was: "Undervalued (true > market)" (Price Discovery legend). */
  scatterLegendAbove: "Above consensus (value > market)",
  /** was: "Overvalued". */
  scatterLegendBelow: "Below consensus",
  /** was: "...points above the diagonal are undervalued". */
  scatterAria:
    "Scatter of RAE value versus market value; points above the diagonal are valued above consensus",
  /**
   * was: "fair value" on the y = x diagonal.
   *
   * The diagonal is where our value equals the market's. Labelling it "fair
   * value" asserts that OUR number is the fair one and every deviation is the
   * market's error -- the exact direction of claim protocol 3 could not
   * demonstrate. It is a parity line.
   */
  scatterParity: "parity (value = market)",
  /** was: "...distance from the dashed fair-value line = mispricing." */
  scatterNote: "Each dot is a player; distance from the dashed parity line is the gap from consensus.",
  /** was: "ranked by value mispricing only" (Narrative Engine, no-hype path). */
  narrativeFallback: "gap from consensus"
} as const;
