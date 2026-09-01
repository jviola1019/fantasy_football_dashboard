import { describe, expect, it } from "vitest";
import { FEATURE_NAMES, buildFeatures, projectionOnly, type WeeklyRow } from "./weeklyFeatures";

/**
 * Leakage is the only thing that can make protocol 7 produce a false positive.
 *
 * A feature that has seen the outcome it is predicting yields a model that looks
 * excellent and cannot be used, because at decision time week *w*'s results do
 * not exist. These tests attack that specifically: the surgical test is
 * `changing a week's OUTCOME must not change that week's FEATURES`, which no
 * amount of careful reading can establish and one assertion can.
 */
const row = (
  player_id: string,
  week: number,
  proj: number,
  actual: number,
  played = true
): WeeklyRow => ({ player_id, position: "WR", week, proj_pts_ppr: proj, actual_pts_ppr: actual, played });

const idx = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);

describe("the leakage rule", () => {
  it("changing a week's OUTCOME does not change that week's FEATURES", () => {
    // The decisive test. If any feature for week 3 moves when week 3's result
    // moves, that feature has seen the future.
    const base: WeeklyRow[] = [
      row("a", 1, 10, 12),
      row("a", 2, 11, 4),
      row("a", 3, 12, 20),
      row("b", 1, 9, 3),
      row("b", 2, 8, 14),
      row("b", 3, 7, 1)
    ];
    const altered = base.map((r) => (r.week === 3 ? { ...r, actual_pts_ppr: 999 - r.actual_pts_ppr } : r));

    const a = buildFeatures(base, 8);
    const b = buildFeatures(altered, 8);

    const week3A = a.X.filter((_, i) => a.fold[i] === 3);
    const week3B = b.X.filter((_, i) => b.fold[i] === 3);
    expect(week3B).toEqual(week3A);
  });

  it("changing an EARLIER week's outcome DOES change later features", () => {
    // The other direction. If this passed too, the history features would be
    // inert and the leakage test above would be vacuous.
    const base: WeeklyRow[] = [
      row("a", 1, 10, 12),
      row("a", 2, 11, 4),
      row("a", 3, 12, 20),
      row("b", 1, 9, 3),
      row("b", 2, 8, 14),
      row("b", 3, 7, 1)
    ];
    const altered = base.map((r) => (r.week === 1 ? { ...r, actual_pts_ppr: 0 } : r));

    const a = buildFeatures(base, 8);
    const b = buildFeatures(altered, 8);
    const w3 = (built: ReturnType<typeof buildFeatures>) =>
      built.X.filter((_, i) => built.fold[i] === 3);
    expect(w3(b)).not.toEqual(w3(a));
  });

  it("week 1 carries no player history at all", () => {
    const built = buildFeatures([row("a", 1, 10, 12), row("b", 1, 9, 3)], 8);
    for (const x of built.X) {
      expect(x[idx("prior_games")]).toBe(0);
      expect(x[idx("prior_dnp")]).toBe(0);
    }
  });

  it("history accumulates exactly one game per prior week", () => {
    const rows = [1, 2, 3, 4].map((w) => row("a", w, 10, 10 + w));
    const built = buildFeatures(rows, 8);
    expect(built.X.map((x) => x[idx("prior_games")])).toEqual([0, 1, 2, 3]);
  });
});

describe("history features compute what they say", () => {
  const rows = [
    row("a", 1, 10, 12), // error +2, hit (>=8)
    row("a", 2, 10, 4), //  error -6, miss
    row("a", 3, 10, 20) //  error +10, hit
  ];

  it("prior_mean_actual is the mean of strictly earlier weeks", () => {
    const built = buildFeatures(rows, 8);
    const week3 = built.X[2]!;
    expect(week3[idx("prior_mean_actual")]).toBeCloseTo((12 + 4) / 2, 10);
  });

  it("prior_mean_proj_error is actual minus projection, averaged over earlier weeks", () => {
    // The substantive hypothesis: a player who consistently beats his projection
    // should be treated differently from one who only has the projection.
    const built = buildFeatures(rows, 8);
    expect(built.X[2]![idx("prior_mean_proj_error")]).toBeCloseTo((2 + -6) / 2, 10);
  });

  it("prior_hit_rate counts threshold crossings, not points", () => {
    const built = buildFeatures(rows, 8);
    expect(built.X[2]![idx("prior_hit_rate")]).toBeCloseTo(0.5, 10); // 12 hit, 4 miss
  });

  it("prior_sd_actual uses the population denominator, matching inSeasonScore", () => {
    const built = buildFeatures(rows, 8);
    const m = (12 + 4) / 2;
    const expected = Math.sqrt(((12 - m) ** 2 + (4 - m) ** 2) / 2);
    expect(built.X[2]![idx("prior_sd_actual")]).toBeCloseTo(expected, 10);
  });

  it("counts DNPs separately from games", () => {
    const built = buildFeatures(
      [row("a", 1, 10, 0, false), row("a", 2, 10, 0, false), row("a", 3, 10, 12)],
      8
    );
    expect(built.X[2]![idx("prior_dnp")]).toBe(2);
    expect(built.X[2]![idx("prior_games")]).toBe(2);
  });
});

