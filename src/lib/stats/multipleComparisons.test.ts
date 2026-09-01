import { describe, expect, it } from "vitest";
import { clusterBootstrap, holmBonferroni } from "./multipleComparisons";
import { mulberry32 } from "@/lib/rng";

describe("Holm–Bonferroni", () => {
  it("is more permissive than plain Bonferroni for the smallest p", () => {
    // The whole point of the step-down: the first test faces α/m, the same as
    // Bonferroni, but later ones face a progressively easier bar.
    const r = holmBonferroni([
      { id: "a", p: 0.001 },
      { id: "b", p: 0.02 },
      { id: "c", p: 0.04 }
    ]);
    expect(r[0]!.threshold).toBeCloseTo(0.05 / 3, 12);
    expect(r[1]!.threshold).toBeCloseTo(0.05 / 2, 12);
    expect(r[2]!.threshold).toBeCloseTo(0.05, 12);
  });

  it("STOPS at the first failure — everything after it is retained", () => {
    // Omitting the step-down and testing each p against its own threshold
    // independently inflates the family-wise error rate. Here c would pass
    // 0.04 <= 0.05 on its own, and must not.
    const r = holmBonferroni([
      { id: "a", p: 0.001 },
      { id: "b", p: 0.9 },
      { id: "c", p: 0.04 }
    ]);
    const byId = Object.fromEntries(r.map((x) => [x.id, x.reject]));
    expect(byId.a).toBe(true);
    expect(byId.b).toBe(false);
    expect(byId.c).toBe(false);
  });

  it("rejects nothing when the smallest p cannot clear α/m", () => {
    const r = holmBonferroni([
      { id: "a", p: 0.02 },
      { id: "b", p: 0.03 },
      { id: "c", p: 0.04 }
    ]);
    expect(r.every((x) => !x.reject)).toBe(true);
  });

  it("rejects everything when every p is tiny", () => {
    const r = holmBonferroni([
      { id: "a", p: 1e-6 },
      { id: "b", p: 1e-5 },
      { id: "c", p: 1e-4 }
    ]);
    expect(r.every((x) => x.reject)).toBe(true);
  });

  it("reduces to a plain α test for a single comparison", () => {
    expect(holmBonferroni([{ id: "a", p: 0.049 }])[0]!.reject).toBe(true);
    expect(holmBonferroni([{ id: "a", p: 0.051 }])[0]!.reject).toBe(false);
  });

  it("handles an empty family without throwing", () => {
    expect(holmBonferroni([])).toEqual([]);
  });

  it("honours a non-default alpha", () => {
    expect(holmBonferroni([{ id: "a", p: 0.009 }], 0.01)[0]!.reject).toBe(true);
    expect(holmBonferroni([{ id: "a", p: 0.011 }], 0.01)[0]!.reject).toBe(false);
  });
});

describe("cluster bootstrap", () => {
  it("returns the statistic on the full sample as the point estimate", () => {
    const clusters = ["a", "a", "b", "b"];
    const values = [1, 3, 5, 7];
    const r = clusterBootstrap(
      clusters,
      (idx) => idx.reduce((s, i) => s + values[i]!, 0) / idx.length,
      { resamples: 50, rand: mulberry32(1) }
    );
    expect(r.point).toBeCloseTo(4, 12);
  });

  it("gives a WIDER interval than a row bootstrap when rows are clustered", () => {
    // The reason this function exists. Two players, 20 identical rows each:
    // there are really two observations, not forty. A row bootstrap would see
    // forty and report near-certainty.
    const clusters: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      clusters.push("a");
      values.push(0);
    }
    for (let i = 0; i < 20; i += 1) {
      clusters.push("b");
      values.push(10);
    }
    const mean = (idx: readonly number[]) => idx.reduce((s, i) => s + values[i]!, 0) / idx.length;

    const byCluster = clusterBootstrap(clusters, mean, { resamples: 500, rand: mulberry32(7) });
    const byRow = clusterBootstrap(
      clusters.map((_, i) => String(i)), // every row its own cluster = row bootstrap
      mean,
      { resamples: 500, rand: mulberry32(7) }
    );
    const width = (r: { lower: number; upper: number }) => r.upper - r.lower;
    expect(width(byCluster)).toBeGreaterThan(width(byRow));
  });

  it("finds a real effect: an interval that excludes zero", () => {
    const clusters = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const values = clusters.map(() => 5);
    const r = clusterBootstrap(clusters, (idx) => idx.reduce((s, i) => s + values[i]!, 0) / idx.length, {
      resamples: 500,
      rand: mulberry32(3)
    });
    expect(r.lower).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(0.05);
  });

  it("finds no effect where there is none: an interval spanning zero", () => {
    const clusters = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const values = clusters.map((_, i) => (i % 2 === 0 ? 1 : -1));
    const r = clusterBootstrap(clusters, (idx) => idx.reduce((s, i) => s + values[i]!, 0) / idx.length, {
      resamples: 500,
      rand: mulberry32(4)
    });
    expect(r.lower).toBeLessThan(0);
    expect(r.upper).toBeGreaterThan(0);
    expect(r.p).toBeGreaterThan(0.05);
  });

  it("never reports p = 0, because B resamples cannot evidence it", () => {
    const clusters = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const r = clusterBootstrap(clusters, () => 42, { resamples: 100, rand: mulberry32(9) });
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeGreaterThanOrEqual(1 / 101);
  });

  it("is deterministic from its generator", () => {
    const clusters = ["a", "a", "b", "c", "c"];
    const values = [1, 2, 3, 4, 5];
    const stat = (idx: readonly number[]) => idx.reduce((s, i) => s + values[i]!, 0) / idx.length;
    const a = clusterBootstrap(clusters, stat, { resamples: 200, rand: mulberry32(20260825) });
    const b = clusterBootstrap(clusters, stat, { resamples: 200, rand: mulberry32(20260825) });
    expect(a).toEqual(b);
  });

  it("resamples whole clusters, so a draw contains all of a player's rows or none", () => {
    const clusters = ["a", "a", "a", "b"];
    const seen: number[][] = [];
    clusterBootstrap(
      clusters,
      (idx) => {
        seen.push([...idx]);
        return 0;
      },
      { resamples: 20, rand: mulberry32(2) }
    );
    // Skip the point-estimate call (all rows), then check the resamples.
    for (const draw of seen.slice(1)) {
      const aCount = draw.filter((i) => i < 3).length;
      expect(aCount % 3).toBe(0);
    }
  });
});
