import { RaeApp } from "@/components/RaeApp";
import { loadRAEEnvelope } from "@/lib/sleeper";

export default async function Home() {
  const envelope = await loadRAEEnvelope({ allowFixtures: process.env.RAE_ALLOW_FIXTURES === "true" });
  return <RaeApp envelope={envelope} />;
}
