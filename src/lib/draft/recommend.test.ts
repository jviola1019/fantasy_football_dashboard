import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import { fixturePlayers } from "../fixtures";
import type { PlayerMarketRecord } from "../governance";

describe("draft recommend()", () => {
  it("returns at most `limit` recommendations", () => {
    const result = recommend({ available: fixturePlayers, myRoster: [] }, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("ranks by score descending", () => {
    const result = recommend({ available: fixturePlayers, myRoster: [] }, 8);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.score).toBeGreaterThanOrEqual(result[i + 1]!.score);
    }
  });

  it("boosts players that fill a positional need", () => {
    const empty = recommend({ available: fixturePlayers, myRoster: [], targets: { RB: 4 } }, 10);
    const rbScore = empty.find((r) => r.player.position === "RB")?.score ?? 0;

    const full = recommend(
      {
        available: fixturePlayers,
        myRoster: fixturePlayers.filter((p) => p.position === "RB").slice(0, 4),
        targets: { RB: 4 }
      },
      10
    );
    const rbScoreFull = full.find((r) => r.player.position === "RB")?.score ?? 0;
    expect(rbScore).toBeGreaterThan(rbScoreFull);
  });

  it("tags need vs stash vs value categories", () => {
    const result = recommend(
      {
        available: fixturePlayers,
        myRoster: fixturePlayers.filter((p) => p.position === "QB").slice(0, 1),
        targets: { QB: 1, RB: 4, WR: 5, TE: 1 }
      },
      8
    );
    const qb = result.find((r) => r.player.position === "QB");
    // QB target is filled, so QB picks are either Stash (depth) or Run (last in tier — tier-cliff override is correct).
    expect(["Stash", "Run"]).toContain(qb?.category);
    const rb = result.find((r) => r.player.position === "RB");
    expect(["Need", "Value", "Run"]).toContain(rb?.category);
  });

  it("never fabricates a player not in the input", () => {
    const result = recommend({ available: fixturePlayers, myRoster: [] });
    const inputIds = new Set(fixturePlayers.map((p) => p.id));
    for (const rec of result) expect(inputIds.has(rec.player.id)).toBe(true);
  });

  // Per-round / kicker-late behavior (Sprint 5 phase 9).
  const mk = (id: string, position: PlayerMarketRecord["position"], trueValue: number): PlayerMarketRecord => ({
    id, name: id, position, team: "FA", perceivedValue: trueValue, trueValue,
    ownershipLeverage: 0, fragility: 0, trendingMomentum: 0, volatility: 30, opportunity: 0,
    confidence: 0.8, sources: [], rosterSlot: "BENCH", status: "active",
    imageUrl: "https://example.com/x.png", imageSource: "test"
  });

  it("buries a kicker behind skill players on an empty roster (don't draft a K in round 1)", () => {
    const pool = [mk("Elite-K", "K", 95), mk("Avg-RB", "RB", 60), mk("Avg-WR", "WR", 60)];
    const result = recommend({ available: pool, myRoster: [] }, 3);
    expect(result[0]!.player.position).not.toBe("K"); // a skill player ranks first
    const k = result.find((r) => r.player.position === "K")!;
    expect(k.player.position).toBe("K");
    expect(k.category).toBe("Stash"); // held, not "Need", despite high value
    expect(result[result.length - 1]!.player.position).toBe("K"); // ranks last
  });

  it("surfaces K/DEF only once the core starters are essentially filled", () => {
    const pool = [mk("K1", "K", 80), mk("DEF1", "DEF", 80), mk("WRdeep", "WR", 40)];
    // A full core roster (QB/RB×4/WR×5/TE) ⇒ coreRemaining ~0 ⇒ K/DEF become Need.
    const fullCore = [
      mk("qb", "QB", 70), mk("r1", "RB", 70), mk("r2", "RB", 70), mk("r3", "RB", 70), mk("r4", "RB", 70),
      mk("w1", "WR", 70), mk("w2", "WR", 70), mk("w3", "WR", 70), mk("w4", "WR", 70), mk("w5", "WR", 70),
      mk("te", "TE", 70)
    ];
    const result = recommend({ available: pool, myRoster: fullCore }, 3);
    const k = result.find((r) => r.player.position === "K")!;
    expect(k.category).toBe("Need"); // now sensible to draft
  });
});
