// Data-contract freshness guard (OBS-03). Reads the deployed app's
// /api/health?snapshots=1 — which evaluates snapshot freshness in the runtime
// where the DB actually works (the standalone DB driver can't load under tsx) —
// and exits non-zero on any EXPIRED/MISSING snapshot. Suitable for a scheduled
// workflow / uptime monitor. Freshness logic itself is the tested
// src/lib/ops/freshness.ts (used server-side in the health route).
//
// Usage:
//   npm run check:freshness
//   SMOKE_BASE_URL=https://my-preview.vercel.app npm run check:freshness
import type { FreshnessResult } from "../src/lib/ops/freshness";

const DEFAULT_BASE = "https://fantasy-football-dashboard-seven.vercel.app";
const base = (process.env.SMOKE_BASE_URL ?? process.argv[2] ?? DEFAULT_BASE).replace(/\/$/, "");

async function main(): Promise<void> {
  const url = `${base}/api/health?snapshots=1`;
  console.log(`check-cron-freshness → ${url}\n`);
  // The snapshots block is operator-gated (it runs DB reads); send the cron
  // bearer so a scheduled run can read it. Without CRON_SECRET the endpoint
  // omits snapshots and this guard reports that it could not evaluate.
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`health endpoint returned ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const body = (await res.json()) as { snapshots?: FreshnessResult[] };
  const snapshots = body.snapshots ?? [];
  if (snapshots.length === 0) {
    console.error(
      "no snapshot freshness in response — set CRON_SECRET to authorize the snapshots block, or the deployment predates the freshness endpoint"
    );
    process.exitCode = 1;
    return;
  }
  let violations = 0;
  for (const r of snapshots) {
    const tag = r.ok ? (r.verdict === "stale" ? "WARN" : "OK  ") : "FAIL";
    console.log(`${tag}  ${r.source.padEnd(20)} ${r.verdict.padEnd(8)} ${r.detail}`);
    if (!r.ok) violations++;
  }
  console.log(`\ncheck-cron-freshness: ${snapshots.length - violations}/${snapshots.length} within contract`);
  if (violations > 0) process.exitCode = 1;
}

// Set exitCode (not process.exit) so open fetch sockets drain cleanly.
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
