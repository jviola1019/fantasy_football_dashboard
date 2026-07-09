import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { RouteView } from "@/components/app/RouteView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Draft" };

export default async function DraftPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return (
    <>
      <h1 className="sr-only">Draft</h1>
      <RouteView view="draft" envelope={r.envelope} />
    </>
  );
}
