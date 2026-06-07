import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";

export default async function WaiversPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return (
    <>
      <h1 className="sr-only">Waivers</h1>
      <RouteView view="waivers" envelope={r.envelope} />
    </>
  );
}
