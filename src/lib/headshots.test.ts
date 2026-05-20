import { describe, expect, it } from "vitest";
import { getHeadshotSources, primaryHeadshot } from "./headshots";
import { fixturePlayers } from "./fixtures";

describe("getHeadshotSources", () => {
  it("returns Sleeper URL first when sleeperId is present", () => {
    const sources = getHeadshotSources({ sleeperId: "9493", espnId: 3918298 });
    expect(sources[0]).toBe("https://sleepercdn.com/content/nfl/players/thumb/9493.jpg");
    expect(sources[1]).toBe("https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png");
  });

  it("falls back to ESPN-only when only espnId is given", () => {
    const sources = getHeadshotSources({ espnId: 3117251 });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain("3117251.png");
  });

  it("returns empty when neither id is given", () => {
    expect(getHeadshotSources({})).toEqual([]);
    expect(primaryHeadshot({})).toBeNull();
  });

  it("rejects non-numeric ids defensively (no SSRF surface)", () => {
    expect(getHeadshotSources({ sleeperId: "../etc/passwd" })).toEqual([]);
    expect(getHeadshotSources({ espnId: "javascript:alert(1)" })).toEqual([]);
  });

  it("primary URL is always the first of the cascade", () => {
    expect(primaryHeadshot({ sleeperId: "1", espnId: 2 })).toContain("sleepercdn.com");
    expect(primaryHeadshot({ espnId: 2 })).toContain("espncdn.com");
  });
});

describe("fixture headshot correctness (regression: Justin-Fields-on-Puka)", () => {
  const expectedSleeperIds: Record<string, string> = {
    "puka-nacua": "9493",
    "bijan-robinson": "9509",
    "josh-allen": "4984",
    "jahmyr-gibbs": "9221",
    "sam-laporta": "10859",
    "caleb-williams": "11560",
    "christian-mccaffrey": "4034",
    "marvin-harrison": "11628"
  };

  for (const [id, sleeperId] of Object.entries(expectedSleeperIds)) {
    it(`${id} routes to Sleeper id ${sleeperId}`, () => {
      const player = fixturePlayers.find((p) => p.id === id);
      expect(player, `fixture player "${id}" missing`).toBeDefined();
      expect(player!.imageUrl).toBe(
        `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`
      );
    });
  }

  it("no fixture player references the historical wrong ESPN id (4362887 = Justin Fields)", () => {
    for (const player of fixturePlayers) {
      expect(player.imageUrl).not.toContain("4362887");
    }
  });
});
