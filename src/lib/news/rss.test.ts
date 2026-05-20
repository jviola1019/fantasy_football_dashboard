import { describe, expect, it } from "vitest";
import { getNflNewsFeed, type RssParserLike } from "./rss";

interface FakeItem {
  title?: string;
  link?: string;
  isoDate?: string;
  contentSnippet?: string;
}

function fakeParser(items: FakeItem[]): RssParserLike {
  return {
    async parseURL() {
      return { items } as unknown as Awaited<ReturnType<RssParserLike["parseURL"]>>;
    }
  };
}

describe("NFL RSS adapter", () => {
  it("merges items from all configured feeds and sorts newest-first", async () => {
    const items = [
      { title: "Old story", link: "https://x.com/a", isoDate: "2026-05-10T10:00:00Z" },
      { title: "New story", link: "https://x.com/b", isoDate: "2026-05-18T10:00:00Z" }
    ];
    const result = await getNflNewsFeed(fakeParser(items), [
      { source: "ESPN NFL", url: "https://x.com/feed" }
    ]);
    expect(result.source.validation).toBe("valid");
    expect(result.items[0]?.title).toBe("New story");
    expect(result.items[1]?.title).toBe("Old story");
  });

  it("returns unavailable when every feed fails", async () => {
    const failing: RssParserLike = {
      async parseURL() {
        throw new Error("network down");
      }
    };
    const result = await getNflNewsFeed(failing, [{ source: "X", url: "https://x.com" }]);
    expect(result.items).toHaveLength(0);
    expect(result.source.freshness).toBe("unavailable");
    expect(result.source.failure).toContain("network down");
  });

  it("ignores items missing required fields without crashing", async () => {
    const items: FakeItem[] = [
      { title: "Real", link: "https://x.com/a", isoDate: "2026-05-18T10:00:00Z" },
      { title: "Bad — no link" },
      { link: "https://x.com/c" }
    ];
    const result = await getNflNewsFeed(fakeParser(items), [{ source: "X", url: "https://x.com" }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Real");
  });

  it("downgrades confidence when at least one feed fails but others succeed", async () => {
    const flakyParser: RssParserLike = {
      async parseURL(url: string) {
        if (url.includes("bad")) throw new Error("bad");
        return {
          items: [{ title: "ok", link: "https://x.com/ok", isoDate: "2026-05-18T10:00:00Z" }]
        } as unknown as Awaited<ReturnType<RssParserLike["parseURL"]>>;
      }
    };
    const result = await getNflNewsFeed(flakyParser, [
      { source: "Good", url: "https://x.com/good" },
      { source: "Bad", url: "https://x.com/bad" }
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.source.confidence).toBe(0.6);
    expect(result.source.failure).toContain("Bad");
  });
});
