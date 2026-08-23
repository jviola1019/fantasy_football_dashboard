import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLACEMENT_MODEL,
  allocateWhole,
  averageStartableTrueValue,
  flexWeights,
  perTeamDemand,
  startingSlotCount
} from "./lineupDemand";
import { positionReplacementRank } from "../fantasypros/enrich";
import { targetsFromFormat } from "../draft/rosterTargets";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueStarters } from "../trade/format";

/**
 * One lineup model, two consumers.
 *
 * The flex-weight table was a literal in both `draft/rosterTargets.ts` and
 * `fantasypros/enrich.ts`, and enrich.ts even carried the comment "using the
 * same weighting as the draft targets so the two models cannot disagree". Being
 * a copy, they could — and did: rosterTargets hardcoded `QB += SUPERFLEX`
 * (occupancy 1.0) while enrich had an injectable coefficient. The draft board
 * and the valuation model gave different answers about the same league.
 *
 * These tests pin the SHARED behaviour, and the last describe block asserts the
 * two consumers actually move together, which a shared comment never could.
 */

const st = (o: Partial<LeagueStarters> = {}): LeagueStarters => ({
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  DEF: 1,
  K: 1,
  SUPERFLEX: 0,
  ...o
});

const fmt = (o: Partial<LeagueFormat> = {}): LeagueFormat => ({
  ...DEFAULT_FORMAT,
  starters: st(),
  ...o
});

describe("flex weights", () => {
  it("gives WR the odd slot in PPR and RB in standard", () => {
    expect(flexWeights(fmt({ ppr: 1 })).WR).toBeGreaterThan(flexWeights(fmt({ ppr: 1 })).RB!);
    expect(flexWeights(fmt({ ppr: 0 })).WR).toBe(flexWeights(fmt({ ppr: 0 })).RB);
  });

  it("only lets TE compete for the flex in a TE-premium (2TE) league", () => {
    expect(flexWeights(fmt()).TE).toBeUndefined();
    expect(flexWeights(fmt({ starters: st({ TE: 2 }) })).TE).toBe(2);
  });
});

describe("per-team demand", () => {
  it("conserves total demand — the flex is distributed, never created", () => {
    const f = fmt({ starters: st({ FLEX: 2 }) });
    const total = Object.values(perTeamDemand(f)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(startingSlotCount(f), 6);
  });

  it("conserves total demand at EVERY superflex occupancy", () => {
    // The property that makes the coefficient safe to move: lowering it must
    // shift demand onto the flex, not delete it from the league.
    const f = fmt({ starters: st({ SUPERFLEX: 1 }), numQbs: 2 });
    const slots = startingSlotCount(f);
    for (const superflexQbOccupancy of [0, 0.5, 0.8, 1]) {
      const total = Object.values(
        perTeamDemand(f, { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy })
      ).reduce((a, b) => a + b, 0);
      expect(total, `occupancy ${superflexQbOccupancy}`).toBeCloseTo(slots, 6);
    }
  });

  it("moves QB demand down and flex demand up as occupancy falls", () => {
    const f = fmt({ starters: st({ SUPERFLEX: 1 }), numQbs: 2 });
    const full = perTeamDemand(f, { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy: 1 });
    const partial = perTeamDemand(f, { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy: 0.8 });
    expect(partial.QB).toBeLessThan(full.QB);
    expect(partial.RB + partial.WR).toBeGreaterThan(full.RB + full.WR);
  });

  it("leaves K and DEF untouched by flex allocation", () => {
    const d = perTeamDemand(fmt({ starters: st({ FLEX: 3 }) }));
    expect(d.K).toBe(1);
    expect(d.DEF).toBe(1);
  });
});

describe("whole-unit allocation", () => {
  it("sums exactly to the total, with no float drift", () => {
    for (const total of [0, 1, 2, 3, 7]) {
      const alloc = allocateWhole(total, { RB: 4, WR: 5, TE: 2 });
      expect(Object.values(alloc).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("is deterministic when weights tie", () => {
    const a = allocateWhole(1, { RB: 4, WR: 4 });
    const b = allocateWhole(1, { RB: 4, WR: 4 });
    expect(a).toEqual(b);
  });

  it("returns all zeros for zero or negative totals", () => {
    expect(Object.values(allocateWhole(0, { RB: 1 })).every((v) => v === 0)).toBe(true);
    expect(Object.values(allocateWhole(-3, { RB: 1 })).every((v) => v === 0)).toBe(true);
  });
});

describe("the average-startable anchor", () => {
  it("depends only on the depth cushion", () => {
    expect(averageStartableTrueValue({ depthCushion: 1.2, superflexQbOccupancy: 1 })).toBeCloseTo(79.17, 1);
    expect(averageStartableTrueValue({ depthCushion: 1.2, superflexQbOccupancy: 0.5 })).toBeCloseTo(79.17, 1);
  });

  it("rises with the cushion and always sits above replacement", () => {
    const low = averageStartableTrueValue({ depthCushion: 1.0, superflexQbOccupancy: 1 });
    const high = averageStartableTrueValue({ depthCushion: 1.4, superflexQbOccupancy: 1 });
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(50);
  });
});

describe("the draft board and the valuation model cannot drift apart", () => {
  // The regression that motivated this module. Before it, rosterTargets pinned
  // superflex occupancy at 1.0 while enrich honoured the coefficient, so these
  // two consumers disagreed about the same league.
  const superflex = fmt({ starters: st({ SUPERFLEX: 1 }), numQbs: 2, numTeams: 12 });

  it("both react to superflex occupancy, in the same direction", () => {
    const strictQb = { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy: 1 };
    const looseQb = { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy: 0.5 };

    // Valuation side: QB replacement gets shallower as fewer superflex slots
    // are filled by quarterbacks.
    const replStrict = positionReplacementRank("QB", superflex, strictQb);
    const replLoose = positionReplacementRank("QB", superflex, looseQb);
    expect(replLoose).toBeLessThan(replStrict);

    // Draft side: the QB target falls for the same reason. Previously this was
    // constant, because rosterTargets ignored the coefficient entirely.
    const targetStrict = targetsFromFormat(superflex, strictQb).QB;
    const targetLoose = targetsFromFormat(superflex, looseQb).QB;
    expect(targetLoose).toBeLessThan(targetStrict);
  });

  it("agree that a superflex league wants more QB than a 1QB league", () => {
    const oneQb = fmt({ numTeams: 12 });
    expect(positionReplacementRank("QB", superflex)).toBeGreaterThan(
      positionReplacementRank("QB", oneQb)
    );
    expect(targetsFromFormat(superflex).QB).toBeGreaterThan(targetsFromFormat(oneQb).QB);
  });

  it("agree on which position the flex favours in PPR vs standard", () => {
    const ppr = fmt({ ppr: 1, numTeams: 12 });
    const std = fmt({ ppr: 0, numTeams: 12 });

    // Valuation: WR replacement is deeper than RB in PPR, not in standard.
    expect(positionReplacementRank("WR", ppr)).toBeGreaterThan(positionReplacementRank("RB", ppr));
    expect(positionReplacementRank("WR", std)).toBeLessThanOrEqual(
      positionReplacementRank("RB", std)
    );

    // Draft: the WR target is at least the RB target in PPR. Both read the same
    // weights now, so this cannot be satisfied by one and not the other.
    const t = targetsFromFormat(ppr);
    expect(t.WR).toBeGreaterThanOrEqual(t.RB);
  });
});
