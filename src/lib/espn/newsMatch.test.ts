import { describe, it, expect } from "vitest";
import {
  buildNewsWeightMap,
  normaliseMomentumScores,
  buildPlayerNewsIndex
} from "./newsMatch";
import { newsForPlayer } from "./newsLookup";
import type { EspnNewsArticle } from "./news";

// Stable "now" for all tests: 2026-05-29T12:00:00Z
const NOW_MS = new Date("2026-05-29T12:00:00Z").getTime();

// ESPN athlete IDs → Sleeper IDs via espn_id on the player record
const players: Record<string, Record<string, unknown>> = {
  sleeperA: { player_id: "sleeperA", full_name: "Garrett Wilson", espn_id: 4569618 },
  sleeperB: { player_id: "sleeperB", full_name: "Davante Adams", espn_id: 3054211 },
  sleeperC: { player_id: "sleeperC", full_name: "No ESPN ID player" } // intentionally missing espn_id
};

function makeArticle(
  id: number,
  athleteIds: number[],
  lastModified: string
): EspnNewsArticle {
  return {
    id,
    headline: `Article ${id}`,
    lastModified,
    categories: athleteIds.map((athleteId) => ({ type: "athlete", athleteId }))
  };
}

// Relative times
const MINUS_1H = new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString(); // 1h ago → weight 1.0
const MINUS_30H = new Date(NOW_MS - 30 * 60 * 60 * 1000).toISOString(); // 30h ago → weight 0.5
const MINUS_60H = new Date(NOW_MS - 60 * 60 * 60 * 1000).toISOString(); // 60h ago → weight 0.25
const MINUS_80H = new Date(NOW_MS - 80 * 60 * 60 * 1000).toISOString(); // 80h ago → dropped

