import Parser from "rss-parser";
import { z } from "zod";
import { evaluateFreshness, unavailableSource, type SourceMeta } from "../governance";

const NEWS_TTL = 15 * 60;

export const NflNewsItemSchema = z.object({
  title: z.string(),
  link: z.string().url(),
  publishedAt: z.string().nullable(),
  summary: z.string().nullable(),
  feedSource: z.string()
});
export type NflNewsItem = z.infer<typeof NflNewsItemSchema>;

/** Public RSS feeds — no auth, no scraping required. */
export const NFL_FEEDS = [
  { source: "ESPN NFL", url: "https://www.espn.com/espn/rss/nfl/news" },
  { source: "NFL.com", url: "https://www.nfl.com/feeds/rss/news" }
] as const;

export interface GetNewsResult {
  items: NflNewsItem[];
  source: SourceMeta;
}

export type RssParserLike = Pick<Parser, "parseURL">;

export async function getNflNewsFeed(
  parser: RssParserLike = new Parser(),
  feeds: ReadonlyArray<{ source: string; url: string }> = NFL_FEEDS
): Promise<GetNewsResult> {
  const fetchedAt = new Date().toISOString();
  const merged: NflNewsItem[] = [];
  const failures: string[] = [];

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items ?? []) {
        if (!item.title || !item.link) continue;
        merged.push({
          title: item.title,
          link: item.link,
          publishedAt: item.isoDate ?? item.pubDate ?? null,
          summary: item.contentSnippet ?? item.content ?? null,
          feedSource: feed.source
        });
      }
    } catch (err) {
      failures.push(`${feed.source}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  if (merged.length === 0) {
    return {
      items: [],
      source: unavailableSource(
        "NFL public RSS",
        failures.join("; ") || "all feeds returned no items"
      )
    };
  }

  // Sort newest-first; entries with no date sink to the bottom.
  merged.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  return {
    items: merged,
    source: {
      source: "NFL public RSS",
      fetchedAt,
      ttlSeconds: NEWS_TTL,
      freshness: evaluateFreshness(fetchedAt, NEWS_TTL),
      confidence: failures.length > 0 ? 0.6 : 0.9,
      validation: "valid",
      missingFields: [],
      assumptions: ["Public RSS feeds; coverage and ordering vary by publisher."],
      failure: failures.length > 0 ? failures.join("; ") : null
    }
  };
}
