import { describe, expect, it } from "vitest";
import { positionReplacementRank } from "./enrich";
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

  it("stays calibrated against the retired 12-team RB constant", () => {
    // Evidence the 1.2 depth cushion is calibrated rather than arbitrary: RB
    // lands on the value the old hand-tuned table used (36).
    const rb = positionReplacementRank("RB", fmt({ numTeams: 12, ppr: 1 }));
    expect(rb).toBeGreaterThanOrEqual(34);
    expect(rb).toBeLessThanOrEqual(37);
  });

  it("is always at least 1 so trueValue can never divide by zero", () => {
    const degenerate = fmt({ numTeams: 1, starters: st({ TE: 0, FLEX: 0 }) });
    expect(positionReplacementRank("TE", degenerate)).toBeGreaterThanOrEqual(1);
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
