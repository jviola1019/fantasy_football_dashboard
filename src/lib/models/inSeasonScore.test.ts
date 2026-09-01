import { describe, expect, it } from "vitest";
import { rankCohort, rankInSeason, OPPORTUNITY_WEIGHT, IN_SEASON_DISCLOSURE } from "./inSeasonScore";
import type { PlayerMarketRecord } from "@/lib/governance";

/**
 * The only model in this product with a POSITIVE out-of-sample result.
 *
 * That makes it the easiest one to overstate and the most damaging one to get
 * subtly wrong, because a refuted model that is disclosed as refuted harms
 * nobody, while a validated model shipped in an altered form is a claim the
 * evidence does not cover.
 *
 * `npm run verify:inseason` checks the end-to-end statistic against protocol
 * 5's archive. These tests pin the properties that make that reproduction
 * possible in the first place.
 */
const p = (id: string, pointsPerGame: number | null, touchesPerGame: number | null) => ({
  id,
  pointsPerGame,
  touchesPerGame
});

describe("the weight is protocol 5's, and is not a knob", () => {
  it("is exactly the fitted ratio", () => {
    // reports/2026-08-20/holdout-result-5.md: b_touches / b_points on the fit
    // set. If this drifts, the out-of-sample justification no longer applies to
    // whatever the code is doing.
    expect(OPPORTUNITY_WEIGHT).toBe(0.7613);
  });
});

describe("standardisation matches the validated harness", () => {
  it("uses the POPULATION sd, not the sample sd", () => {
    // Protocol 5 divides by n. Dividing by n-1 was the real defect the fidelity
    // check caught: within a cohort both denominators scale the score by the
    // same constant, so the local ordering is identical -- but the scores are
    // POOLED across cohorts of different sizes, and sqrt(n/(n-1)) differs per
    // cohort, which moves the pooled rank correlation.
    //
    // Values 0,1,2,3,4: mean 2, population sd = sqrt(2) ~ 1.41421,
    // sample sd = sqrt(2.5) ~ 1.58114. The top player's z distinguishes them.
    const ranked = rankCohort(
      [0, 1, 2, 3, 4].map((v, i) => p(`p${i}`, v, 0)),
      0
    );
    const top = ranked.find((r) => r.id === "p4")!;
    expect(top.zPoints).toBeCloseTo(2 / Math.sqrt(2), 10);
    expect(top.zPoints).not.toBeCloseTo(2 / Math.sqrt(2.5), 6);
  });

  it("splits by position before standardising", () => {
    // Standardising across positions would rank by position -- the exact error
    // pointsCurve exists to remove from rank-ratio VBD, and the one P2-3 caught
    // being reintroduced a layer down.
    const players = [
      ...[10, 12, 14, 16, 18].map((v, i) => ({ id: `rb${i}`, position: "RB", pointsPerGame: v, touchesPerGame: v })),
      ...[1, 2, 3, 4, 5].map((v, i) => ({ id: `te${i}`, position: "TE", pointsPerGame: v, touchesPerGame: v }))
    ] as unknown as Array<PlayerMarketRecord & { pointsPerGame: number; touchesPerGame: number }>;

    const ranked = rankInSeason(players);
    // The best TE scores exactly what the best RB scores, because each is
    // measured against its own cohort. Pooled standardisation would put every
    // RB above every TE.
    expect(ranked.get("te4")!.score).toBeCloseTo(ranked.get("rb4")!.score, 10);
  });
});

describe("it refuses to score what it cannot rank", () => {
  it("returns nothing for a cohort below the validated minimum of five", () => {
    expect(rankCohort([p("a", 10, 10), p("b", 8, 8), p("c", 6, 6), p("d", 4, 4)])).toEqual([]);
    expect(rankCohort([p("a", 10, 10), p("b", 8, 8), p("c", 6, 6), p("d", 4, 4), p("e", 2, 2)])).toHaveLength(5);
  });

  it("drops players missing EITHER input rather than scoring them partially", () => {
    // A player ranked on points alone, sitting in a list of players ranked on
    // points AND usage, is a different model for one row. Silent, and wrong in
    // the direction of whoever happens to be missing data.
    const ranked = rankCohort([
      p("full1", 10, 10),
      p("full2", 9, 9),
      p("full3", 8, 8),
      p("full4", 7, 7),
      p("full5", 6, 6),
      p("noTouches", 20, null),
      p("noPoints", null, 20)
    ]);
    const ids = ranked.map((r) => r.id);
    expect(ids).not.toContain("noTouches");
    expect(ids).not.toContain("noPoints");
    expect(ids).toHaveLength(5);
  });

  it("is inert on a cohort with no spread instead of inventing an ordering", () => {
    // Same rule as P2-4: a degenerate bucket must produce no ranking signal,
    // not an arbitrary one manufactured by a divide-by-zero.
    const ranked = rankCohort([1, 1, 1, 1, 1].map((v, i) => p(`p${i}`, v, v)));
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it("never emits NaN", () => {
    const ranked = rankCohort([
      p("a", 10, 0),
      p("b", 0, 10),
      p("c", 5, 5),
      p("d", 0, 0),
      p("e", 10, 10)
    ]);
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true);
  });
});

describe("usage changes the ranking, which is the whole point", () => {
  it("promotes the higher-usage player when points are tied", () => {
    const ranked = rankCohort([
      p("lowUsage", 10, 2),
      p("highUsage", 10, 20),
      p("mid1", 9, 10),
      p("mid2", 8, 10),
      p("mid3", 7, 10)
    ]);
    const byId = new Map(ranked.map((r) => [r.id, r]));
    expect(byId.get("highUsage")!.score).toBeGreaterThan(byId.get("lowUsage")!.score);
  });

  it("collapses to points-only at weight zero", () => {
    // The weight is the entire contribution of usage; at zero the ranking must
    // be exactly the points ranking, or the terms are wired wrong.
    const cohort = [p("a", 10, 1), p("b", 9, 20), p("c", 8, 3), p("d", 7, 15), p("e", 6, 2)];
    const zero = rankCohort(cohort, 0);
    for (const r of zero) expect(r.score).toBeCloseTo(r.zPoints, 12);
  });
});

describe("the disclosure ships with the claim", () => {
  it("states the measured magnitude, not just a verdict", () => {
    const text = [IN_SEASON_DISCLOSURE.body, ...IN_SEASON_DISCLOSURE.limits].join(" ");
    expect(text).toMatch(/0\.0137/);
    expect(text).toMatch(/0\.0195/);
  });

  it("states the in-season scope, so it cannot be read as a draft claim", () => {
    expect(IN_SEASON_DISCLOSURE.limits.join(" ")).toMatch(/in-season only/i);
  });

  it("refuses the word forecast and any probability framing", () => {
    const text = [IN_SEASON_DISCLOSURE.headline, IN_SEASON_DISCLOSURE.body].join(" ");
    expect(text).not.toMatch(/\bprobability\b/i);
    expect(IN_SEASON_DISCLOSURE.limits.join(" ")).toMatch(/ranking, not a forecast/i);
  });

  it("discloses that the magnitude did not generalise even though the direction did", () => {
    expect(IN_SEASON_DISCLOSURE.limits.join(" ")).toMatch(/1\.42/);
  });

  it("points at the evidence", () => {
    expect(IN_SEASON_DISCLOSURE.evidence).toMatch(/holdout-protocol-5/);
  });
});
