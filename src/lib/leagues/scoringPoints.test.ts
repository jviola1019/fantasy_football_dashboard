import { describe, expect, it } from "vitest";
import {
  selectProjectionForFormat,
  RECEPTION_NEUTRAL_POSITIONS,
  type WeeklyProjectionByFormat
} from "./scoringPoints";

const passCatcher = (over: Partial<WeeklyProjectionByFormat> = {}): WeeklyProjectionByFormat => ({
  ppr: 14.2,
  halfPpr: 12.7,
  standard: 11.3,
  position: "WR",
  ...over
});

describe("selectProjectionForFormat", () => {
  it("selects the field matching the league scoring, and reports which field", () => {
    const p = passCatcher();
    expect(selectProjectionForFormat(p, "PPR")).toEqual({
      points: 14.2,
      field: "pts_ppr",
      substituted: false
    });
    expect(selectProjectionForFormat(p, "HALF")).toEqual({
      points: 12.7,
      field: "pts_half_ppr",
      substituted: false
    });
    expect(selectProjectionForFormat(p, "STD")).toEqual({
      points: 11.3,
      field: "pts_std",
      substituted: false
    });
  });

  it("orders PPR >= HALF >= STD for a pass-catcher (reception value)", () => {
    const p = passCatcher();
    const ppr = selectProjectionForFormat(p, "PPR")!.points;
    const half = selectProjectionForFormat(p, "HALF")!.points;
    const std = selectProjectionForFormat(p, "STD")!.points;
    expect(ppr).toBeGreaterThanOrEqual(half);
    expect(half).toBeGreaterThanOrEqual(std);
  });

  // The behavior this replaces. The old `pickProjectionPoints` fell back to
  // pts_ppr for ANY position, so a standard-scoring league silently scored a WR
  // in PPR points against a 9.5-point standard field.
  describe("never substitutes across formats for a reception-scoring position", () => {
    for (const position of ["RB", "WR", "TE"]) {
      it(`${position}: a missing same-unit field yields null, not a PPR number`, () => {
        const p = passCatcher({ position, standard: null, halfPpr: null });
        expect(selectProjectionForFormat(p, "STD")).toBeNull();
        expect(selectProjectionForFormat(p, "HALF")).toBeNull();
        // The PPR value is still there and still selectable in a PPR league.
        expect(selectProjectionForFormat(p, "PPR")!.points).toBe(14.2);
      });
    }

    it("treats an unknown position as reception-scoring (conservative)", () => {
      const p = passCatcher({ position: null, standard: null });
      expect(selectProjectionForFormat(p, "STD")).toBeNull();
      const q = passCatcher({ position: "FLEX", standard: null });
      expect(selectProjectionForFormat(q, "STD")).toBeNull();
    });
  });

  describe("substitutes only where the three formats are provably identical", () => {
    for (const position of RECEPTION_NEUTRAL_POSITIONS) {
      it(`${position}: a missing same-unit field falls back and is flagged substituted`, () => {
        const p: WeeklyProjectionByFormat = {
          ppr: 7,
          halfPpr: null,
          standard: 7,
          position
        };
        const half = selectProjectionForFormat(p, "HALF")!;
        expect(half.points).toBe(7);
        expect(half.substituted).toBe(true);
        expect(half.field).toBe("pts_ppr");
        // Exact hit is never marked substituted.
        expect(selectProjectionForFormat(p, "STD")).toEqual({
          points: 7,
          field: "pts_std",
          substituted: false
        });
      });
    }
  });

  it("returns null when nothing is available, in every format", () => {
    const empty: WeeklyProjectionByFormat = {
      ppr: null,
      halfPpr: null,
      standard: null,
      position: "QB"
    };
    expect(selectProjectionForFormat(empty, "PPR")).toBeNull();
    expect(selectProjectionForFormat(empty, "HALF")).toBeNull();
    expect(selectProjectionForFormat(empty, "STD")).toBeNull();
  });

  it("keeps a legitimate zero rather than treating it as absent", () => {
    const p: WeeklyProjectionByFormat = {
      ppr: 0,
      halfPpr: 0,
      standard: 0,
      position: "K"
    };
    expect(selectProjectionForFormat(p, "STD")).toEqual({
      points: 0,
      field: "pts_std",
      substituted: false
    });
  });
});
