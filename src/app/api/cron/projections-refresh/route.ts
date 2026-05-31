import { NextResponse } from "next/server";
import {
  buildSnapshotPayload,
  fetchSleeperWeeklyProjections,
  PROJECTION_POSITIONS
} from "@/lib/sleeper/projections";
import {
  insertProjectionsSnapshot,
  pruneOldProjectionsSnapshots
} from "@/lib/sleeper/projectionsSnapshot";
import { getNflState } from "@/lib/sleeper/league";
import { redact, unwrap } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 60;

// Keep 14 days of snapshots so backtesting can replay recent weeks while the
// cron writes a fresh row each day. The latest-snapshot read is keyed by
// (season, week) so older rows don't shadow the fresh one.
const KEEP_LAST_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Daily Sleeper per-week projections snapshot. Resolves the current NFL week
 * via getNflState, then issues one request per position so a single-position
 * failure (e.g. K returning 5xx during a Sleeper deploy) doesn't lose the
 * rest of the snapshot.
 *
 * Off-season behaviour: when `state.season_type !== "regular"` Sleeper returns
 * empty projection arrays, so the cron records the no-op and returns 200 with
 * `skipped: true` rather than writing an empty row.
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

  // Resolve current week.
  let season: string;
  let week: number;
  let seasonType: string;
  try {
    const state = await getNflState();
    if (!state.data) {
      return NextResponse.json(
        { error: "could not resolve NFL state", source: state.source },
        { status: 502 }
      );
    }
    season = state.data.season;
    week = state.data.week;
    seasonType = state.data.season_type;
  } catch (err) {
    const root = unwrap(err);
    const raw = root instanceof Error ? root.message : String(root);
    return NextResponse.json(
      { error: redact(`getNflState failed: ${raw}`) },
      { status: 502 }
    );
  }

  // Off-season: Sleeper's projection endpoint returns empty arrays. Skip
  // honestly rather than writing a no-op row.
  if (seasonType !== "regular" || week < 1) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `season_type=${seasonType} week=${week}; projections endpoint is regular-season only`,
      season,
      week,
      fetchedAt: new Date().toISOString()
    });
  }

  try {
    const { byPosition, failures } = await fetchSleeperWeeklyProjections({
      season,
      week,
      positions: PROJECTION_POSITIONS
    });

    if (byPosition.size === 0) {
      return NextResponse.json(
        {
          ok: false,
          season,
          week,
          failures,
          error: "all positions failed"
        },
        { status: 502 }
      );
    }

    const payload = buildSnapshotPayload(season, week, byPosition);
    const playerCount = Object.keys(payload.projections).length;
    const inserted = await insertProjectionsSnapshot({ data: payload });
    const pruned = await pruneOldProjectionsSnapshots(season, week, KEEP_LAST_MS);

    return NextResponse.json({
      ok: failures.length === 0,
      partial: failures.length > 0,
      season,
      week,
      playerCount,
      positionCount: byPosition.size,
      sizeBytes: inserted.sizeBytes,
      snapshotId: inserted.id,
      prunedCount: pruned,
      failures,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const root = unwrap(err);
    const raw = root instanceof Error ? root.message : String(root);
    const code =
      root && typeof root === "object" && "code" in root && typeof (root as { code: unknown }).code === "string"
        ? (root as { code: string }).code
        : undefined;
    const name = root instanceof Error ? root.name : "Error";
    return NextResponse.json(
      {
        ok: false,
        season,
        week,
        error: redact(`[${name}${code ? ` ${code}` : ""}] ${raw}`)
      },
      { status: 500 }
    );
  }
}
