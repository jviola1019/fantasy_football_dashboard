import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRAFT_HEURISTIC_WEIGHTS,
  DRAFT_RECOMMENDATION_NOTE,
  DRAFT_TIER_NOTE
} from "./disclosure";

/**
 * A disclosure that quotes numbers has to be held to them.
 *
 * The failure this guards against is specific and has happened elsewhere in this
 * repository: a label describes an implementation, the implementation changes,
 * and the label goes on describing the old one. `LeagueHealth`'s sub-label once
 * said "value over replacement" for a quantity that was a confidence-weighted
 * absolute gap — factually wrong, and nothing caught it.
 *
 * So the weights the notes quote are asserted against the source of the
 * functions that use them. Change `edge * 1.5` in `recommend.ts` without
 * changing the disclosure and this fails.
 */

const HERE = __dirname;
const recommendSrc = readFileSync(join(HERE, "recommend.ts"), "utf8");
const tiersSrc = readFileSync(join(HERE, "tiers.ts"), "utf8");

describe("draft heuristic disclosure", () => {
  it("quotes the scoring weights that recommend.ts actually uses", () => {
    expect(recommendSrc).toContain(`edge * ${DRAFT_HEURISTIC_WEIGHTS.edge}`);
    expect(recommendSrc).toContain(`opportunity * ${DRAFT_HEURISTIC_WEIGHTS.opportunity}`);
    expect(recommendSrc).toContain(`player.fragility * ${DRAFT_HEURISTIC_WEIGHTS.fragility}`);
  });

  it("quotes the tier thresholds that tiers.ts actually uses", () => {
    expect(tiersSrc).toContain(`TIER_GAP_THRESHOLD = ${DRAFT_HEURISTIC_WEIGHTS.tierGapThreshold}`);
    expect(tiersSrc).toContain(`t.cliff / ${DRAFT_HEURISTIC_WEIGHTS.intensityCap}`);
  });

  it("states plainly that the weights are not fitted", () => {
    // The point of the disclosure is this sentence, not the arithmetic.
    for (const note of [DRAFT_RECOMMENDATION_NOTE, DRAFT_TIER_NOTE]) {
      expect(note.toLowerCase()).toMatch(/not fitted|authored/);
    }
    expect(DRAFT_RECOMMENDATION_NOTE.toLowerCase()).toContain("heuristic");
  });

  it("makes no claim the draft scoring has been validated", () => {
    // Same ban the model-failure guards apply elsewhere: nothing here has been
    // through a holdout protocol, so nothing here may borrow that vocabulary.
    const banned = /(validated|calibrated|proven|beats the market|optimal)/i;
    for (const note of [DRAFT_RECOMMENDATION_NOTE, DRAFT_TIER_NOTE]) {
      expect(note, `disclosure overclaims: "${note}"`).not.toMatch(banned);
    }
    // Canary: the pattern must be live.
    expect("a validated model").toMatch(banned);
  });
});
