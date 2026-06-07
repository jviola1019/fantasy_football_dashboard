import { describe, expect, it } from "vitest";
import { fixturePlayers } from "./fixtures";
import {
  deriveCommandMetrics,
  deriveMarketMetrics,
  deriveNarrativeMovers,
  derivePositionGrades,
  deriveScenarioComparison,
  deriveOutcomeDistribution,
  deriveStartSitEdge,
  deriveRisingStars,
  deriveStoryCollisions,
  deriveNarrativeHalfLife,
  deriveViralVelocity,
  chaosScore
} from "./derivedMetrics";
import { runNexusSimulation } from "./simulation";
import { reputationEdge, marketInefficiency, narrativeVelocity, chaosExposure, liquidityScore } from "./models";
import type { PlayerMarketRecord } from "./governance";

const sim = runNexusSimulation(fixturePlayers, {
  seed: 20260513,
  iterations: 2500,
  rosterSlots: 6,
  riskTolerance: 0.58
});

/**
 * Statistical property tests for every metric the dashboard displays.
 * Each metric must satisfy:
 *  (1) determinism — same input → same output
 *  (2) range bounds — output stays within the documented box
 *  (3) sensitivity — flipping the dominant input changes the output in the
 *      expected direction
 *
 * These tests describe the metric's behavior; they do not redefine the formula.
 */
