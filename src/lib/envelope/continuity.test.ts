import { describe, expect, it } from "vitest";
import { RAEEnvelopeSchema } from "@/lib/governance";
import { fixtureEnvelope } from "@/lib/fixtures";
import { deriveAppData } from "./derive";
import { deriveOutcomeDistribution, deriveScenarioComparison } from "@/lib/derivedMetrics";

/**
 * Cross-model continuity guards. Every panel derives from ONE
 * `deriveAppData(envelope)`, so the same number must read identically wherever
 * it appears: the Nexus "Multiverse" headline, the Nexus "Scenarios" baseline
 * column, the Reports "Season Outlook", and the Confidence Bands all trace to a
 * single seeded simulation. These tests fail loudly if a future change re-runs
 * an independent sim or diverges a value between panels.
 */

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp100 = (x: number) => Math.min(100, Math.max(0, x));

function envelope() {
  return RAEEnvelopeSchema.parse(fixtureEnvelope());
}

describe("model continuity", () => {
  it("deriveAppData is deterministic — the seeded sim + bootstrap bands reproduce exactly", () => {
    const a = deriveAppData(envelope());
    const b = deriveAppData(envelope());
    expect(b.sim.championshipProbability).toBe(a.sim.championshipProbability);
    expect(b.sim.playoffProbability).toBe(a.sim.playoffProbability);
    expect(b.sim.regretIndex).toBe(a.sim.regretIndex);
    expect(b.sim.distribution).toEqual(a.sim.distribution);
    expect(b.replicationRange).toEqual(a.replicationRange);
  });

  it("Scenarios 'Baseline' column == the headline sim probabilities (Multiverse / Reports)", () => {
    const d = deriveAppData(envelope());
    const scenarios = deriveScenarioComparison(d.players, d.sim);
    // simToRow(baseline, scale=1.0) is round1(clamp(sim.prob)) — so the Scenarios
    // tab baseline must equal what the Multiverse headline + Reports outlook show.
    expect(scenarios.baseline.championship).toBe(round1(clamp100(d.sim.championshipProbability)));
    expect(scenarios.baseline.playoffs).toBe(round1(clamp100(d.sim.playoffProbability)));
  });

  it("best/worst scenarios differ from baseline ONLY by risk scale (apples-to-apples league)", () => {
    const d = deriveAppData(envelope());
    const s = deriveScenarioComparison(d.players, d.sim);
    // champ ⊆ top3 ⊆ playoffs in every column, and best ≥ baseline ≥ worst on championship.
    for (const col of [s.bestCase, s.baseline, s.worstCase]) {
      expect(col.championship).toBeLessThanOrEqual(col.topThree + 1e-9);
      expect(col.topThree).toBeLessThanOrEqual(col.playoffs + 1e-9);
    }
    expect(s.bestCase.championship).toBeGreaterThanOrEqual(s.baseline.championship);
    expect(s.baseline.championship).toBeGreaterThanOrEqual(s.worstCase.championship);
  });

  it("the replication range brackets the number actually DISPLAYED, within [0,100]", () => {
    /**
     * This test used to read `ci.estimate` — a field `bootstrapCI` fills with
     * the mean of its own replicates. So it asserted that a bootstrap interval
     * contains its own bootstrap mean, which is true by construction and can
     * never fail. Meanwhile the number on screen came from a DIFFERENT run
     * (full iterations, single seed) and was never checked against the interval
     * printed beside it. On the fixture league it did not fit: the panel
     * rendered `Playoffs 69.6% [68.1 - 69.6]`, an estimate outside its own
     * interval. Audit 2026-08-22, P0-4 — reproduced by
     * `scripts/measure-scenario-bands.ts`.
     *
     * The assertion now names the displayed values explicitly, so it fails if
     * the two estimators are ever allowed to drift apart again.
     */
    const d = deriveAppData(envelope());
    expect(d.replicationRange).not.toBeNull();
    const range = d.replicationRange!;
    const pairs: Array<[number, typeof range.championship]> = [
      [d.sim.championshipProbability, range.championship],
      [d.sim.playoffProbability, range.playoff]
    ];
    for (const [displayed, ci] of pairs) {
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(100);
      expect(ci.lower).toBeLessThanOrEqual(displayed + 1e-9);
      expect(displayed).toBeLessThanOrEqual(ci.upper + 1e-9);
      // …and the interval must be centred on what is shown, not on a private mean.
      expect(ci.estimate).toBeCloseTo(displayed, 9);
    }
  });

  it("the replication range stays an order of magnitude below the model's measured error", () => {
    /**
     * The range is Monte-Carlo replication noise. The shipped chain's measured
     * out-of-sample calibration error is 16.13pp
     * (reports/2026-08-20/AUDIT-LEDGER.md). If the range ever grows to the same
     * order as that error, either the simulation has become unstable or someone
     * has started inflating the interval to stand in for model uncertainty —
     * which is exactly the multiplier behaviour removed in P0-4. Either way the
     * label "replication range" would have stopped being true.
     */
    const MEASURED_ECE_PP = 16.13;
    const d = deriveAppData(envelope());
    for (const ci of [d.replicationRange!.championship, d.replicationRange!.playoff]) {
      expect(ci.width).toBeLessThan(MEASURED_ECE_PP / 3);
    }
  });

  it("Outcome Multiverse buckets are non-negative and sum to 100 (no impossible probabilities)", () => {
    const d = deriveAppData(envelope());
    const o = deriveOutcomeDistribution(d.sim);
    const buckets = [o.championship, o.topThree, o.playoffs, o.middlePack, o.bottomThree];
    for (const v of buckets) expect(v).toBeGreaterThanOrEqual(0);
    expect(buckets.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
  });

  it("a player's trueValue is identical wherever it appears (no per-pool divergence)", () => {
    const d = deriveAppData(envelope());
    const byId = new Map(d.players.map((p) => [p.id, p.trueValue]));
    let shared = 0;
    for (const p of d.marketPool) {
      if (byId.has(p.id)) {
        shared++;
        expect(p.trueValue).toBe(byId.get(p.id));
      }
    }
    // The fixture roster overlaps the market pool, so the guard actually ran.
    expect(shared).toBeGreaterThan(0);
  });
});
