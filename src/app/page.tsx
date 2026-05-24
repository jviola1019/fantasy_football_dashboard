import { RaeApp } from "@/components/RaeApp";
import { fixtureEnvelope } from "@/lib/fixtures";
import { RAEEnvelopeSchema } from "@/lib/governance";
import { loadRAEEnvelope } from "@/lib/sleeper";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues } from "@/lib/leagues";
import { fetchLeagueLive } from "@/lib/leagues/fetchLive";
import { buildLiveEnvelope, rankingsSourceFromSnapshot } from "@/lib/leagues/toEnvelope";
import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";

// Force dynamic rendering so we never download the 19 MB Sleeper players catalog
// during build. With ISR (Vercel default for static pages), `next build` runs the
// page once and Vercel's data cache rejects items over 2 MB.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Render priority:
  //   1. Signed-in user with at least one league → real live envelope from their
  //      Sleeper roster overlaid with FantasyPros consensus rankings.
  //   2. Signed-in user with no league yet → demo envelope but show a CTA banner
  //      via the envelope's source.failure field so the panels know.
  //   3. Anonymous viewer → demo fixture envelope (the public marketing surface).
  //
  // The RAE_ENABLE_LIVE_HOMEPAGE escape hatch is preserved for ops scenarios.

  const liveOverride = process.env.RAE_ENABLE_LIVE_HOMEPAGE === "true";
  if (liveOverride) {
    const envelope = await loadRAEEnvelope({
      allowFixtures: process.env.RAE_ALLOW_FIXTURES === "true"
    });
    return <RaeApp envelope={envelope} />;
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId) {
      const db = getDb();
      const leagues = await listLeagues(db, userId);
      if (leagues.length > 0) {
        // Default to the first league. Multi-league users can switch via the
        // /settings/leagues page; deep-linking by league id is a follow-up.
        const live = await fetchLeagueLive(userId, leagues[0]!.id, db);
        if (live && live.myRoster.length > 0) {
          const rankings = await getLatestRankingsSnapshot("PPR");
          const rankingsSource = rankings
            ? rankingsSourceFromSnapshot("PPR", rankings.fetchedAt)
            : rankingsSourceFromSnapshot("PPR", null, "rankings cache empty — cron may not have fired yet");
          const envelope = buildLiveEnvelope({
            snapshot: live,
            rankings: rankings?.data ?? null,
            rankingsSource
          });
          return <RaeApp envelope={envelope} />;
        }
      }
    }
  } catch {
    // Live envelope path failed (auth crashed, DB unreachable, etc). Fall
    // through to the demo envelope so the public homepage stays up.
  }

  // Default: render the fixture envelope. Per-user live data is served from
  // /api/leagues/[id]/refresh and surfaced through the signed-in path above.
  const fixtureEnv = RAEEnvelopeSchema.parse(fixtureEnvelope());
  return <RaeApp envelope={fixtureEnv} />;
}
