import { NextResponse } from "next/server";
import { fetchSleeperPlayersMap } from "@/lib/sleeper/players";
import { insertPlayersSnapshot, pruneOldSnapshots } from "@/lib/sleeper/snapshot";

export const runtime = "nodejs";
export const maxDuration = 60;

const KEEP_LAST_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  // Vercel's Cron Jobs send `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { players, source } = await fetchSleeperPlayersMap();
  if (!players) {
    return NextResponse.json(
      { ok: false, error: "sleeper fetch failed", source },
      { status: 502 }
    );
  }

  const inserted = await insertPlayersSnapshot({ players });
  const pruned = await pruneOldSnapshots(KEEP_LAST_MS);

  return NextResponse.json({
    ok: true,
    snapshotId: inserted.id,
    sizeBytes: inserted.sizeBytes,
    playerCount: Object.keys(players).length,
    prunedCount: pruned,
    fetchedAt: inserted.fetchedAt.toISOString()
  });
}
