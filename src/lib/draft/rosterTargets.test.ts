import { describe, expect, it } from "vitest";
import { lineupMeshScore, targetsFromFormat } from "./rosterTargets";
import { recommend } from "./recommend";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueStarters } from "../trade/format";
import type { PlayerMarketRecord } from "../governance";

function starters(over: Partial<LeagueStarters> = {}): LeagueStarters {
  return { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, SUPERFLEX: 0, ...over };
}

function fmt(over: Partial<LeagueFormat> = {}): LeagueFormat {
  return { ...DEFAULT_FORMAT, ...over };
}

function p(id: string, position: PlayerMarketRecord["position"], trueValue = 70): PlayerMarketRecord {
  return {
    id,
    name: id,
    position,
    team: "KC",
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 50,
    confidence: 0.5,
    sources: [],
    rosterSlot: position,
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test"
  };
}

const roster = (spec: Partial<Record<PlayerMarketRecord["position"], number>>) => {
  const out: PlayerMarketRecord[] = [];
  for (const [pos, n] of Object.entries(spec)) {
    for (let i = 0; i < (n ?? 0); i += 1) {
      out.push(p(`${pos}${i}`, pos as PlayerMarketRecord["position"]));
    }
  }
  return out;
};

describe("targetsFromFormat", () => {
  it("never targets more than one K or DEF, whatever the roster size", () => {
    const t = targetsFromFormat(fmt({ rosterSize: 20 }));
    expect(t.K).toBe(1);
    expect(t.DEF).toBe(1);
  });

  it("raises the QB target in a SUPERFLEX league", () => {
    // The headline F-010 defect: superflex leagues were told "target 1" QB.
    const one = targetsFromFormat(fmt({ starters: starters(), numQbs: 1 }));
    const sf = targetsFromFormat(
      fmt({ starters: starters({ SUPERFLEX: 1 }), numQbs: 2, rosterSize: 16 })
    );
    expect(one.QB).toBe(1);
    expect(sf.QB).toBeGreaterThanOrEqual(2);
  });

  it("raises the TE target in a 2-TE league", () => {
    const oneTe = targetsFromFormat(fmt({ starters: starters({ TE: 1 }) }));
    const twoTe = targetsFromFormat(fmt({ starters: starters({ TE: 2 }) }));
    expect(twoTe.TE).toBeGreaterThan(oneTe.TE);
  });

  it("scales bench depth with roster size", () => {
    const shallow = targetsFromFormat(fmt({ rosterSize: 10 }));
    const deep = targetsFromFormat(fmt({ rosterSize: 20 }));
    const sum = (t: ReturnType<typeof targetsFromFormat>) =>
      t.QB + t.RB + t.WR + t.TE + t.K + t.DEF;
    expect(sum(deep)).toBeGreaterThan(sum(shallow));
    expect(sum(deep)).toBeLessThanOrEqual(20);
  });

  it("always covers every started position", () => {
    const s = starters({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 });
    const t = targetsFromFormat(fmt({ starters: s, rosterSize: 16 }));
    expect(t.QB).toBeGreaterThanOrEqual(s.QB);
    expect(t.RB).toBeGreaterThanOrEqual(s.RB);
    expect(t.WR).toBeGreaterThanOrEqual(s.WR);
    expect(t.TE).toBeGreaterThanOrEqual(s.TE);
  });

  it("gives the odd FLEX slot to WR in PPR and RB in standard", () => {
    const ppr = targetsFromFormat(fmt({ ppr: 1, starters: starters({ FLEX: 1 }), rosterSize: 9 }));
    const std = targetsFromFormat(fmt({ ppr: 0, starters: starters({ FLEX: 1 }), rosterSize: 9 }));
    expect(ppr.WR).toBeGreaterThan(ppr.RB - 1);
    expect(std.RB).toBeGreaterThanOrEqual(std.WR - 1);
  });
});

