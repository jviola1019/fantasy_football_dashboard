import { RaeApp } from "@/components/RaeApp";
import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";

// Force dynamic rendering so we never download the 19 MB Sleeper players catalog
// during build. With ISR (Vercel default for static pages), `next build` runs the
// page once and Vercel's data cache rejects items over 2 MB.
export const dynamic = "force-dynamic";

export default async function Home() {
  const resolution = await loadEnvelope();
  if (resolution.kind === "no-league") return <NoLeagueCTA />;
  return (
    <RaeApp
      envelope={resolution.envelope}
      leagueOptions={resolution.leagueOptions}
      activeLeagueId={resolution.activeLeagueId}
    />
  );
}
