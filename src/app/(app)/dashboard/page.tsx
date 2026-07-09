import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return (
    <>
      <h1 className="sr-only">Dashboard</h1>
      <RouteView view="dashboard" envelope={r.envelope} />
    </>
  );
}
