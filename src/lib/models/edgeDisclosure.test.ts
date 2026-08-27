import { describe, expect, it } from "vitest";
import {
  EDGE_DISCLOSURE_DETAIL,
  EDGE_DISCLOSURE_EVIDENCE,
  EDGE_DISCLOSURE_HEADLINE,
  EDGE_DISCLOSURE_SHORT,
  EDGE_LABELS
} from "./edgeDisclosure";

/**
 * Protocol 3 measured the reputation edge and it does not identify mispriced
 * players. These guard the wording so the refuted claim cannot come back — the
 * same protection `scenarioBand.test.ts` gives the season-simulation notice.
 */
describe("edge disclosure states what was measured", () => {
  it("headline names the honest mechanism, not an edge", () => {
    expect(EDGE_DISCLOSURE_HEADLINE.toLowerCase()).toContain("positional scarcity");
    expect(EDGE_DISCLOSURE_HEADLINE.toLowerCase()).toContain("not a market edge");
  });

  it("detail carries the decision-relevant finding, not a vague hedge", () => {
    // The within-position result is the one that matters: it is the choice a
    // draft board actually asks the user to make.
    expect(EDGE_DISCLOSURE_DETAIL).toContain("115 real drafts");
    expect(EDGE_DISCLOSURE_DETAIL).toMatch(/SAME position/);
    expect(EDGE_DISCLOSURE_DETAIL).toMatch(/worse than chance/);
    expect(EDGE_DISCLOSURE_DETAIL).toMatch(/not to find bargains/);
  });

  it("points at reproducible evidence rather than asserting", () => {
    expect(EDGE_DISCLOSURE_EVIDENCE).toContain("holdout-result-3.md");
  });
});

describe("no surface may re-assert the refuted claim", () => {
  const surfaces = [
    EDGE_DISCLOSURE_HEADLINE,
    EDGE_DISCLOSURE_DETAIL,
    EDGE_DISCLOSURE_SHORT,
    ...Object.values(EDGE_LABELS)
  ];

  // Protocol 3: across positions the signal is a roster-arithmetic artifact, and
  // within position it is INVERTED. Language implying exploitable mispricing is
  // therefore unsupported, whatever it is attached to.
  // STEMS, not whole words (2026-08-26). "mispriced" was banned while
  // "mispricing" shipped on three routes; matching the stem closes the family.
  const banned = [
    "arbitrage",
    "exploit inefficien",
    "mispric",
    "underval",
    "overval",
    "bargain",
    "market edge",
    "beat the market",
    "inefficiency detected"
  ];

  for (const text of surfaces) {
    it(`"${text.slice(0, 44)}..." makes no mispricing claim`, () => {
      const lower = text.toLowerCase();
      for (const phrase of banned) {
        // The disclosure itself is allowed to DENY the claim; it may not assert it.
        if (lower.includes(phrase)) {
          expect(
            /not|no longer|does not|did not|rather than/.test(lower),
            `"${phrase}" appears without a negation`
          ).toBe(true);
        }
      }
    });
  }

  it("the replacement labels dropped the arbitrage framing entirely", () => {
    expect(EDGE_LABELS.marketEyebrow.toLowerCase()).not.toContain("exploit");
    expect(EDGE_LABELS.largeGaps.toLowerCase()).not.toContain("arbitrage");
    expect(EDGE_LABELS.gapCountLabel.toLowerCase()).not.toContain("arbitrage");
    expect(EDGE_LABELS.column.toLowerCase()).not.toBe("edge");
  });

  it("the gap-count subtitle says explicitly these are not proven bargains", () => {
    expect(EDGE_LABELS.gapCountSub.toLowerCase()).toContain("not proven");
  });
});

describe("EDGE_LABELS after the 2026-08-22 rename", () => {
  it("contains no refuted vocabulary in any user-visible label", () => {
    // The product was renamed from "Reputation Arbitrage Engine" because
    // protocol 3 refuted the claim. These labels are the surfaces that carried
    // the same vocabulary, and a single-source guard is what stops it creeping
    // back one call site at a time — which is exactly how "Reputation Edge"
    // survived the first pass.
    // Stems again, and a negation escape hatch: `gapCountSub` has to be able to
    // say "not proven bargains", which denies the claim rather than making it.
    const banned = /(arbitrage|reputation|mispric|inefficienc|underval|overval|bargain)/i;
    const negated = /not |no longer|does not|did not|rather than/i;
    // The pattern must be live. Every alternative gets a canary, because a
    // regex that matches only its first branch is the failure this guard has
    // already suffered three times.
    for (const canary of [
      "arbitrage play",
      "Reputation Edge",
      "market mispricing",
      "TOP INEFFICIENCIES",
      "Undervalued",
      "Overvalued",
      "find bargains"
    ]) {
      expect(canary, `banned pattern must match ${canary}`).toMatch(banned);
    }
    for (const [key, value] of Object.entries(EDGE_LABELS)) {
      if (banned.test(value) && !negated.test(value)) {
        expect.fail(`EDGE_LABELS.${key} asserts refuted vocabulary: "${value}"`);
      }
    }
  });

  it("names the quantity consistently across every surface", () => {
    // A KPI tile, a panel title and a column header that disagree read as three
    // different metrics.
    expect(EDGE_LABELS.metricName.toLowerCase()).toContain("scarcity gap");
    expect(EDGE_LABELS.metricNameTitle.toLowerCase()).toContain("scarcity gap");
    expect(EDGE_LABELS.panelTitle.toLowerCase()).toContain("scarcity gap");
    expect(EDGE_LABELS.column.toLowerCase()).toContain("scarcity gap");
    expect(EDGE_LABELS.gapsTab.toLowerCase()).toContain("scarcity gap");
  });
});