describe("same-week projection context is pre-game, so it is allowed", () => {
  it("ranks by projection within the week, 1 = highest", () => {
    const built = buildFeatures(
      [row("a", 1, 5, 0), row("b", 1, 20, 0), row("c", 1, 12, 0)],
      8
    );
    const ranks = built.rows.map((r, i) => [r.player_id, built.X[i]![idx("proj_rank_in_week")]]);
    expect(Object.fromEntries(ranks)).toEqual({ a: 3, b: 1, c: 2 });
  });

  it("z-scores the projection within the week", () => {
    const built = buildFeatures([row("a", 1, 0, 0), row("b", 1, 10, 0), row("c", 1, 20, 0)], 8);
    const zs = built.X.map((x) => x[idx("proj_z_in_week")]!);
    expect(zs[0]!).toBeLessThan(0);
    expect(zs[1]!).toBeCloseTo(0, 10);
    expect(zs[2]!).toBeGreaterThan(0);
  });

  it("is inert when every projection in a week is identical, rather than dividing by zero", () => {
    const built = buildFeatures([row("a", 1, 9, 0), row("b", 1, 9, 0)], 8);
    expect(built.X.every((x) => x[idx("proj_z_in_week")] === 0)).toBe(true);
  });
});

describe("shape and contracts", () => {
  it("emits one row per input, with matching fold and cluster keys", () => {
    const rows = [row("a", 1, 10, 12), row("b", 1, 9, 3), row("a", 2, 11, 4)];
    const built = buildFeatures(rows, 8);
    expect(built.X).toHaveLength(3);
    expect(built.y).toHaveLength(3);
    expect(built.fold).toEqual([1, 1, 2]);
    expect(built.cluster).toEqual(["a", "b", "a"]);
  });

  it("emits exactly the declared features, in the declared order", () => {
    // Protocol 7 §3 fixes the set at eleven. A twelfth appearing silently would
    // be a post-hoc feature addition, which §8 forbids.
    const built = buildFeatures([row("a", 1, 10, 12)], 8);
    expect(FEATURE_NAMES).toHaveLength(11);
    expect(built.X[0]).toHaveLength(FEATURE_NAMES.length);
  });

  it("labels by the threshold, inclusively", () => {
    const built = buildFeatures([row("a", 1, 10, 8), row("b", 1, 10, 7.99)], 8);
    expect(built.y).toEqual([1, 0]);
  });

  it("never emits a non-finite value", () => {
    // A NaN reaching a tree splits on comparisons that are all false and silently
    // routes every row one way.
    const built = buildFeatures(
      [row("a", 1, 0, 0), row("a", 2, 0, 0), row("b", 1, 0, 0)],
      8
    );
    for (const x of built.X) for (const v of x) expect(Number.isFinite(v)).toBe(true);
  });

  it("projectionOnly reproduces arm A's single feature from the same rows", () => {
    const rows = [row("a", 1, 10, 12), row("b", 2, 7, 3)];
    const built = buildFeatures(rows, 8);
    expect(projectionOnly(built)).toEqual([[10], [7]]);
  });

  it("processes weeks in ascending order regardless of input order", () => {
    const shuffled = [row("a", 3, 12, 20), row("a", 1, 10, 12), row("a", 2, 11, 4)];
    const built = buildFeatures(shuffled, 8);
    expect(built.fold).toEqual([1, 2, 3]);
    expect(built.X.map((x) => x[idx("prior_games")])).toEqual([0, 1, 2]);
  });
});
