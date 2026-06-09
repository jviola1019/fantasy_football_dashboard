// Post-deploy / uptime smoke test against a live deployment. Verifies the public
// route surface (200s + demo-data pages, auth redirects, health). Pure expectation
// logic + tests live in src/lib/ops/smokeRoutes.ts.
//
// Usage:
//   npm run smoke                       # default production URL
//   SMOKE_BASE_URL=https://… npm run smoke
//   tsx scripts/smoke-vercel.ts https://my-preview.vercel.app
import { SMOKE_ROUTES, evaluateRoute, type Observed } from "../src/lib/ops/smokeRoutes";

const DEFAULT_BASE = "https://fantasy-football-dashboard-seven.vercel.app";
const base = (process.env.SMOKE_BASE_URL ?? process.argv[2] ?? DEFAULT_BASE).replace(/\/$/, "");

async function probe(path: string): Promise<Observed> {
  const res = await fetch(base + path, { redirect: "manual" });
  const location = res.headers.get("location");
  // Only read bodies for endpoints we assert on, to keep the smoke fast.
  const body = path.startsWith("/api/") ? await res.text() : null;
  return { status: res.status, location, body };
}

async function main(): Promise<void> {
  console.log(`smoke-vercel → ${base}\n`);
  let failed = 0;
  for (const spec of SMOKE_ROUTES) {
    let obs: Observed;
    try {
      obs = await probe(spec.path);
    } catch (err) {
      obs = { status: 0, body: err instanceof Error ? err.message : String(err) };
    }
    const r = evaluateRoute(spec, obs);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.path.padEnd(20)} ${r.detail}`);
    if (!r.ok) failed++;
  }
  const total = SMOKE_ROUTES.length;
  console.log(`\nsmoke-vercel: ${total - failed}/${total} passed`);
  if (failed > 0) process.exit(1);
}

main();
