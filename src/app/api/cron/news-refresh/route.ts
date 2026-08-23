import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/timingSafe";
import { fetchEspnNews } from "@/lib/espn/news";
import { insertNewsSnapshot, pruneOldNewsSnapshots } from "@/lib/espn/newsSnapshot";
import { redact } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fixed source key — one canonical row per day. Pruning keeps 7 days so the
// newsMatch module can always read the latest snapshot even if the cron skips
// a day.
const NEWS_SOURCE = "espn-nfl";
const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (!safeEqual(auth ?? "", `Bearer ${expected}`)) {
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

    // An empty snapshot is not a snapshot.
    //
    // Audit 2026-08-22, P1-5. A fetch that "succeeded" with zero articles used
    // to be written and reported ok:true. That is the worst of both worlds: the
    // feature is dark, AND the freshness clock has just been reset, so
    // /api/health reports the source as current and nothing anywhere says the
    // news signal has no articles behind it. ESPN publishes NFL news
    // year-round, so zero articles from a limit-100 request means the endpoint
    // or the payload shape changed — a failure that happens to have returned
    // HTTP 200.
    //
    // Refusing to write leaves the PREVIOUS snapshot in place, which is both
    // more useful and more honest: it ages visibly against its contract instead
    // of being replaced by nothing that looks new.
    if (articles.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ESPN returned zero articles; refusing to write an empty snapshot over the last good one",
          fetchError: error ? redact(error) : null
        },
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
