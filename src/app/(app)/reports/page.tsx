import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { ReportsView } from "@/components/app/ReportsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

// The visible <h1> is rendered once by `RouteHeader` inside the app shell, so
// every route is titled identically and none can quietly lose its heading.
export default async function ReportsPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return <ReportsView envelope={r.envelope} />;
}
