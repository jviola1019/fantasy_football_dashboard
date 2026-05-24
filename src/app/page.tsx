import { RaeApp } from "@/components/RaeApp";
import { fixtureEnvelope } from "@/lib/fixtures";
import { RAEEnvelopeSchema, type RAEEnvelope } from "@/lib/governance";
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

// Resolve the envelope that should drive the dashboard for this request.
// Pure data-loading helper — does not construct JSX so React can't
// silently swallow rendering errors from inside our try/catch (which
// react-hooks/error-boundaries flags).
async function resolveHomeEnvelope(): Promise<RAEEnvelope> {
  // Render priority:
  //   1. RAE_ENABLE_LIVE_HOMEPAGE=true → loadRAEEnvelope (ops override).
  //   2. Signed-in user with at least one league → real live envelope from
  //      their Sleeper roster overlaid with FantasyPros consensus rankings.
  //   3. Otherwise → demo fixture envelope (anonymous landing surface).

  if (process.env.RAE_ENABLE_LIVE_HOMEPAGE === "true") {
    return loadRAEEnvelope({
      allowFixtures: process.env.RAE_ALLOW_FIXTURES === "true"
    });
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
            : rankingsSourceFromSnapshot(
                "PPR",
                null,
                "rankings cache empty — cron may not have fired yet"
              );
          return buildLiveEnvelope({
            snapshot: live,
            rankings: rankings?.data ?? null,
            rankingsSource
          });
        }
      }
    }
  } catch {
    // Live envelope path failed (auth crashed, DB unreachable, etc). Fall
    // through to the demo envelope so the public homepage stays up.
  }

  // Default: render the fixture envelope. Per-user live data is served from
  // /api/leagues/[id]/refresh and surfaced through the signed-in path above.
  return RAEEnvelopeSchema.parse(fixtureEnvelope());
}

export default async function Home() {
  const envelope = await resolveHomeEnvelope();
  return <RaeApp envelope={envelope} />;
}
