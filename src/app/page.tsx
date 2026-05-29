import { RaeApp, type LeagueOption } from "@/components/RaeApp";
import { NoLeagueCTA } from "@/components/NoLeagueCTA";
import { fixtureEnvelope } from "@/lib/fixtures";
import { RAEEnvelopeSchema, type RAEEnvelope } from "@/lib/governance";
import { loadRAEEnvelope } from "@/lib/sleeper";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues } from "@/lib/leagues";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { buildLiveEnvelope, rankingsSourceFromSnapshot } from "@/lib/leagues/toEnvelope";
import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";
import { getTrendingPlayers } from "@/lib/sleeper/players";
import { buildTrendingMap } from "@/lib/sleeper/trendingProxy";
import { getActiveLeagueId } from "@/lib/activeLeague";
import { getNflState } from "@/lib/sleeper/league";
import { getLatestProjectionsSnapshot } from "@/lib/sleeper/projectionsSnapshot";

// Force dynamic rendering so we never download the 19 MB Sleeper players catalog
// during build. With ISR (Vercel default for static pages), `next build` runs the
// page once and Vercel's data cache rejects items over 2 MB.
export const dynamic = "force-dynamic";

// Sentinel returned by resolveHomeEnvelope when a signed-in user has zero
// connected leagues. The Home() switchboard renders <NoLeagueCTA /> rather
// than passing this to <RaeApp />.
type HomeResolution =
  | {
      kind: "envelope";
      envelope: RAEEnvelope;
      leagueOptions: LeagueOption[];
      activeLeagueId: string | null;
    }
  | { kind: "no-league" };

// Resolve what should drive the homepage for this request.
// Pure async data-loader — never constructs JSX (react-hooks/error-boundaries
// rule: JSX inside try/catch silently swallows Server Component render
// errors).
async function resolveHome(): Promise<HomeResolution> {
  // Render priority:
  //   1. RAE_ENABLE_LIVE_HOMEPAGE=true → ops override (skips per-user path).
  //   2. Signed-in user with ≥1 league → real live envelope from their
  //      roster, FP consensus rankings, and Sleeper-trending trendingMomentum
  //      proxy.
  //   3. Signed-in user with 0 leagues → explicit "no-league" CTA state.
  //   4. Anonymous → demo fixture envelope (the public landing surface).

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
      // Resolve the active league from the cookie (Feature C). Falls back to
      // leagues[0] when the cookie is absent, malformed, or points at a
      // league that no longer belongs to this user.
      const cookieActive = await getActiveLeagueId(userId);
      const activeLeagueId = cookieActive ?? leagues[0]!.id;
      const leagueOptions: LeagueOption[] = leagues.map((l) => ({
        id: l.id,
        label: l.label,
        platform: l.platform
      }));
      const live = await fetchLeagueLive(userId, activeLeagueId, db);
      if (live && live.myRoster.length > 0) {
        // Fetch rankings, trending, and NFL state in parallel.
        // Each fails open so a partial outage doesn't tank the homepage.
        const [rankings, trendingAddsResult, trendingDropsResult, nflState] =
          await Promise.all([
            getLatestRankingsSnapshot("PPR"),
            getTrendingPlayers("add", 24, 100).catch(() => null),
            getTrendingPlayers("drop", 24, 100).catch(() => null),
            getNflState().catch(() => null)
          ]);
        const trendingAdds = buildTrendingMap(trendingAddsResult?.data ?? null);
        const trendingDrops = buildTrendingMap(trendingDropsResult?.data ?? null);
        const rankingsSource = rankings
          ? rankingsSourceFromSnapshot("PPR", rankings.fetchedAt)
          : rankingsSourceFromSnapshot(
              "PPR",
              null,
              "rankings cache empty — cron may not have fired yet"
            );

        // Resolve weekly projections for the current regular-season week.
        // Off-season or when the cron hasn't fired: both stay null and the
        // NexusSimulator falls back to season-aggregate trueValue.
        let weeklyProjections: Record<string, number> | null = null;
        let weeklyProjectionsMeta: {
          season: string;
          week: number;
          fetchedAt: string;
        } | null = null;
        const nflData = nflState?.data;
        if (nflData?.season_type === "regular" && nflData.week >= 1) {
          const projSnapshot = await getLatestProjectionsSnapshot(
            nflData.season,
            nflData.week
          ).catch(() => null);
          if (projSnapshot) {
            const pts: Record<string, number> = {};
            for (const [id, p] of Object.entries(projSnapshot.data.projections)) {
              if (p.pts_ppr != null) pts[id] = p.pts_ppr;
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
            weeklyProjectionsMeta
          }),
          leagueOptions,
          activeLeagueId
        };
      }
    }
  } catch {
    // Live envelope path failed (auth / DB / cron). Fall through to fixture
    // so the public homepage stays up.
  }

  // Anonymous / catch-all fallback.
  return {
    kind: "envelope",
    envelope: RAEEnvelopeSchema.parse(fixtureEnvelope()),
    leagueOptions: [],
    activeLeagueId: null
  };
}

export default async function Home() {
  const resolution = await resolveHome();
  if (resolution.kind === "no-league") return <NoLeagueCTA />;
  return (
    <RaeApp
      envelope={resolution.envelope}
      leagueOptions={resolution.leagueOptions}
      activeLeagueId={resolution.activeLeagueId}
    />
  );
}
