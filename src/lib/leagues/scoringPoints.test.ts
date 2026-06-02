import { describe, expect, it } from "vitest";
import { pickProjectionPoints } from "./scoringPoints";

const FULL = { pts_ppr: 14.2, pts_half_ppr: 12.7, pts_std: 11.3 };

describe("pickProjectionPoints", () => {
  it("selects the field matching the league scoring", () => {
    expect(pickProjectionPoints(FULL, "PPR")).toBe(14.2);
    expect(pickProjectionPoints(FULL, "HALF")).toBe(12.7);
    expect(pickProjectionPoints(FULL, "STD")).toBe(11.3);
  });

  it("orders PPR >= HALF >= STD for a pass-catcher (reception value)", () => {
    const ppr = pickProjectionPoints(FULL, "PPR")!;
    const half = pickProjectionPoints(FULL, "HALF")!;
    const std = pickProjectionPoints(FULL, "STD")!;
    expect(ppr).toBeGreaterThanOrEqual(half);
    expect(half).toBeGreaterThanOrEqual(std);
  });

  it("falls back to PPR when the specific field is null (kicker-style rows)", () => {
    const k = { pts_ppr: 7.0, pts_half_ppr: null, pts_std: 7.0 };
    expect(pickProjectionPoints(k, "HALF")).toBe(7.0); // half null → ppr
    expect(pickProjectionPoints(k, "STD")).toBe(7.0);
  });

  it("returns null when nothing is available", () => {
    const empty = { pts_ppr: null, pts_half_ppr: null, pts_std: null };
    expect(pickProjectionPoints(empty, "PPR")).toBeNull();
    expect(pickProjectionPoints(empty, "HALF")).toBeNull();
  });
});
