import type { VercelConfig } from "@vercel/config/v1";

const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "next build",
  installCommand: "npm install --no-audit --no-fund",
  // Per-function overrides. The /api/leagues/[id]/refresh route does live ESPN +
  // Sleeper fetches in parallel and decrypts AES-GCM; give it room and a higher
  // duration cap.
  functions: {
    "src/app/api/leagues/[id]/refresh/route.ts": {
      memory: 1024,
      maxDuration: 30
    },
    "src/app/api/auth/[...nextauth]/route.ts": {
      memory: 512,
      maxDuration: 15
    },
    "src/app/api/cron/players-refresh/route.ts": {
      memory: 1024,
      maxDuration: 60
    },
    "src/app/api/cron/rankings-refresh/route.ts": {
      memory: 512,
      maxDuration: 60
    },
    "src/app/api/cron/ktc-refresh/route.ts": {
      memory: 512,
      maxDuration: 60
    },
    "src/app/api/cron/lifecycle-check/route.ts": {
      memory: 512,
      maxDuration: 60
    }
  },
  crons: [
    // Daily Sleeper players snapshot. Avoids the 19MB live fetch on every
    // request. The route is gated by the `Authorization: Bearer $CRON_SECRET`
    // header Vercel sends automatically when CRON_SECRET env var is set.
    { path: "/api/cron/players-refresh", schedule: "0 8 * * *" },
    // Daily FantasyPros consensus rankings snapshot (STD/PPR/HALF). Drives
    // the behavioral-market fields on PlayerMarketRecord so the dashboard
    // panels have a real data source pre-season.
    { path: "/api/cron/rankings-refresh", schedule: "30 8 * * *" },
    // Daily KeepTradeCut trade-value snapshot (dynasty + redraft). Feeds the
    // Trade Center value chain as a secondary source between FantasyCalc and
    // DynastyProcess. Staggered 30 min after rankings-refresh to avoid
    // overlapping serverless invocations.
    { path: "/api/cron/ktc-refresh", schedule: "0 9 * * *" },
    // Once daily at 09:30 UTC (after the data snapshots): walk every
    // stored league and emit drift notifications (stacked bye weeks, FAAB
    // drained, injured starters). Vercel's Hobby plan caps each cron job at one
    // run per day; on Pro this can return to a tighter interval.
    { path: "/api/cron/lifecycle-check", schedule: "30 9 * * *" }
  ],
  headers: [
    {
      source: "/api/(.*)",
      headers: [
        { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }
      ]
    }
  ]
};

export default config;
