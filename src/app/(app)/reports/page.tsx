import { loadEnvelope, NoLeagueCTA } from "@/lib/envelope/load";
import { ReportsView } from "@/components/app/ReportsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const r = await loadEnvelope();
  if (r.kind === "no-league") return <NoLeagueCTA />;
  return (
    <>
      <h1 className="sr-only">Reports</h1>
      <ReportsView envelope={r.envelope} />
    </>
  );
}
