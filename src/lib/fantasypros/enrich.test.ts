import { describe, expect, it } from "vitest";
import { DEFAULT_REPLACEMENT_MODEL, positionReplacementRank } from "./enrich";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueStarters } from "../trade/format";

/**
 * Replacement level drives `trueValue`, which in turn feeds the season
 * simulation, the draft board, trade grades and every panel. Before audit
 * F-010 it was a fixed table tuned for a 12-team 1QB league and applied to
 * every league regardless of size, superflex or TE count.
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

describe("replacement level follows the league (audit F-010)", () => {
  it("scales with team count instead of assuming 12", () => {
    const eight = positionReplacementRank("RB", fmt({ numTeams: 8 }));
    const twelve = positionReplacementRank("RB", fmt({ numTeams: 12 }));
    expect(eight).toBeLessThan(twelve);
    expect(eight / twelve).toBeCloseTo(8 / 12, 1);
  });

  it("raises the QB baseline enormously in superflex", () => {
    // The retired table gave a superflex league the same QB baseline as a 1QB
    // league, which understated every quarterback's value.
    const oneQb = positionReplacementRank("QB", fmt({ numTeams: 12 }));
    const superflex = positionReplacementRank("QB", fmt({ numTeams: 12, starters: st({ SUPERFLEX: 1 }) }));
    expect(superflex).toBeGreaterThan(oneQb * 1.8);
  });

  it("raises the TE baseline in a 2-TE league", () => {
    const oneTe = positionReplacementRank("TE", fmt({ numTeams: 12 }));
    const twoTe = positionReplacementRank("TE", fmt({ numTeams: 12, starters: st({ TE: 2 }) }));
    expect(twoTe).toBeGreaterThan(oneTe * 1.8);
  });

  it("gives WR a deeper baseline than RB in PPR, and not in standard", () => {
    const ppr = fmt({ numTeams: 12, ppr: 1 });
    const std = fmt({ numTeams: 12, ppr: 0 });
    expect(positionReplacementRank("WR", ppr)).toBeGreaterThan(positionReplacementRank("RB", ppr));
    expect(positionReplacementRank("WR", std)).toBeLessThanOrEqual(positionReplacementRank("RB", std));
  });

  it("never gives K or DEF a bench cushion — they are fungible", () => {
    const f = fmt({ numTeams: 10 });
    expect(positionReplacementRank("K", f)).toBe(10);
    expect(positionReplacementRank("DEF", f)).toBe(10);
  });

  it("pins the 12-team RB baseline so the cushion cannot drift unnoticed", () => {
    // CORRECTED (audit P2 §9). This test was titled "stays calibrated" and its
    // comment offered the RB agreement as "evidence the 1.2 depth cushion is
    // calibrated rather than arbitrary". It is not. Landing near the previous
    // hand-tuned constant, on one position, in one league shape, is agreement
    // with an earlier guess — no observed outcome is involved.
    //
    // What this test legitimately does is PIN the value, so a change to
    // DEPTH_CUSHION shows up as a deliberate diff rather than silent drift. The
    // parameter's actual influence is measured in
    // reports/2026-08-06/replacement-sensitivity.md.
    const rb = positionReplacementRank("RB", fmt({ numTeams: 12, ppr: 1 }));
    expect(rb).toBeGreaterThanOrEqual(34);
    expect(rb).toBeLessThanOrEqual(37);
  });

  it("is always at least 1 so trueValue can never divide by zero", () => {
    const degenerate = fmt({ numTeams: 1, starters: st({ TE: 0, FLEX: 0 }) });
    expect(positionReplacementRank("TE", degenerate)).toBeGreaterThanOrEqual(1);
  });

  describe("the two free parameters are assumptions, and behave like it (P2 §9/§10)", () => {
    it("depth cushion moves replacement monotonically", () => {
      const f = fmt({ numTeams: 12, ppr: 1 });
      const ranks = [1.0, 1.1, 1.2, 1.3, 1.4].map(
        (depthCushion) =>
          positionReplacementRank("RB", f, { ...DEFAULT_REPLACEMENT_MODEL, depthCushion })
      );
      for (let i = 1; i < ranks.length; i += 1) {
        expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
      }
      expect(ranks[0]).toBeLessThan(ranks[4]!);
    });

    it("SUPERFLEX occupancy is INERT when there is no superflex slot", () => {
      // A 2QB league uses starters.QB = 2 and must not be touched by this
      // coefficient. Swept across every non-superflex shape in the harness with
      // zero violations; pinned here so it stays that way.
      for (const f of [
        fmt({ numTeams: 12 }),
        fmt({ numTeams: 12, starters: st({ QB: 2 }) }),
        fmt({ numTeams: 10, starters: st({ TE: 2 }) })
      ]) {
        for (const pos of ["QB", "RB", "WR", "TE"] as const) {
          const base = positionReplacementRank(pos, f);
          for (const superflexQbOccupancy of [0.8, 0.9, 0.95]) {
            expect(
              positionReplacementRank(pos, f, { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy })
            ).toBe(base);
          }
        }
      }
    });

    it("lowering SUPERFLEX occupancy MOVES demand to flex, it does not destroy it", () => {
      // Without redistribution, dialling the coefficient down would quietly
      // shrink the league's total startable demand instead of reallocating it.
      const f = fmt({ numTeams: 12, ppr: 1, numQbs: 2, starters: st({ SUPERFLEX: 1 }) });
      const total = (superflexQbOccupancy: number) =>
        (["QB", "RB", "WR", "TE"] as const).reduce(
          (acc, p) =>
            acc + positionReplacementRank(p, f, { depthCushion: 1, superflexQbOccupancy }),
          0
        );
      // Equal within integer-rounding noise across four positions.
      expect(Math.abs(total(0.8) - total(1.0))).toBeLessThanOrEqual(2);
      // QB depth genuinely falls as occupancy falls.
      const qb = (o: number) =>
        positionReplacementRank("QB", f, { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy: o });
      expect(qb(0.8)).toBeLessThan(qb(1.0));
    });
  });

  it("matches the operator's real leagues rather than a 12-team default", () => {
    // 8-team and 10-team leagues must not be graded on 12-team baselines.
    const eightTeam = positionReplacementRank("RB", fmt({ numTeams: 8, ppr: 1 }));
    const tenTeamTwoFlex = positionReplacementRank("RB", fmt({ numTeams: 10, ppr: 1, starters: st({ FLEX: 2 }) }));
    const twelveTeam = positionReplacementRank("RB", fmt({ numTeams: 12, ppr: 1 }));
    expect(eightTeam).toBeLessThan(tenTeamTwoFlex);
    expect(eightTeam).toBeLessThan(twelveTeam);
  });
});
