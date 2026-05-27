import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { evaluateLifecycleRules, insertNotification } from "@/lib/lifecycle/notifications";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runs once daily at 09:30 UTC (see vercel.ts crons). For every stored league:
 *   1. Decrypt credentials and fetch live rosters via `fetchLeagueLive`.
 *   2. Run the rules engine against the user's roster + injury list.
 *   3. Insert any drafted notifications.
 *
 * Scheduled after the data-feed crons (players-refresh 08:00, rankings 08:30,
 * KTC 09:00) so notifications are computed against the freshest snapshots.
 * Vercel's Hobby plan caps each cron at one run per day; Pro can tighten this.
 *
 * Authenticated by the Bearer token Vercel sends when CRON_SECRET is set.
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

  const db = getDb();
  const leagues = await db.select().from(schema.leagues);

  let writtenCount = 0;
  let skippedCount = 0;
  const ruleCounts: Record<string, number> = {};
  const failures: Array<{ leagueId: string; reason: string }> = [];

  for (const league of leagues) {
    let snapshot: Awaited<ReturnType<typeof fetchLeagueLive>> | null = null;
    try {
      snapshot = await fetchLeagueLive(league.userId, league.id, db);
    } catch (err) {
      failures.push({ leagueId: league.id, reason: err instanceof Error ? err.message : "unknown" });
      skippedCount += 1;
      continue;
    }

    if (!snapshot || snapshot.failure) {
      skippedCount += 1;
      if (snapshot?.failure) failures.push({ leagueId: league.id, reason: snapshot.failure });
      continue;
    }

    const injuredStarters = snapshot.myRoster.filter(
      (p) => p.status === "ir" || p.status === "out" || p.status === "questionable"
    );

    const drafted = evaluateLifecycleRules({
      userId: league.userId,
      leagueId: league.id,
      roster: snapshot.myRoster,
      faabRemainingRatio: snapshot.myFaabRemainingRatio,
      injuredStarters
    });

    for (const n of drafted) {
      await insertNotification(n, db);
      writtenCount += 1;
      ruleCounts[n.rule] = (ruleCounts[n.rule] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ok: true,
    leaguesScanned: leagues.length,
    notificationsWritten: writtenCount,
    leaguesSkipped: skippedCount,
    byRule: ruleCounts,
    failures,
    ranAt: new Date().toISOString()
  });
}
