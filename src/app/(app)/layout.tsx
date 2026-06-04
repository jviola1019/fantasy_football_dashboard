import type { ReactNode } from "react";
import { loadEnvelope } from "@/lib/envelope/load";
import { AppShell } from "@/components/shell/AppShell";
import { DemoBanner } from "@/components/topbar/DemoBanner";
import { GovernanceBanner } from "@/components/shell/GovernanceBanner";

// Same dynamic-rendering requirement as the former homepage: never download the
// 19 MB Sleeper catalog at build time.
export const dynamic = "force-dynamic";

/**
 * Shell layout for every in-app route. Resolves the governed envelope ONCE
 * (request-cached `loadEnvelope`, shared with each route page) and renders the
 * responsive shell + the always-visible governance banner. No-league signed-in
 * users still get the shell; their route pages render <NoLeagueCTA/>.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const resolution = await loadEnvelope();

  if (resolution.kind === "no-league") {
    return (
      <AppShell mode="unavailable" freshness="—">
        {children}
      </AppShell>
    );
  }

  const { envelope, leagueOptions, activeLeagueId } = resolution;
  return (
    <AppShell
      mode={envelope.mode}
      freshness={envelope.sourceState.freshness}
      leagueOptions={leagueOptions}
      activeLeagueId={activeLeagueId}
      banner={
        <>
          <DemoBanner visible={envelope.mode === "fixture"} />
          <GovernanceBanner envelope={envelope} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
