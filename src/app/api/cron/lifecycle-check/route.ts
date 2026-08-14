import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/timingSafe";
import { getDb, schema } from "@/db";
import { evaluateLifecycleRules, upsertNotification } from "@/lib/lifecycle/notifications";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { getCurrentNflSeason } from "@/lib/schedule/season";
import {
  describeByeUnavailability,
  fetchByeSchedule,
  type ByeSchedule
} from "@/lib/schedule/byeSchedule";

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
 *
 * Audit 2026-08-06 F-002: the season and bye schedule are resolved ONCE per run,
 * before the league loop, and both are reported in the response. If the schedule
 * cannot be verified for the current season, bye notifications are suppressed for
 * the whole run rather than falling back to stale data.
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

  const db = getDb();

  // Resolve season + bye schedule once for the run. Both are network calls; doing
  // them per league would multiply cost and could produce an inconsistent view
  // across leagues within a single run.
  const seasonState = await getCurrentNflSeason();
  const byeSchedule: ByeSchedule = seasonState
    ? await fetchByeSchedule(seasonState.season)
    : {
        status: "unavailable",
        season: null,
        reason: "season-unresolved",
        detail: "Sleeper /v1/state/nfl did not return a usable season",
        provenance: {}
      };

  if (byeSchedule.status !== "verified") {
    // Non-secret operational event: bye advice is suppressed this run.
    console.warn(
      JSON.stringify({
        event: "bye-schedule-unverified",
        season: byeSchedule.season,
        reason: byeSchedule.reason,
        detail: byeSchedule.detail
      })
    );
  }

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
      byeSchedule,
      faabRemainingRatio: snapshot.myFaabRemainingRatio,
      injuredStarters
    });

    for (const n of drafted) {
      await upsertNotification(n, db);
      writtenCount += 1;
      ruleCounts[n.rule] = (ruleCounts[n.rule] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ok: true,
    season: seasonState
      ? { season: seasonState.season, phase: seasonState.phase, week: seasonState.week }
      : null,
    byeSchedule:
      byeSchedule.status === "verified"
        ? {
            status: "verified" as const,
            season: byeSchedule.season,
            teams: Object.keys(byeSchedule.byes).length,
            source: byeSchedule.provenance.source,
            retrievedAt: byeSchedule.provenance.retrievedAt
          }
        : {
            status: "unavailable" as const,
            season: byeSchedule.season,
            reason: byeSchedule.reason,
            explanation: describeByeUnavailability(byeSchedule)
          },
    leaguesScanned: leagues.length,
    notificationsWritten: writtenCount,
    leaguesSkipped: skippedCount,
    byRule: ruleCounts,
    failures,
    ranAt: new Date().toISOString()
  });
}
