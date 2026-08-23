import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

// The visible <h1> is rendered once by `RouteHeader` inside the app shell, so
// every route is titled identically and none can quietly lose its heading.
export default async function AnalyticsPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return <RouteView view="analytics" envelope={r.envelope} />;
}
