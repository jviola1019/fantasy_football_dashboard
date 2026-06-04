import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return <RouteView view="trades" envelope={r.envelope} />;
}
