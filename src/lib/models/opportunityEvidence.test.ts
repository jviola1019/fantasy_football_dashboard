import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_DETAIL,
  OPPORTUNITY_EVIDENCE,
  OPPORTUNITY_MECHANISM_CAVEAT,
  OPPORTUNITY_OUT_OF_FOLD_GAIN,
  OPPORTUNITY_SCOPE_LIMIT,
  OPPORTUNITY_SHORT,
  OPPORTUNITY_VALIDATION_LABEL,
  opportunityValidation
} from "./opportunityEvidence";

describe("opportunity evidence (protocol 4)", () => {
  it("quotes the confirmatory statistics as the harness emitted them", () => {
    expect(OPPORTUNITY_EVIDENCE.partialSpearman).toBe(0.2289);
    expect(OPPORTUNITY_EVIDENCE.partialSpearmanWithinPosition).toBe(0.2259);
    expect(OPPORTUNITY_EVIDENCE.concordanceAtMatchedProduction).toBe(0.5749);
    expect(OPPORTUNITY_EVIDENCE.playerSeasons).toBe(958);
    expect(OPPORTUNITY_EVIDENCE.distinctPlayers).toBe(452);
  });

  it("derives the out-of-fold gain rather than restating it, so the two cannot drift", () => {
    expect(OPPORTUNITY_OUT_OF_FOLD_GAIN).toBeCloseTo(
      OPPORTUNITY_EVIDENCE.withOpportunityOutOfFold - OPPORTUNITY_EVIDENCE.baselineOutOfFold,
      6
    );
    expect(OPPORTUNITY_OUT_OF_FOLD_GAIN).toBe(0.0137);
  });

  it("keeps the within-position estimate close to the pooled one, which is why the result stands", () => {
    // Protocol 3's retracted finding collapsed once position was held fixed.
    // If these two ever diverge materially, the disclosure is no longer accurate.
    const gap = Math.abs(
      OPPORTUNITY_EVIDENCE.partialSpearman - OPPORTUNITY_EVIDENCE.partialSpearmanWithinPosition
    );
    expect(gap).toBeLessThan(0.01);
  });

  it("states the practical gain in the user-facing copy instead of only the headline", () => {
    // A validated result is exactly where overstatement is easiest, so the
    // detail text must carry the real magnitude, not just the verdict.
    expect(OPPORTUNITY_DETAIL).toContain("0.734");
    expect(OPPORTUNITY_DETAIL).toContain("0.748");
    expect(OPPORTUNITY_DETAIL).toMatch(/small/i);
  });

  it("never claims the signal beats consensus at drafting", () => {
    const copy = [OPPORTUNITY_DETAIL, OPPORTUNITY_SHORT, OPPORTUNITY_SCOPE_LIMIT].join(" ");
    expect(OPPORTUNITY_SCOPE_LIMIT).toMatch(/in-season only/i);
    expect(copy).not.toMatch(/\barbitrage\b/i);
    expect(copy).not.toMatch(/\bmispriced?\b/i);
    expect(copy).not.toMatch(/\bguarantee/i);
  });

  it("discloses the mechanical component rather than implying hidden talent", () => {
    expect(OPPORTUNITY_MECHANISM_CAVEAT).toMatch(/mechanical/i);
    expect(OPPORTUNITY_MECHANISM_CAVEAT).toMatch(/reception/i);
  });

  it("distinguishes out-of-scope pre-season from validated in-season", () => {
    expect(opportunityValidation(true)).toBe("validated-in-season");
    expect(opportunityValidation(false)).toBe("out-of-scope-preseason");
    // The two must not collapse into one label: "no data" and "this question was
    // tested and the answer does not apply here" are different claims.
    expect(OPPORTUNITY_VALIDATION_LABEL["validated-in-season"]).not.toBe(
      OPPORTUNITY_VALIDATION_LABEL["out-of-scope-preseason"]
    );
  });

  it("points at the frozen protocol and the committed result", () => {
    expect(OPPORTUNITY_EVIDENCE.protocol).toBe("reports/2026-08-20/holdout-protocol-4.md");
    expect(OPPORTUNITY_EVIDENCE.result).toBe("reports/2026-08-20/holdout-result-4.md");
  });

  it("reports the p-value as a bootstrap upper bound, not an exact value", () => {
    // 1/(5000+1) rounded. Naming the field pValueUpperBound is the guard; this
    // pins the number so a later edit cannot quietly present it as exact.
    expect(OPPORTUNITY_EVIDENCE.pValueUpperBound).toBe(0.0002);
    expect(Object.keys(OPPORTUNITY_EVIDENCE)).not.toContain("pValue");
  });
});
