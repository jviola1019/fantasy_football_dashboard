import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireUser";
import { Onboarding } from "@/components/Onboarding";

// Force dynamic so the auth() session check runs per-request (no static cache of
// the signed-in vs anonymous branch).
export const dynamic = "force-dynamic";

/**
 * Onboarding-first landing. Anonymous visitors get the marketing/onboarding
 * surface (Connect league / Explore demo / Mock draft); signed-in users are
 * sent straight to their dashboard.
 */
export default async function Home() {
  // requireUser(), not a bare auth(): a revoked or deleted-account token is
  // still a well-formed JWT, so trusting `session.user` here would bounce a
  // signed-out ghost into the app shell instead of showing onboarding (audit
  // F-004).
  //
  // This comment used to claim it was "the last raw session read in the app".
  // It was not — `envelope/load.ts` had one, and that is the loader every
  // authenticated route calls, so the file asserting the invariant was clean
  // while the file feeding the whole app was not. A comment cannot enforce an
  // invariant; `src/lib/auth/sessionRevocationCoverage.test.ts` now does.
  const user = await requireUser().catch(() => null);
  if (user) redirect("/dashboard");
  return <Onboarding />;
}
