import { describe, it, expect, vi } from "vitest";
import {
  EspnNewsArticleSchema,
  EspnNewsResponseSchema,
  fetchEspnNews,
  extractAthleteRefs,
  type EspnNewsArticle
} from "./news";

const athleteArticle: EspnNewsArticle = {
  id: 48904404,
  headline: "Garrett Wilson talks Knicks",
  lastModified: "2026-05-29T00:13:49Z",
  published: "2026-05-29T00:13:49Z",
  categories: [
    { type: "athlete", athleteId: 4569618, description: "Garrett Wilson" },
    { type: "team", teamId: 20, description: "New York Jets" } as never
  ]
};

const noAthleteArticle: EspnNewsArticle = {
  id: 12345,
  headline: "League transactions update",
  lastModified: "2026-05-28T12:00:00Z",
  categories: [{ type: "league" } as never]
};

describe("EspnNewsArticleSchema", () => {
  it("parses a complete article with athlete categories", () => {
    const result = EspnNewsArticleSchema.safeParse(athleteArticle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(48904404);
      expect(result.data.categories).toHaveLength(2);
    }
  });

  it("allows missing categories (defaults to empty array)", () => {
    const noCats = { id: 1, headline: "test", lastModified: "2026-01-01T00:00:00Z" };
    const result = EspnNewsArticleSchema.safeParse(noCats);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toEqual([]);
    }
  });

  it("allows missing description and published", () => {
    const minimal = { id: 2, headline: "x", lastModified: "2026-01-01T00:00:00Z" };
    const result = EspnNewsArticleSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects record missing id", () => {
    const bad = { headline: "no id", lastModified: "2026-01-01T00:00:00Z" };
    const result = EspnNewsArticleSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("EspnNewsResponseSchema", () => {
  it("parses a response with articles array", () => {
    const result = EspnNewsResponseSchema.safeParse({ articles: [athleteArticle] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.articles).toHaveLength(1);
    }
  });

  it("parses empty articles array", () => {
    const result = EspnNewsResponseSchema.safeParse({ articles: [] });
    expect(result.success).toBe(true);
  });
});

describe("extractAthleteRefs", () => {
  it("extracts athleteId from athlete-type categories", () => {
    const refs = extractAthleteRefs([athleteArticle]);
    expect(refs).toHaveLength(1);
    expect(refs[0].athleteId).toBe(4569618);
    expect(refs[0].articleId).toBe(48904404);
    expect(refs[0].lastModified).toBe("2026-05-29T00:13:49Z");
  });

  it("ignores non-athlete categories", () => {
    const refs = extractAthleteRefs([noAthleteArticle]);
    expect(refs).toHaveLength(0);
  });

  it("extracts multiple athletes from one article", () => {
    const multi: EspnNewsArticle = {
      ...athleteArticle,
      id: 999,
      categories: [
        { type: "athlete", athleteId: 111 },
        { type: "athlete", athleteId: 222 },
        { type: "team" } as never
      ]
    };
    const refs = extractAthleteRefs([multi]);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.athleteId)).toEqual([111, 222]);
  });

  it("returns empty array for no articles", () => {
    expect(extractAthleteRefs([])).toEqual([]);
  });
});

describe("fetchEspnNews", () => {
  it("returns articles on success", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ articles: [athleteArticle, noAthleteArticle] })
    });

    const { articles, error } = await fetchEspnNews({
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(error).toBeUndefined();
    expect(articles).toHaveLength(2);
    expect(mockFetcher).toHaveBeenCalledWith(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100"
    );
  });

  it("uses custom limit in URL", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ articles: [] })
    });

    await fetchEspnNews({ limit: 50, fetcher: mockFetcher as unknown as typeof fetch });
    expect(mockFetcher).toHaveBeenCalledWith(expect.stringContaining("limit=50"));
  });

  it("returns error string on HTTP failure", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const { articles, error } = await fetchEspnNews({
      fetcher: mockFetcher as unknown as typeof fetch
    });
    expect(articles).toHaveLength(0);
    expect(error).toMatch(/503/);
  });

  it("returns error string on schema mismatch", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notArticles: [] })
    });
    const { articles, error } = await fetchEspnNews({
      fetcher: mockFetcher as unknown as typeof fetch
    });
    expect(articles).toHaveLength(0);
    expect(error).toMatch(/schema/);
  });

  it("returns error string on network failure", async () => {
    const mockFetcher = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { articles, error } = await fetchEspnNews({
      fetcher: mockFetcher as unknown as typeof fetch
    });
    expect(articles).toHaveLength(0);
    expect(error).toMatch(/ECONNREFUSED/);
  });
});
