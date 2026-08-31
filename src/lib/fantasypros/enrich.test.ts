import { describe, expect, it } from "vitest";
import { DEFAULT_REPLACEMENT_MODEL, enrichWithFp, positionReplacementRank } from "./enrich";
import type { PlayerMarketRecord, SourceMeta } from "../governance";
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

/**
 * ESPN news momentum has to actually reach the record it is claimed for.
 *
 * Audit 2026-08-31, D-A. `buildNewsWeightMap` keys its scores by the BARE
 * Sleeper player id, because it iterates the Sleeper players map directly
 * (`newsMatch.ts:59`, `:102`). `PlayerMarketRecord.id` is `sleeper:<id>`
 * (`normalize.ts:25`). The lookup in `enrichWithFp` used `record.id`, so it
 * missed on every player in the catalog, silently fell through to the Sleeper
 * add/drop proxy, and the SourceMeta still announced "trending_momentum from
 * ESPN headline velocity".
 *
 * The sibling code path strips the prefix and says why it must
 * (`trendingProxy.ts:44`). Nothing tested this one — `newsMomentumScores`
 * appeared in zero test files.
 */
const newsRecord = (id: string): PlayerMarketRecord => ({
  id,
  name: "Test Player",
  position: "WR",
  team: "SF",
  perceivedValue: 0,
  trueValue: 0,
  ownershipLeverage: 0,
  fragility: 0,
  trendingMomentum: 0,
  volatility: 0,
  opportunity: 0,
  confidence: 0,
  sources: [],
  rosterSlot: null,
  status: "active",
  imageUrl: "https://sleepercdn.com/content/nfl/players/thumb/4046.jpg",
  imageSource: "Sleeper headshot CDN"
});

const newsSource: SourceMeta = {
  source: "FantasyPros ECR",
  fetchedAt: new Date().toISOString(),
  ttlSeconds: 86_400,
  freshness: "fresh",
  confidence: 0.85,
  validation: "valid",
  missingFields: [],
  assumptions: [],
  failure: null
};

describe("ESPN news momentum reaches the record (D-A)", () => {
  it("matches a score keyed by the BARE sleeper id", () => {
    // The map comes from Object.entries(playersSnapshot.players), so its keys
    // never carry the "sleeper:" prefix that record.id does.
    const out = enrichWithFp(
      newsRecord("sleeper:4046"),
      null,
      { rankingsSource: newsSource, newsMomentumScores: { "4046": 73 } },
      300,
      "PPR"
    );
    expect(out.trendingMomentum).toBe(73);
  });

  it("still matches when a record id somehow carries no prefix", () => {
    const out = enrichWithFp(
      newsRecord("4046"),
      null,
      { rankingsSource: newsSource, newsMomentumScores: { "4046": 51 } },
      300,
      "PPR"
    );
    expect(out.trendingMomentum).toBe(51);
  });

  it("falls through to the Sleeper proxy for a player with no news", () => {
    // Not every player is in the news. Absence must fall back, not zero out.
    const out = enrichWithFp(
      newsRecord("sleeper:9999"),
      null,
      {
        rankingsSource: newsSource,
        newsMomentumScores: { "4046": 73 },
        trendingAdds: new Map([["9999", 100]]),
        trendingDrops: new Map([["9999", 0]])
      },
      300,
      "PPR",
      { trendingAddsMax: 100, trendingDropsMax: 100 }
    );
    expect(out.trendingMomentum).toBeGreaterThan(0);
  });

  it("does not claim ESPN news as the source when no score landed", () => {
    // The provenance bug underneath the key bug: `hasNews` was computed from
    // the map being non-empty, not from a value being used. So every record
    // announced ESPN headline velocity while carrying a Sleeper proxy number.
    const out = enrichWithFp(
      newsRecord("sleeper:9999"),
      null,
      {
        rankingsSource: newsSource,
        newsMomentumScores: { "4046": 73 },
        trendingAdds: new Map([["9999", 100]]),
        trendingDrops: new Map([["9999", 0]])
      },
      300,
      "PPR",
      { trendingAddsMax: 100, trendingDropsMax: 100 }
    );
    const claims = out.sources.flatMap((s) => s.assumptions).join(" ");
    expect(claims).toMatch(/Sleeper/i);
  });
});
