import { cache } from "react";
import { type LeagueOption } from "@/components/topbar/LeagueSwitcher";
import { NoLeagueCTA } from "@/components/NoLeagueCTA";
import { fixtureEnvelope } from "@/lib/fixtures";
import { RAEEnvelopeSchema, type RAEEnvelope } from "@/lib/governance";
import { loadRAEEnvelope } from "@/lib/sleeper";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues } from "@/lib/leagues";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { pickProjectionPoints } from "@/lib/leagues/scoringPoints";
import { getLatestOpportunitySnapshot } from "@/lib/nflverse/opportunitySnapshot";
import { buildLeagueUniverse } from "@/lib/leagues/buildUniverse";
import { buildLiveEnvelope, rankingsSourceFromSnapshot } from "@/lib/leagues/toEnvelope";
import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";
import { getTrendingPlayers } from "@/lib/sleeper/players";
import { buildTrendingMap } from "@/lib/sleeper/trendingProxy";
import { getActiveLeagueId } from "@/lib/activeLeague";
import { getNflState } from "@/lib/sleeper/league";
import { getLatestProjectionsSnapshot } from "@/lib/sleeper/projectionsSnapshot";
import { getLatestNewsSnapshot } from "@/lib/espn/newsSnapshot";
import { buildNewsWeightMap, normaliseMomentumScores } from "@/lib/espn/newsMatch";
import { getLatestPlayersSnapshot } from "@/lib/sleeper/snapshot";

// NoLeagueCTA is re-exported so the thin route pages can render it without
// importing two modules; it is the single source of the "no-league" surface.
export { NoLeagueCTA };

/**
 * Resolution for the signed-in homepage/app shell. `no-league` is the sentinel
 * for a signed-in user with zero connected leagues (the route renders
 * <NoLeagueCTA/> instead of the app).
 */
export type HomeResolution =
  | {
      kind: "envelope";
      envelope: RAEEnvelope;
      leagueOptions: LeagueOption[];
      activeLeagueId: string | null;
    }
  | { kind: "no-league" };

/**
 * Resolve the governed envelope that drives EVERY app route for this request.
 *
 * Moved verbatim from the former `app/page.tsx` `resolveHome()` so behavior is
 * preserved exactly; wrapped in React `cache()` (see {@link loadEnvelope}) so
 * the multi-route app shell + each route segment share ONE resolution per
 * request instead of re-fetching the 19 MB Sleeper catalog per page.
 *
 * Render priority:
 *   1. RAE_ENABLE_LIVE_HOMEPAGE=true → ops override (skips per-user path).
 *   2. Signed-in user with ≥1 league → real live envelope.
 *   3. Signed-in user with 0 leagues → "no-league".
 *   4. Anonymous → demo fixture envelope (real searchable universe when cached).
 *
 * Pure async data-loader — never constructs JSX (JSX inside try/catch silently
 * swallows Server Component render errors).
 */
