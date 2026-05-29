import { NextResponse } from "next/server";
import { fetchEspnNews } from "@/lib/espn/news";
import { insertNewsSnapshot, pruneOldNewsSnapshots } from "@/lib/espn/newsSnapshot";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fixed source key — one canonical row per day. Pruning keeps 7 days so the
// newsMatch module can always read the latest snapshot even if the cron skips
// a day.
const NEWS_SOURCE = "espn-nfl";
const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000;

function redact(raw: string): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgres://[REDACTED]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .slice(0, 400);
}

/**
 * Daily ESPN NFL news snapshot. Fetches up to 100 NFL articles from the
 * public ESPN news API (no auth required), inserts a snapshot row, and
 * prunes rows older than 7 days.
 *
 * Route gated by the Vercel CRON_SECRET Bearer token to prevent manual
 * trigger abuse. Off-season is not a concern — ESPN publishes offseason
 * NFL news year-round.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { articles, error } = await fetchEspnNews({ limit: 100 });

    if (error && articles.length === 0) {
      return NextResponse.json(
        { ok: false, error: redact(error) },
        { status: 502 }
      );
    }

    const inserted = await insertNewsSnapshot({ source: NEWS_SOURCE, articles });
    const pruned = await pruneOldNewsSnapshots(NEWS_SOURCE, KEEP_LAST_MS);

    return NextResponse.json({
      ok: true,
      partial: !!error,
      articleCount: articles.length,
      sizeBytes: inserted.sizeBytes,
      snapshotId: inserted.id,
      prunedCount: pruned,
      fetchError: error ?? null,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: redact(raw) },
      { status: 500 }
    );
  }
}