describe("buildNewsWeightMap", () => {
  it("maps ESPN athleteId to Sleeper player ID via espn_id", () => {
    const articles = [makeArticle(1, [4569618], MINUS_1H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.has("sleeperA")).toBe(true);
    expect(map.get("sleeperA")).toBeCloseTo(1.0);
  });

  it("applies weight 1.0 for articles within 24h", () => {
    const articles = [makeArticle(1, [4569618], MINUS_1H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.get("sleeperA")).toBeCloseTo(1.0);
  });

  it("applies weight 0.5 for articles between 24-48h", () => {
    const articles = [makeArticle(2, [4569618], MINUS_30H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.get("sleeperA")).toBeCloseTo(0.5);
  });

  it("applies weight 0.25 for articles between 48-72h", () => {
    const articles = [makeArticle(3, [4569618], MINUS_60H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.get("sleeperA")).toBeCloseTo(0.25);
  });

  it("drops articles older than 72h", () => {
    const articles = [makeArticle(4, [4569618], MINUS_80H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.has("sleeperA")).toBe(false);
  });

  it("accumulates weights across multiple articles for the same player", () => {
    const articles = [
      makeArticle(1, [4569618], MINUS_1H),  // +1.0
      makeArticle(2, [4569618], MINUS_30H), // +0.5
      makeArticle(3, [4569618], MINUS_60H)  // +0.25
    ];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.get("sleeperA")).toBeCloseTo(1.75);
  });

  it("ignores players without espn_id — never fabricates", () => {
    const articles = [makeArticle(1, [4569618], MINUS_1H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.has("sleeperC")).toBe(false);
  });

  it("ignores unmapped ESPN athlete IDs", () => {
    const articles = [makeArticle(1, [9999999], MINUS_1H)]; // no Sleeper mapping
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.size).toBe(0);
  });

  it("handles multiple athletes in one article", () => {
    const articles = [makeArticle(1, [4569618, 3054211], MINUS_1H)];
    const map = buildNewsWeightMap(articles, players, NOW_MS);
    expect(map.get("sleeperA")).toBeCloseTo(1.0);
    expect(map.get("sleeperB")).toBeCloseTo(1.0);
  });

  it("handles string espn_id (as stored in some Sleeper records)", () => {
    const playersStrId: Record<string, Record<string, unknown>> = {
      sleeperX: { player_id: "sleeperX", espn_id: "4569618" } // string form
    };
    const articles = [makeArticle(1, [4569618], MINUS_1H)];
    const map = buildNewsWeightMap(articles, playersStrId, NOW_MS);
    expect(map.has("sleeperX")).toBe(true);
  });

  it("returns empty map for no articles", () => {
    const map = buildNewsWeightMap([], players, NOW_MS);
    expect(map.size).toBe(0);
  });

  it("returns empty map for empty players catalog", () => {
    const articles = [makeArticle(1, [4569618], MINUS_1H)];
    const map = buildNewsWeightMap(articles, {}, NOW_MS);
    expect(map.size).toBe(0);
  });
});

describe("normaliseMomentumScores", () => {
  it("normalises to [0, 100] with max mapping to 100", () => {
    const weightMap = new Map([
      ["playerA", 2.0],
      ["playerB", 1.0],
      ["playerC", 0.5]
    ]);
    const scores = normaliseMomentumScores(weightMap);
    expect(scores["playerA"]).toBe(100);
    expect(scores["playerB"]).toBe(50);
    expect(scores["playerC"]).toBe(25);
  });

  it("returns empty record for empty map", () => {
    expect(normaliseMomentumScores(new Map())).toEqual({});
  });

  it("returns empty record when max is 0", () => {
    expect(normaliseMomentumScores(new Map([["x", 0]]))).toEqual({});
  });

  it("all players with equal weight get score 100", () => {
    const weightMap = new Map([
      ["playerA", 1.5],
      ["playerB", 1.5]
    ]);
    const scores = normaliseMomentumScores(weightMap);
    expect(scores["playerA"]).toBe(100);
    expect(scores["playerB"]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildPlayerNewsIndex — the headlines, not just the count of them
// ---------------------------------------------------------------------------

function makeFullArticle(
  id: number,
  athleteIds: number[],
  published: string,
  extra: Partial<EspnNewsArticle> = {}
): EspnNewsArticle {
  return {
    id,
    headline: `Headline ${id}`,
    lastModified: published,
    published,
    links: { web: { href: `https://www.espn.com/nfl/story/_/id/${id}` } },
    categories: athleteIds.map((athleteId) => ({ type: "athlete", athleteId })),
    ...extra
  } as EspnNewsArticle;
}

describe("buildPlayerNewsIndex", () => {
  it("keys by PlayerMarketRecord.id, NOT the bare Sleeper id", () => {
    // The D-A canary. `buildNewsWeightMap` keys bare; its consumer looked up by
    // record id and missed on every player for months. If this index ever
    // reverts to bare keys, `envelope.playerNews[player.id]` silently returns
    // nothing and the panel renders "no coverage" for a well-covered player —
    // the same failure, in a place a reader would believe.
    const index = buildPlayerNewsIndex([makeFullArticle(1, [4569618], MINUS_1H)], players);
    expect(Object.keys(index)).toEqual(["sleeper:sleeperA"]);
    expect(index["sleeperA"]).toBeUndefined();
  });

  it("carries the headline, an ISO timestamp and the article URL", () => {
    const index = buildPlayerNewsIndex([makeFullArticle(7, [4569618], MINUS_1H)], players);
    expect(index["sleeper:sleeperA"]).toEqual([
      {
        articleId: 7,
        headline: "Headline 7",
        publishedAt: new Date(MINUS_1H).toISOString(),
        url: "https://www.espn.com/nfl/story/_/id/7"
      }
    ]);
  });

  it("falls back to lastModified when ESPN omits `published`", () => {
    const article = makeFullArticle(8, [4569618], MINUS_1H);
    delete (article as { published?: string | null }).published;
    const index = buildPlayerNewsIndex([article], players);
    expect(index["sleeper:sleeperA"]![0]!.publishedAt).toBe(new Date(MINUS_1H).toISOString());
  });

  it("sorts newest first and caps the list", () => {
    const index = buildPlayerNewsIndex(
      [
        makeFullArticle(1, [4569618], MINUS_60H),
        makeFullArticle(2, [4569618], MINUS_1H),
        makeFullArticle(3, [4569618], MINUS_30H)
      ],
      players,
      { maxPerPlayer: 2 }
    );
    expect(index["sleeper:sleeperA"]!.map((i) => i.articleId)).toEqual([2, 3]);
  });

  it("keeps articles older than the 72h momentum window", () => {
    // The weighting drops >72h because stale attention is not momentum. A
    // headline is still news, and hiding it would leave the reader unable to see
    // WHY a player they are researching is quiet.
    const index = buildPlayerNewsIndex([makeFullArticle(9, [4569618], MINUS_80H)], players);
    expect(index["sleeper:sleeperA"]).toHaveLength(1);
    expect(buildNewsWeightMap([makeArticle(9, [4569618], MINUS_80H)], players, NOW_MS).size).toBe(0);
  });

  it("never fabricates for an athlete Sleeper has no espn_id for", () => {
    const index = buildPlayerNewsIndex([makeFullArticle(1, [999999], MINUS_1H)], players);
    expect(index).toEqual({});
  });

  it("does not list the same article twice for one player", () => {
    const dup = makeFullArticle(1, [4569618, 4569618], MINUS_1H);
    expect(buildPlayerNewsIndex([dup], players)["sleeper:sleeperA"]).toHaveLength(1);
  });

  it("attributes a multi-player article to each player once", () => {
    const index = buildPlayerNewsIndex([makeFullArticle(1, [4569618, 3054211], MINUS_1H)], players);
    expect(Object.keys(index).sort()).toEqual(["sleeper:sleeperA", "sleeper:sleeperB"]);
  });

  it("nulls a non-absolute or missing link rather than emitting a broken one", () => {
    // A relative href would fail `z.string().url()` and reject the WHOLE
    // envelope, not just this link.
    const relative = makeFullArticle(1, [4569618], MINUS_1H, {
      links: { web: { href: "/nfl/story/_/id/1" } }
    } as Partial<EspnNewsArticle>);
    expect(buildPlayerNewsIndex([relative], players)["sleeper:sleeperA"]![0]!.url).toBeNull();
    const none = makeFullArticle(2, [4569618], MINUS_1H, { links: null } as Partial<EspnNewsArticle>);
    expect(buildPlayerNewsIndex([none], players)["sleeper:sleeperA"]![0]!.url).toBeNull();
  });

  it("drops an article whose timestamp cannot be parsed", () => {
    // Better no headline than one whose age reads "NaN ago".
    const bad = makeFullArticle(1, [4569618], "not-a-date");
    expect(buildPlayerNewsIndex([bad], players)).toEqual({});
  });
});

describe("newsForPlayer", () => {
  const index = buildPlayerNewsIndex([makeFullArticle(1, [4569618], MINUS_1H)], players);

  it("accepts the record id form", () => {
    expect(newsForPlayer("sleeper:sleeperA", index)).toHaveLength(1);
  });

  it("also accepts a bare id, so no caller can repeat D-A", () => {
    expect(newsForPlayer("sleeperA", index)).toHaveLength(1);
  });

  it("returns an empty list, never undefined, for an unknown player or absent index", () => {
    expect(newsForPlayer("sleeper:nobody", index)).toEqual([]);
    expect(newsForPlayer("sleeper:sleeperA", null)).toEqual([]);
  });
});