describe("lineupMeshScore", () => {
  it("scores a perfectly built roster near the top", () => {
    const format = fmt({ starters: starters(), rosterSize: 9 });
    const t = targetsFromFormat(format);
    const mesh = lineupMeshScore(roster(t), format);
    expect(mesh.startersFilled).toBe(mesh.startersRequired);
    expect(mesh.score).toBeGreaterThanOrEqual(90);
    expect(mesh.grade.startsWith("A")).toBe(true);
  });

  it("PENALISES hoarding running backs while starter slots sit empty", () => {
    // Directly the "picking multiple running backs" failure mode.
    const format = fmt({ starters: starters(), rosterSize: 9 });
    const balanced = lineupMeshScore(roster({ QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 }), format);
    const hoarded = lineupMeshScore(roster({ RB: 9 }), format);
    expect(hoarded.score).toBeLessThan(balanced.score);
    expect(hoarded.notes.join(" ")).toMatch(/hoarding/i);
    expect(hoarded.gaps.map((g) => g.position)).toContain("WR");
  });

  it("reports every unfilled starting slot", () => {
    const format = fmt({ starters: starters(), rosterSize: 9 });
    const mesh = lineupMeshScore(roster({ QB: 1 }), format);
    expect(mesh.startersFilled).toBe(1);
    expect(mesh.notes.join(" ")).toMatch(/unfilled/i);
    expect(mesh.score).toBeLessThan(50);
  });

  it("counts a second QB toward the SUPERFLEX slot", () => {
    const format = fmt({ starters: starters({ SUPERFLEX: 1 }), numQbs: 2, rosterSize: 10 });
    const oneQb = lineupMeshScore(roster({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }), format);
    const twoQb = lineupMeshScore(roster({ QB: 2, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }), format);
    expect(twoQb.startersFilled).toBeGreaterThan(oneQb.startersFilled);
    expect(twoQb.notes.join(" ")).toMatch(/superflex/i);
  });

  it("lets a surplus RB fill the FLEX slot rather than counting it as waste", () => {
    const format = fmt({ starters: starters({ FLEX: 1 }), rosterSize: 9 });
    const mesh = lineupMeshScore(roster({ QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 1 }), format);
    expect(mesh.startersFilled).toBe(mesh.startersRequired);
  });

  it("is bounded to 0..100", () => {
    const format = fmt();
    expect(lineupMeshScore([], format).score).toBeGreaterThanOrEqual(0);
    expect(lineupMeshScore(roster({ RB: 40 }), format).score).toBeLessThanOrEqual(100);
  });
});

describe("recommend() honours league format (F-010 regression)", () => {
  const pool = [
    p("qb1", "QB", 90),
    p("qb2", "QB", 88),
    p("rb1", "RB", 85),
    p("wr1", "WR", 84),
    p("te1", "TE", 70),
    p("k1", "K", 40),
    p("def1", "DEF", 40)
  ];

  it("recommends a SECOND quarterback in superflex but not in 1QB", () => {
    const sfFormat = fmt({ starters: starters({ SUPERFLEX: 1 }), numQbs: 2, rosterSize: 16 });
    const oneQbFormat = fmt({ starters: starters(), numQbs: 1, rosterSize: 16 });
    const myRoster = [p("ownedQb", "QB", 92)];

    const sf = recommend({ available: pool, myRoster, format: sfFormat }, 7);
    const one = recommend({ available: pool, myRoster, format: oneQbFormat }, 7);

    const sfQb = sf.find((r) => r.player.position === "QB");
    const oneQb = one.find((r) => r.player.position === "QB");
    expect(sfQb?.reasons.join(" ")).toMatch(/fills QB need/);
    expect(oneQb?.reasons.join(" ") ?? "").not.toMatch(/fills QB need/);
  });

  it("reports the league's real target in its reason text, not a constant", () => {
    const format = fmt({ starters: starters({ WR: 3, FLEX: 2 }), rosterSize: 18 });
    const targets = targetsFromFormat(format);
    const recs = recommend({ available: pool, myRoster: [], format }, 7);
    const wr = recs.find((r) => r.player.position === "WR");
    expect(wr?.reasons.join(" ")).toContain(`target ${targets.WR}`);
  });

  it("still buries K and DEF until the core roster is nearly set", () => {
    const format = fmt({ starters: starters(), rosterSize: 16 });
    const recs = recommend({ available: pool, myRoster: [], format }, 7);
    const kicker = recs.find((r) => r.player.position === "K");
    expect(kicker?.category).toBe("Stash");
    expect(recs[0]!.player.position).not.toBe("K");
  });

  it("falls back to the documented default when no league is connected", () => {
    const recs = recommend({ available: pool, myRoster: [] }, 7);
    const wr = recs.find((r) => r.player.position === "WR");
    expect(wr?.reasons.join(" ")).toContain("target 5");
  });
});
