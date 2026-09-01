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
import { type WeeklyProjectionByFormat } from "@/lib/leagues/scoringPoints";
import { getLatestSeasonStatsSnapshot } from "@/lib/sleeper/seasonStatsSnapshot";
import { getLatestOpportunitySnapshot } from "@/lib/nflverse/opportunitySnapshot";
import { infraNull } from "./infraNull";
import { buildLeagueUniverse, UNIVERSE_LIMIT } from "@/lib/leagues/buildUniverse";
import { buildLiveEnvelope, rankingsSourceFromSnapshot } from "@/lib/leagues/toEnvelope";
import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";
import { getTrendingPlayers } from "@/lib/sleeper/players";
import { buildTrendingMap } from "@/lib/sleeper/trendingProxy";
import { getActiveLeagueId } from "@/lib/activeLeague";
import { getNflState } from "@/lib/sleeper/league";
import { getLatestProjectionsSnapshot } from "@/lib/sleeper/projectionsSnapshot";
import { snapshotToWeeklyProjections } from "@/lib/sleeper/projections";
import { getLatestNewsSnapshot } from "@/lib/espn/newsSnapshot";
import {
  buildNewsWeightMap,
  normaliseMomentumScores,
  buildPlayerNewsIndex,
  type PlayerNewsIndex
} from "@/lib/espn/newsMatch";
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
 *      WARNING (DAT-04): without RAE_ALLOW_FIXTURES this yields the honest but
 *      EMPTY identity-only envelope (mode "unavailable", zero records) for every
 *      visitor — market intelligence is never fabricated from identity data
 *      alone. It is a kill-switch/ops probe, not a demo mode; leave it unset in
 *      normal operation.
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
        // Each read degrades to null (the UI renders "unavailable" honestly)
        // but logs once via infraNull — the store returns null for legitimate
        // absence, so a REJECTION here is infrastructure-shaped (the
        // opportunity_snapshots missing-table bug hid for months behind bare
        // `.catch(() => null)`s). Rankings degrades like its siblings instead
        // of aborting the whole live path to fixture.
        const [rankings, trendingAddsResult, trendingDropsResult, nflState, newsSnapshot, playersSnapshot, oppSnapshot] =
          await Promise.all([
            getLatestRankingsSnapshot(scoring).catch(infraNull("rankings")),
            getTrendingPlayers("add", 24, 100).catch(infraNull("trending-adds")),
            getTrendingPlayers("drop", 24, 100).catch(infraNull("trending-drops")),
            getNflState().catch(infraNull("nfl-state")),
            getLatestNewsSnapshot("espn-nfl").catch(infraNull("news")),
            getLatestPlayersSnapshot().catch(infraNull("players")),
            getLatestOpportunitySnapshot("nfl").catch(infraNull("opportunity"))
          ]);

        // Season-to-date actuals, keyed by the season Sleeper itself reports.
        // Keyed by SEASON deliberately: last year's totals are not this year's
        // points-to-date, and reading them as such is the P0-5 error.
        const seasonStats = nflState?.data?.season
          ? await getLatestSeasonStatsSnapshot(nflState.data.season).catch(infraNull("season-stats"))
          : null;
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
        // S4: the SAME snapshot, grouped rather than only counted. Until now
        // this block reduced the articles to one number per player and dropped
        // them — the product computed a "Trending" figure from real headlines
        // and then showed the reader neither the headline nor a way to reach it.
        let playerNews: PlayerNewsIndex | null = null;
        let playerNewsMeta: RAEEnvelope["playerNewsMeta"] = null;
        if (newsSnapshot && playersSnapshot) {
          const players = playersSnapshot.players as Record<string, Record<string, unknown>>;
          const weightMap = buildNewsWeightMap(newsSnapshot.articles, players);
          const scores = normaliseMomentumScores(weightMap);
          if (Object.keys(scores).length > 0) newsMomentumScores = scores;
          const index = buildPlayerNewsIndex(newsSnapshot.articles, players);
          const coveredPlayers = Object.keys(index).length;
          // The meta ships even when nothing matched: "0 of 100 articles could
          // be attributed" is a real, useful state, and suppressing it would
          // leave the panel unable to distinguish "no news" from "no snapshot".
          playerNews = index;
          playerNewsMeta = {
            source: "ESPN NFL news",
            fetchedAt: newsSnapshot.fetchedAt.toISOString(),
            articleCount: newsSnapshot.articles.length,
            coveredPlayers
          };
        }

        // Weekly projections for the current regular-season week. Off-season or
        // pre-cron: both stay null and the sim falls back to season-aggregate.
        //
        // Audit 2026-08-20 §7: all three scoring variants travel to the
        // simulation boundary. This loader deliberately does NOT collapse them
        // to one number — that collapse used to happen here, against a
        // `scoring` value resolved in this file, while the OPPONENT FIELD
        // baseline was resolved separately in deriveAppData. Two independent
        // reads of the league format could disagree, and nothing in the types
        // said which unit the surviving number was in. The selection now
        // happens once, inside the simulator, from the same `scoringFormat`
        // that sets the field baseline.
        let weeklyProjections: Record<string, WeeklyProjectionByFormat> | null = null;
        let weeklyProjectionsMeta: { season: string; week: number; fetchedAt: string } | null = null;
        const nflData = nflState?.data;
        if (nflData?.season_type === "regular" && nflData.week >= 1) {
          const projSnapshot = await getLatestProjectionsSnapshot(nflData.season, nflData.week).catch(
            infraNull("projections")
          );
          if (projSnapshot) {
            const byFormat = snapshotToWeeklyProjections(projSnapshot.data);
            if (Object.keys(byFormat).length > 0) {
              weeklyProjections = byFormat;
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
            playerNews,
            playerNewsMeta,
            playersSnapshot: playersSnapshot?.players ?? null,
            currentSeason: nflData?.season,
            opportunityScores: oppSnapshot?.scores ?? null,
            // P0-5: the age travels WITH the scores. Dropping it here is what let
            // a snapshot of any age be presented as current usage.
            opportunityFetchedAt: oppSnapshot?.fetchedAt ?? null,
            opportunityDataSeason: oppSnapshot?.dataSeason ?? null,
            // The other half of the validated model. Null until the
            // stats-refresh cron has run; `rankInSeason` then declines to rank
            // rather than ranking on half the model.
            seasonStats: seasonStats?.stats ?? null
          }),
          leagueOptions,
          activeLeagueId
        };
      }
    }
  } catch (err) {
    // Live envelope path failed (auth / DB / a code bug in the build chain).
    // Falling through to the labeled fixture keeps the public surface up —
    // but a signed-in user silently demoted to DEMO data with no log was the
    // worst failure mode this file had, so say so to the operator.
    console.error("[envelope] live path failed; serving fixture fallback:", err);
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
      getLatestRankingsSnapshot("PPR").catch(infraNull("demo-rankings")),
      getLatestPlayersSnapshot().catch(infraNull("demo-players"))
    ]);
    if (rankings?.data && playersSnap) {
      const src = rankingsSourceFromSnapshot("PPR", rankings.fetchedAt);
      const universe = buildLeagueUniverse(playersSnap.players, rankings.data, { rankingsSource: src })
        .sort((a, b) => b.trueValue - a.trueValue)
        .slice(0, UNIVERSE_LIMIT);
      if (universe.length > 0) {
        return { ...base, leagueUniverse: universe, draftPool: universe };
      }
    }
  } catch (err) {
    // The inner infraNull catches make this outer catch unreachable for
    // snapshot reads — anything landing here is a code bug (e.g. in
    // buildLeagueUniverse), which is exactly what should be logged. The
    // plain labeled demo fixture still renders.
    console.error("[envelope] demo universe enrichment failed; plain fixture:", err);
  }
  return base;
}

/**
 * Request-cached envelope resolver shared by the app-shell layout and every
 * route segment. `cache()` dedupes within a single request so the nine routes
 * never re-resolve the (expensive) live/demo envelope more than once.
 */
export const loadEnvelope = cache(resolveEnvelope);
