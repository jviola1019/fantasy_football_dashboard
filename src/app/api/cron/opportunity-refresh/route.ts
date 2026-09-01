import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cronAuth";
import { fetchOpportunity } from "@/lib/nflverse/opportunity";
import {
  insertOpportunitySnapshot,
  pruneOldOpportunitySnapshots,
  ensureOpportunityTable
} from "@/lib/nflverse/opportunitySnapshot";
import { getNflState } from "@/lib/sleeper/league";
import { redact } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

const KEEP_LAST_MS = 14 * 24 * 60 * 60 * 1000;
// Fixed source key so readers (the homepage envelope) always find the latest
// snapshot without knowing which season the cron resolved.
const OPP_SOURCE = "nfl";

/**
 * Opportunity snapshot from FREE nflverse snap counts (no key, CC-BY). Resolves
 * the season via getNflState, falling back to the prior season off-season (the
 * current season's snap data does not exist until games are played). Inserts a
 * normalized-name → opportunity-score map; prunes rows older than 14 days.
 *
 * Gated by the Vercel CRON_SECRET Bearer token.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    await ensureOpportunityTable();
    const state = await getNflState().catch(() => null);
    const live = state?.data?.season ?? String(new Date().getUTCFullYear());
    const seasonType = state?.data?.season_type ?? "regular";

    // Off-season / pre-week-1: the current season has no snap data yet — use the
    // prior completed season so opportunity is still real, just last-season's role.
    const primary = seasonType === "regular" ? live : String(Number(live) - 1);
    let scores = await fetchOpportunity(primary);
    let usedSeason = primary;
    if (Object.keys(scores).length === 0 && primary !== String(Number(live) - 1)) {
      usedSeason = String(Number(live) - 1);
      scores = await fetchOpportunity(usedSeason);
    }

    if (Object.keys(scores).length === 0) {
      return NextResponse.json(
        { ok: false, error: "nflverse returned no opportunity rows" },
        { status: 502 }
      );
    }

    // `usedSeason` is persisted, not merely reported. It used to appear only in
    // this response body, so the envelope had no way to know whether it was
    // holding current-season usage or last season's fallback, and disclosed
    // snapshot AGE as if it settled the question (audit 2026-08-31, D-C).
    const inserted = await insertOpportunitySnapshot({
      source: OPP_SOURCE,
      scores,
      dataSeason: usedSeason
    });
    const pruned = await pruneOldOpportunitySnapshots(OPP_SOURCE, KEEP_LAST_MS);

    return NextResponse.json({
      ok: true,
      season: usedSeason,
      playerCount: Object.keys(scores).length,
      sizeBytes: inserted.sizeBytes,
      snapshotId: inserted.id,
      prunedCount: pruned,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: redact(raw) }, { status: 500 });
  }
}
