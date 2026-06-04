import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";

export default async function DraftPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return <RouteView view="draft" envelope={r.envelope} />;
}
