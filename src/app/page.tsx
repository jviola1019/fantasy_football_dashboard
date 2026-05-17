import { RaeApp } from "@/components/RaeApp";
import { loadRAEEnvelope } from "@/lib/sleeper";

export const dynamic = "force-dynamic";

export default async function Home() {
  const envelope = await loadRAEEnvelope({ allowFixtures: true });
  return <RaeApp envelope={envelope} />;
}
