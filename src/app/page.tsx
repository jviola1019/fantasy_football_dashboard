import { RaeApp } from "@/components/RaeApp";
import { fixtureEnvelope } from "@/lib/fixtures";
import { RAEEnvelopeSchema } from "@/lib/governance";
import { loadRAEEnvelope } from "@/lib/sleeper";

// Force dynamic rendering so we never download the 19 MB Sleeper players catalog
// during build. With ISR (Vercel default for static pages), `next build` runs the
// page once and Vercel's data cache rejects items over 2 MB.
export const dynamic = "force-dynamic";

export default async function Home() {
  const allowLive = process.env.RAE_ENABLE_LIVE_HOMEPAGE === "true";
  if (allowLive) {
    const envelope = await loadRAEEnvelope({
      allowFixtures: process.env.RAE_ALLOW_FIXTURES === "true"
    });
    return <RaeApp envelope={envelope} />;
  }
  // Default: render the fixture envelope. Per-user live data is served from
  // /api/leagues/[id]/refresh once the user has signed in and added a league.
  return <RaeApp envelope={RAEEnvelopeSchema.parse(fixtureEnvelope())} />;
}
