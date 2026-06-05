import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { ReportsView } from "@/components/app/ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return <ReportsView envelope={r.envelope} />;
}
