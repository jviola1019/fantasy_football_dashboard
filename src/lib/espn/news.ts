// ESPN public NFL news API — no auth required.
//
// Empirically captured 2026-05-29 against:
//   GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100
//
// Per-article payload (relevant fields):
//   {
//     "id": 48904404,
//     "headline": "...",
//     "lastModified": "2026-05-29T00:13:49Z",
//     "categories": [
//       { "type": "athlete", "athleteId": 4569618, "description": "Garrett Wilson" },
//       { "type": "team", "teamId": 20, "description": "New York Jets" },
//       { "type": "league", ... }
//     ]
//   }
//
// Only the `type === "athlete"` categories are used for player matching;
// the rest are ignored.

import { z } from "zod";

export const ESPN_NEWS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";

const EspnNewsCategorySchema = z
  .object({
    type: z.string(),
    athleteId: z.number().int().optional(),
    description: z.string().optional().nullable()
  })
  .passthrough();

/**
 * The article's canonical web URL, at `links.web.href`.
 *
 * S4: this was always present in the stored payload — the article schema is
 * `.passthrough()`, so every unknown key survived parsing and was written to
 * `news_snapshots` — but it was not declared, so nothing could read it without
 * an `as any`. Declaring it makes existing snapshots yield a link with no
 * re-fetch and no migration. Optional throughout: an article ESPN publishes
 * without a web link renders as text rather than as a dead anchor.
 */
const EspnNewsLinksSchema = z
  .object({
    web: z
      .object({ href: z.string().optional().nullable() })
      .passthrough()
      .optional()
      .nullable()
  })
  .passthrough();

export const EspnNewsArticleSchema = z
  .object({
    id: z.number().int(),
    headline: z.string(),
    description: z.string().optional().nullable(),
    lastModified: z.string(),
    published: z.string().optional().nullable(),
    links: EspnNewsLinksSchema.optional().nullable(),
    categories: z.array(EspnNewsCategorySchema).optional().default([])
  })
  .passthrough();
export type EspnNewsArticle = z.infer<typeof EspnNewsArticleSchema>;
export const EspnNewsArticleListSchema = z.array(EspnNewsArticleSchema);

export const EspnNewsResponseSchema = z
  .object({
    articles: z.array(EspnNewsArticleSchema)
  })
  .passthrough();
export type EspnNewsResponse = z.infer<typeof EspnNewsResponseSchema>;

/**
 * Fetch the latest NFL news articles from ESPN's public API.
 * Each article may reference one or more NFL athletes via
 * `categories[].type === "athlete"` entries.
 */
export async function fetchEspnNews({
  limit = 100,
  fetcher = fetch
}: {
  limit?: number;
  fetcher?: typeof fetch;
} = {}): Promise<{ articles: EspnNewsArticle[]; error?: string }> {
  const url = `${ESPN_NEWS_URL}?limit=${limit}`;
  try {
    const res = await fetcher(url);
    if (!res.ok) {
      return { articles: [], error: `HTTP ${res.status}` };
    }
    const raw = await res.json();
    const parsed = EspnNewsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { articles: [], error: `schema: ${parsed.error.message.slice(0, 300)}` };
    }
    return { articles: parsed.data.articles };
  } catch (err) {
    return {
      articles: [],
      error: err instanceof Error ? err.message.slice(0, 300) : "unknown"
    };
  }
}

/**
 * Extract all ESPN athlete IDs mentioned in a list of articles.
 * Returns a flat array of { athleteId, articleId, lastModified }.
 */
export function extractAthleteRefs(articles: EspnNewsArticle[]): Array<{
  athleteId: number;
  articleId: number;
  lastModified: string;
}> {
  const refs: Array<{ athleteId: number; articleId: number; lastModified: string }> = [];
  for (const article of articles) {
    for (const cat of article.categories ?? []) {
      if (cat.type === "athlete" && typeof cat.athleteId === "number") {
        refs.push({
          athleteId: cat.athleteId,
          articleId: article.id,
          lastModified: article.lastModified
        });
      }
    }
  }
  return refs;
}
