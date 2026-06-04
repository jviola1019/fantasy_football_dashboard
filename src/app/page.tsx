import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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
  const session = await auth().catch(() => null);
  if (session?.user) redirect("/dashboard");
  return <Onboarding />;
}