describe("derivedMetrics — statistical properties", () => {
  describe("per-player formulas", () => {
    it("reputationEdge: determinism + bounded", () => {
      for (const p of fixturePlayers) {
        const a = reputationEdge(p);
        const b = reputationEdge(p);
        expect(a).toBe(b);
        // Formula: trueValue - perceivedValue + ownLev*0.18 - frag*0.08
        // Inputs are 0..100 (or ±100 for ownership), so bound is wide but finite.
        expect(Number.isFinite(a)).toBe(true);
        expect(Math.abs(a)).toBeLessThan(200);
      }
    });

    it("reputationEdge: monotonic in trueValue (sensitivity)", () => {
      const p = fixturePlayers[0]!;
      const before = reputationEdge(p);
      const after = reputationEdge({ ...p, trueValue: p.trueValue + 10 });
      expect(after).toBeGreaterThan(before);
    });

    it("marketInefficiency: non-negative", () => {
      for (const p of fixturePlayers) {
        expect(marketInefficiency(p)).toBeGreaterThanOrEqual(0);
      }
    });

    it("narrativeVelocity: monotonic in trendingMomentum", () => {
      const p = fixturePlayers[0]!;
      const lo = narrativeVelocity({ ...p, trendingMomentum: -50 });
      const hi = narrativeVelocity({ ...p, trendingMomentum: 50 });
      expect(hi).toBeGreaterThan(lo);
    });

    it("chaosExposure: non-negative and monotonic in volatility", () => {
      const p = fixturePlayers[0]!;
      const calm = chaosExposure({ ...p, volatility: 10 });
      const wild = chaosExposure({ ...p, volatility: 90 });
      expect(calm).toBeGreaterThanOrEqual(0);
      expect(wild).toBeGreaterThan(calm);
    });

    it("liquidityScore: non-negative", () => {
      for (const p of fixturePlayers) {
        expect(liquidityScore(p)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("aggregate metrics", () => {
    it("deriveCommandMetrics: deterministic, leagueAdvantage in [0,100]", () => {
      const a = deriveCommandMetrics(fixturePlayers);
      const b = deriveCommandMetrics(fixturePlayers);
      expect(a).toEqual(b);
      expect(a.leagueAdvantage).toBeGreaterThanOrEqual(0);
      expect(a.leagueAdvantage).toBeLessThanOrEqual(100);
    });

    it("deriveCommandMetrics: leagueAdvantage rises when every player's trueValue goes up", () => {
      const lifted = fixturePlayers.map((p) => ({ ...p, trueValue: Math.min(100, p.trueValue + 8) }));
      const base = deriveCommandMetrics(fixturePlayers);
      const up = deriveCommandMetrics(lifted);
      expect(up.leagueAdvantage).toBeGreaterThanOrEqual(base.leagueAdvantage);
      expect(up.reputationEdge).toBeGreaterThan(base.reputationEdge);
    });

    it("deriveMarketMetrics: arbitrageCount in [0, n]", () => {
      const m = deriveMarketMetrics(fixturePlayers);
      expect(m.arbitrageCount).toBeGreaterThanOrEqual(0);
      expect(m.arbitrageCount).toBeLessThanOrEqual(fixturePlayers.length);
      expect(["Inefficient", "Efficient"]).toContain(m.marketRegime);
    });

    it("deriveMarketMetrics: topInefficiencies returns at most 5 players, all from input", () => {
      const m = deriveMarketMetrics(fixturePlayers);
      const inputIds = new Set(fixturePlayers.map((p) => p.id));
      expect(m.topInefficiencies.length).toBeLessThanOrEqual(5);
      for (const p of m.topInefficiencies) expect(inputIds.has(p.id)).toBe(true);
    });

    it("deriveNarrativeMovers: gainers all have velocity > 0, decliners < 0", () => {
      const { gainers, decliners } = deriveNarrativeMovers(fixturePlayers);
      for (const p of gainers) expect(narrativeVelocity(p)).toBeGreaterThan(0);
      for (const p of decliners) expect(narrativeVelocity(p)).toBeLessThan(0);
    });

    it("deriveScenarioComparison: ordering — best ≥ baseline ≥ worst on championship", () => {
      const s = deriveScenarioComparison(fixturePlayers, sim);
      expect(s.bestCase.championship).toBeGreaterThanOrEqual(s.baseline.championship);
      expect(s.baseline.championship).toBeGreaterThanOrEqual(s.worstCase.championship);
    });

    it("deriveScenarioComparison: finalRank is in [1, 12] for all three scenarios", () => {
      const s = deriveScenarioComparison(fixturePlayers, sim);
      for (const row of [s.bestCase, s.baseline, s.worstCase]) {
        expect(row.finalRank).toBeGreaterThanOrEqual(1);
        expect(row.finalRank).toBeLessThanOrEqual(12);
      }
    });

    it("deriveScenarioComparison: points are realistic season totals anchored to the weekly model", () => {
      const s = deriveScenarioComparison(fixturePlayers, sim);
      for (const row of [s.bestCase, s.baseline, s.worstCase]) {
        // A fantasy team scores roughly 60–160 pts/week over ~14 weeks ⇒ a
        // believable season band. (The old sum(trueValue)*16 produced ~10k+.)
        expect(row.pointsFor).toBeGreaterThan(400);
        expect(row.pointsFor).toBeLessThan(3000);
        expect(row.pointsAgainst).toBeGreaterThan(400);
        expect(row.pointsAgainst).toBeLessThan(3000);
      }
      // Points-for tracks the best→worst scale; points-against is the league
      // average (you face an average schedule) so it stays constant.
      expect(s.bestCase.pointsFor).toBeGreaterThan(s.worstCase.pointsFor);
      expect(s.bestCase.pointsAgainst).toBe(s.baseline.pointsAgainst);
    });

    it("deriveScenarioComparison: best/worst inherit the baseline's league format, not a default", () => {
      // An 8-team league is far easier to WIN than a 16-team league. Best/worst now
      // run on the baseline's REAL format, so best-case championship odds must differ
      // between the two. (Under the old hardcoded BASE_PARAMS, both scenarios used a
      // default 12-team league and these were identical regardless of the baseline.)
      const smallFmt = { seed: 20260513, iterations: 1500, rosterSlots: 6, riskTolerance: 0.58, numTeams: 8, playoffTeams: 4, regularSeasonWeeks: 13 };
      const largeFmt = { seed: 20260513, iterations: 1500, rosterSlots: 6, riskTolerance: 0.58, numTeams: 16, playoffTeams: 4, regularSeasonWeeks: 13 };
      const small = deriveScenarioComparison(fixturePlayers, runNexusSimulation(fixturePlayers, smallFmt));
      const large = deriveScenarioComparison(fixturePlayers, runNexusSimulation(fixturePlayers, largeFmt));
      expect(small.bestCase.championship).toBeGreaterThan(large.bestCase.championship);
    });

    it("derivePositionGrades: every position emits a grade letter", () => {
      const g = derivePositionGrades(fixturePlayers);
      const valid = /^[ABCD][+-]?$/;
      expect(valid.test(g.overall)).toBe(true);
      for (const row of g.positions) expect(valid.test(row.grade)).toBe(true);
    });

    it("deriveStartSitEdge: edge = proj - repl is finite and consistent", () => {
      const rows = deriveStartSitEdge(fixturePlayers);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        // The function ranks by reputationEdge (which can favor a player even
        // when their trueValue is lower than the same-position best), so edge
        // can legitimately be negative. We only assert the value is consistent.
        expect(Number.isFinite(r.proj)).toBe(true);
        expect(Number.isFinite(r.repl)).toBe(true);
        expect(Number.isFinite(r.edge)).toBe(true);
        expect(Math.abs(r.edge - (r.proj - r.repl))).toBeLessThanOrEqual(0.1);
      }
    });

    it("deriveRisingStars: returns at most 5 players, sorted by velocity desc", () => {
      const stars = deriveRisingStars(fixturePlayers);
      expect(stars.length).toBeLessThanOrEqual(5);
      for (let i = 0; i < stars.length - 1; i++) {
        expect(narrativeVelocity(stars[i]!)).toBeGreaterThanOrEqual(narrativeVelocity(stars[i + 1]!));
      }
    });

    it("deriveStoryCollisions: impact label is one of {Low, Medium, High}", () => {
      const collisions = deriveStoryCollisions(fixturePlayers);
      for (const c of collisions) expect(["Low", "Medium", "High"]).toContain(c.impact);
    });

    it("deriveNarrativeHalfLife: positive number of days", () => {
      const hl = deriveNarrativeHalfLife(fixturePlayers);
      expect(hl).toBeGreaterThanOrEqual(2);
    });

    it("deriveViralVelocity: emits one of the documented labels", () => {
      expect(["High", "Medium", "Low", "Unknown"]).toContain(deriveViralVelocity(fixturePlayers));
    });

    it("chaosScore: matches the per-player chaosExposure average", () => {
      const expected =
        fixturePlayers.reduce((s, p) => s + chaosExposure(p), 0) / fixturePlayers.length;
      expect(chaosScore(fixturePlayers)).toBeCloseTo(Math.round(expected * 10) / 10, 6);
    });

    it("empty input: aggregate metrics do not throw", () => {
      const empty: PlayerMarketRecord[] = [];
      expect(() => deriveCommandMetrics(empty)).not.toThrow();
      expect(() => deriveMarketMetrics(empty)).not.toThrow();
      expect(() => derivePositionGrades(empty)).not.toThrow();
      expect(() => deriveStartSitEdge(empty)).not.toThrow();
    });
  });

  describe("outcome percentages are always valid", () => {
    it("scenario rows: each tier in [0,100] and championship ≤ topThree ≤ playoffs", () => {
      const s = deriveScenarioComparison(fixturePlayers, sim);
      for (const row of [s.bestCase, s.baseline, s.worstCase]) {
        for (const v of [row.championship, row.topThree, row.playoffs]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        // The only logically possible ordering: winning ⊆ top-3 ⊆ playoffs.
        expect(row.championship).toBeLessThanOrEqual(row.topThree + 1e-6);
        expect(row.topThree).toBeLessThanOrEqual(row.playoffs + 1e-6);
      }
    });

    it("deriveOutcomeDistribution: five buckets, each ≥ 0, summing to ~100", () => {
      const dist = deriveOutcomeDistribution(sim);
      const buckets = [
        dist.championship,
        dist.topThree,
        dist.playoffs,
        dist.middlePack,
        dist.bottomThree
      ];
      for (const b of buckets) {
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(100);
      }
      const sum = buckets.reduce((a, b) => a + b, 0);
      // Rounding each bucket to one decimal can drift the total a touch.
      expect(sum).toBeGreaterThan(99);
      expect(sum).toBeLessThan(101);
    });

    it("deriveOutcomeDistribution: holds for adversarial simulation outputs", () => {
      // Hand-built results that would break naive bucket math (champ+risk > 100,
      // playoff < champ). The partition must still be valid.
      const adversarial = [
        { ...sim, championshipProbability: 95, playoffProbability: 30, catastrophicRisk: 80 },
        { ...sim, championshipProbability: 0, playoffProbability: 0, catastrophicRisk: 0 },
        { ...sim, championshipProbability: 100, playoffProbability: 100, catastrophicRisk: 100 }
      ];
      for (const s of adversarial) {
        const dist = deriveOutcomeDistribution(s);
        const buckets = [
          dist.championship,
          dist.topThree,
          dist.playoffs,
          dist.middlePack,
          dist.bottomThree
        ];
        for (const b of buckets) expect(b).toBeGreaterThanOrEqual(0);
        const sum = buckets.reduce((a, b) => a + b, 0);
        expect(sum).toBeGreaterThan(99);
        expect(sum).toBeLessThan(101);
      }
    });
  });
});
