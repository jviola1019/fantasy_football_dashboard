import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cronAuth";
import { fetchSeasonStats } from "@/lib/sleeper/seasonStats";
import {
  insertSeasonStatsSnapshot,
  pruneOldSeasonStatsSnapshots
} from "@/lib/sleeper/seasonStatsSnapshot";
import { getNflState } from "@/lib/sleeper/league";
import { redact } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Keep a week of snapshots so a missed run still leaves something readable. */
const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Season-to-date ACTUAL scoring, per player.
 *
 * The half of the validated model that did not exist. Protocols 4 and 5 showed
 * that in-season usage predicts rest-of-season scoring **beyond points already
 * scored** — and RAE had usage and no points-to-date, so the one signal that
 * survived out-of-sample testing could not be shipped. The validation dossier
 * said so plainly: *"validated for a model RAE has not built."*
 *
 * Gated by the shared cron Bearer check. Refuses to write an empty snapshot,
 * because that resets the freshness clock while the feature goes dark (P1-5).
 */
export async function GET(request: Request): Promise<Response> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    // The season comes from Sleeper's own state, never from a hardcoded year —
    // a hardcoded season is how the bye-week engine once fired against the
    // wrong year with no way for a caller to know (see notifications.ts).
    const state = await getNflState();
    const season = state.data?.season;
    if (!season) {
      return NextResponse.json(
        { ok: false, error: "could not resolve the current NFL season from Sleeper state" },
        { status: 502 }
      );
    }

    const { stats, source, error } = await fetchSeasonStats(season);
    if (!stats) {
      return NextResponse.json(
        { ok: false, season, source, error: error ? redact(error) : "unknown fetch failure" },
        { status: 502 }
      );
    }

    const playerCount = Object.keys(stats).length;
    // Belt and braces: `fetchSeasonStats` already refuses an empty map, and this
    // says so again at the write boundary, which is where the damage happens.
    if (playerCount === 0) {
      return NextResponse.json(
        { ok: false, season, error: "refusing to write an empty snapshot over the last good one" },
        { status: 502 }
      );
    }

    const inserted = await insertSeasonStatsSnapshot({ season, stats });
    const pruned = await pruneOldSeasonStatsSnapshots(season, KEEP_LAST_MS);

    return NextResponse.json({
      ok: true,
      season,
      playerCount,
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