async function resolveEnvelope(): Promise<HomeResolution> {
  if (process.env.RAE_ENABLE_LIVE_HOMEPAGE === "true") {
    return {
      kind: "envelope",
      envelope: await loadRAEEnvelope({
        allowFixtures: process.env.RAE_ALLOW_FIXTURES === "true"
      }),
      leagueOptions: [],
      activeLeagueId: null
    };
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId) {
      const db = getDb();
      const leagues = await listLeagues(db, userId);
      if (leagues.length === 0) {
        return { kind: "no-league" };
      }
      // Resolve the active league from the cookie. Falls back to leagues[0]
      // when the cookie is absent, malformed, or points at a league that no
      // longer belongs to this user.
      const cookieActive = await getActiveLeagueId(userId);
      const activeLeagueId = cookieActive ?? leagues[0]!.id;
      const leagueOptions: LeagueOption[] = leagues.map((l) => ({
        id: l.id,
        label: l.label,
        platform: l.platform,
        season: l.season
      }));
      const live = await fetchLeagueLive(userId, activeLeagueId, db);
      // Proceed when there's a real roster OR a parsed league format — the
      // latter lets a pre-draft / brand-new empty league (no rosters yet) still
      // render a live envelope with the full draftable universe.
      if (live && (live.myRoster.length > 0 || live.format !== null)) {
        const scoring = live.format?.scoringFormat ?? "PPR";
        const [rankings, trendingAddsResult, trendingDropsResult, nflState, newsSnapshot, playersSnapshot, oppSnapshot] =
          await Promise.all([
            getLatestRankingsSnapshot(scoring),
            getTrendingPlayers("add", 24, 100).catch(() => null),
            getTrendingPlayers("drop", 24, 100).catch(() => null),
            getNflState().catch(() => null),
            getLatestNewsSnapshot("espn-nfl").catch(() => null),
            getLatestPlayersSnapshot().catch(() => null),
            getLatestOpportunitySnapshot("nfl").catch(() => null)
          ]);
        const trendingAdds = buildTrendingMap(trendingAddsResult?.data ?? null);
        const trendingDrops = buildTrendingMap(trendingDropsResult?.data ?? null);
        const rankingsSource = rankings
          ? rankingsSourceFromSnapshot(scoring, rankings.fetchedAt)
          : rankingsSourceFromSnapshot(
              scoring,
              null,
              "rankings cache empty — cron may not have fired yet"
            );

        // ESPN news momentum (preferred over the Sleeper trending proxy when
        // available; enrich.ts handles priority). Both fail open to null.
        let newsMomentumScores: Record<string, number> | null = null;
        if (newsSnapshot && playersSnapshot) {
          const weightMap = buildNewsWeightMap(
            newsSnapshot.articles,
            playersSnapshot.players as Record<string, Record<string, unknown>>
          );
          const scores = normaliseMomentumScores(weightMap);
          if (Object.keys(scores).length > 0) newsMomentumScores = scores;
        }

        // Weekly projections for the current regular-season week. Off-season or
        // pre-cron: both stay null and the sim falls back to season-aggregate.
        let weeklyProjections: Record<string, number> | null = null;
        let weeklyProjectionsMeta: { season: string; week: number; fetchedAt: string } | null = null;
        const nflData = nflState?.data;
        if (nflData?.season_type === "regular" && nflData.week >= 1) {
          const projSnapshot = await getLatestProjectionsSnapshot(nflData.season, nflData.week).catch(() => null);
          if (projSnapshot) {
            const pts: Record<string, number> = {};
            for (const [id, p] of Object.entries(projSnapshot.data.projections)) {
              const v = pickProjectionPoints(p, scoring);
              if (v != null) pts[id] = v;
            }
            if (Object.keys(pts).length > 0) {
              weeklyProjections = pts;
              weeklyProjectionsMeta = {
                season: nflData.season,
                week: nflData.week,
                fetchedAt: projSnapshot.fetchedAt.toISOString()
              };
            }
          }
        }

        return {
          kind: "envelope",
          envelope: buildLiveEnvelope({
            snapshot: live,
            rankings: rankings?.data ?? null,
            rankingsSource,
            trendingAdds,
            trendingDrops,
            weeklyProjections,
            weeklyProjectionsMeta,
            newsMomentumScores,
            playersSnapshot: playersSnapshot?.players ?? null,
            currentSeason: nflData?.season,
            opportunityScores: oppSnapshot?.scores ?? null
          }),
          leagueOptions,
          activeLeagueId
        };
      }
    }
  } catch {
    // Live envelope path failed (auth / DB / cron). Fall through to fixture so
    // the public surface stays up.
  }

  return {
    kind: "envelope",
    envelope: await publicDemoEnvelope(),
    leagueOptions: [],
    activeLeagueId: null
  };
}

/**
 * The anonymous/demo envelope. The roster-driven tiles stay the labeled DEMO
 * fixture, but when the daily crons have cached FantasyPros rankings + the
 * Sleeper players map we attach the FULL, REAL, searchable player universe so
 * Player Universe and the draft board let a logged-out visitor explore and
 * search every player — not just the 8-player showcase.
 */
export async function publicDemoEnvelope(): Promise<RAEEnvelope> {
  const base = RAEEnvelopeSchema.parse(fixtureEnvelope());
  try {
    const [rankings, playersSnap] = await Promise.all([
      getLatestRankingsSnapshot("PPR").catch(() => null),
      getLatestPlayersSnapshot().catch(() => null)
    ]);
    if (rankings?.data && playersSnap) {
      const src = rankingsSourceFromSnapshot("PPR", rankings.fetchedAt);
      const universe = buildLeagueUniverse(playersSnap.players, rankings.data, { rankingsSource: src })
        .sort((a, b) => b.trueValue - a.trueValue)
        .slice(0, 600);
      if (universe.length > 0) {
        return { ...base, leagueUniverse: universe, draftPool: universe };
      }
    }
  } catch {
    // No cached snapshots (e.g. local dev before a cron) — plain demo fixture.
  }
  return base;
}

/**
 * Request-cached envelope resolver shared by the app-shell layout and every
 * route segment. `cache()` dedupes within a single request so the nine routes
 * never re-resolve the (expensive) live/demo envelope more than once.
 */
export const loadEnvelope = cache(resolveEnvelope);
