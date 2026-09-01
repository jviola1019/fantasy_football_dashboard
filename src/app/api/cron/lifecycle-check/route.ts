import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cronAuth";
import { getDb, schema } from "@/db";
import {
  evaluateLifecycleRules,
  reconcileLifecycleNotifications
} from "@/lib/lifecycle/notifications";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { myFaabBudget } from "@/lib/leagues/faab";
import { getCurrentNflSeason } from "@/lib/schedule/season";
import { pruneThrottle, THROTTLE_RETENTION_MS } from "@/lib/auth/throttle";
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
  const denied = requireCronAuth(request);
  if (denied) return denied;

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
  let resolvedCount = 0;
  const ruleCounts: Record<string, number> = {};
  /** Rule families left UNKNOWN this run because their upstream was unusable. */
  const unknownFamilies: Record<string, number> = {};
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

    const evaluation = evaluateLifecycleRules({
      userId: league.userId,
      leagueId: league.id,
      roster: snapshot.myRoster,
      byeSchedule,
      // S4: read off the same league-wide budget object /waivers draws, so the
      // alert and the panel can never describe different numbers. Null when the
      // user's own team could not be identified — an unresolved identity must
      // not alert on a stranger's budget.
      faabRemainingRatio: myFaabBudget(snapshot.faab)?.ratio ?? null,
      injuredStarters,
      // Audit 2026-08-20 §9: pass the snapshot's OWN injury-evidence state so the
      // engine can only resolve injury alerts when the status behind them was
      // actually verified. Previously the family was judged reconcilable on a
      // non-empty roster, so a stale or missing players snapshot cleared real
      // alerts.
      injuryEvidence: snapshot.injuryEvidence
    });

    // Audit P1 §6: upserting alone left conditions that had STOPPED being true
    // marked active forever. Reconciliation closes them — but only for the rule
    // families this run could actually judge. A family whose upstream failed is
    // unknown, and unknown must never be written down as resolved.
    const outcome = await reconcileLifecycleNotifications(
      { userId: league.userId, leagueId: league.id, evaluation },
      db
    );

    writtenCount += outcome.upserted;
    resolvedCount += outcome.resolved;
    for (const family of outcome.skipped) {
      unknownFamilies[family] = (unknownFamilies[family] ?? 0) + 1;
    }
    for (const n of evaluation.drafted) {
      ruleCounts[n.rule] = (ruleCounts[n.rule] ?? 0) + 1;
    }
  }

  // Housekeeping. auth_attempts had NO pruning wired anywhere — pruneThrottle
  // existed with zero callers — so the table grew a row per (account, IP,
  // global) key per window, forever. It rides this cron rather than an eighth
  // Vercel cron because the Hobby plan caps them and this is the last daily job
  // to run. A failure here must not fail the lifecycle run.
  let throttleRowsPruned: number | null = null;
  try {
    throttleRowsPruned = await pruneThrottle(new Date(Date.now() - THROTTLE_RETENTION_MS), db);
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "throttle-prune-failed",
        reason: err instanceof Error ? err.message : "unknown"
      })
    );
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
    throttleRowsPruned,
    leaguesScanned: leagues.length,
    notificationsWritten: writtenCount,
    notificationsResolved: resolvedCount,
    leaguesSkipped: skippedCount,
    byRule: ruleCounts,
    // Surfaced rather than silent: a family that stays here run after run means
    // an upstream is persistently broken and those alerts are frozen, not clean.
    unknownRuleFamilies: unknownFamilies,
    failures,
    ranAt: new Date().toISOString()
  });
}
