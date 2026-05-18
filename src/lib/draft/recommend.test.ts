import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import { fixturePlayers } from "../fixtures";

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
});
