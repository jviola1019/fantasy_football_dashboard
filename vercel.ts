import type { VercelConfig } from "@vercel/config/v1";

const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "next build",
  // npm ci: deploys install exactly what package-lock.json resolves — same as
  // CI — instead of letting `npm install` re-resolve ranges on every deploy.
  installCommand: "npm ci --no-audit --no-fund",
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
    "src/app/api/cron/projections-refresh/route.ts": {
      memory: 512,
      maxDuration: 60
    },
    "src/app/api/cron/news-refresh/route.ts": {
      memory: 512,
      maxDuration: 60
    },
    "src/app/api/cron/lifecycle-check/route.ts": {
      memory: 512,
      maxDuration: 60
    },
    // FREE nflverse snap-share fetch + CSV parse can be memory- and time-heavy;
    // without an explicit cap it inherits Vercel defaults (10s on Hobby) and can
    // time out silently. Match the other data crons.
    "src/app/api/cron/opportunity-refresh/route.ts": {
      memory: 1024,
      maxDuration: 60
    }
  },
  crons: [
    // NOTE on schedule precision: the minute-level stagger below states INTENT
    // (an ordering that avoids overlapping invocations), not a guarantee. On
    // the Hobby plan Vercel runs each daily cron once within ±59 minutes of
    // the scheduled hour, so the stagger — and even the relative order — may
    // not hold. Every job is independent and idempotent (each writes its own
    // snapshot table), so out-of-order or overlapping runs are safe; only the
    // lifecycle-check (09:30) prefers same-day snapshots and degrades to the
    // previous day's if it fires first.
    //
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
    // Daily Sleeper per-week projections snapshot (Rotowire-sourced via
    // Sleeper's undocumented projections endpoint). Runs at 09:15 UTC, after
    // KTC and before the lifecycle-check at 09:30.
    { path: "/api/cron/projections-refresh", schedule: "15 9 * * *" },
    // Daily ESPN NFL news snapshot (up to 100 articles, no auth). Runs at
    // 09:20 UTC, after projections-refresh (09:15). The snapshot feeds the
    // homepage's trendingMomentum enrichment (espn/newsMatch.ts); the lifecycle
    // cron does NOT consume it today — running before lifecycle-check (09:30) is
    // simply reserved headroom for a future news-driven lifecycle rule.
    { path: "/api/cron/news-refresh", schedule: "20 9 * * *" },
    // 09:25 UTC. FREE nflverse snap-share snapshot → the homepage stamps a real
    // `opportunity` (role/usage) onto records, so Narrative/Liquidity/Waiver run
    // on free data instead of declaring opportunity unavailable.
    { path: "/api/cron/opportunity-refresh", schedule: "25 9 * * *" },
    // Once daily at 09:30 UTC (after all data snapshots). Walks every stored
    // league and emits drift notifications (stacked bye weeks, FAAB drained,
    // injured starters). Vercel Hobby plan caps each cron at one run per day.
    { path: "/api/cron/lifecycle-check", schedule: "30 9 * * *" }
  ],
  headers: [
    {
      source: "/api/(.*)",
      headers: [
        { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }
      ]
    },
    {
      // Baseline browser hardening for an authenticated dashboard (audit A-04).
      // frame-ancestors must be a header (ignored in <meta>) and is the only CSP
      // directive shipped for now — a full CSP needs nonce plumbing through
      // Next's inline scripts and is tracked separately.
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
};

export default config;
