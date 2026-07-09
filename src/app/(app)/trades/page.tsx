import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trades" };

export default async function TradesPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return (
    <>
      <h1 className="sr-only">Trades</h1>
      <RouteView view="trades" envelope={r.envelope} />
    </>
  );
}
