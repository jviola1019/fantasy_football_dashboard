// Plain ESM JavaScript, NOT TypeScript. Node loads this config directly, with
// no transpilation — importing a `.ts` module here throws
// ERR_UNKNOWN_FILE_EXTENSION on Node 20 (CI) even though Node >= 22.18 strips
// types natively and hides the fault locally. `csp.ts` re-exports this same
// array, so there is still exactly one definition.
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/securityHeaders.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  poweredByHeader: false,
  images: {
    // Scoped to the exact CDN paths PlayerHeadshot renders (lib/headshots.ts,
    // lib/normalize.ts, the Sleeper default icon). Hostname-only patterns
    // imply a `**` pathname wildcard, which lets anyone optimize arbitrary
    // URLs on these hosts through our image endpoint.
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com", pathname: "/content/nfl/players/**" },
      { protocol: "https", hostname: "sleepercdn.com", pathname: "/images/**" },
      { protocol: "https", hostname: "a.espncdn.com", pathname: "/i/headshots/**" }
    ]
  },
  /**
   * Security headers are emitted by the APP, not only by vercel.ts (audit
   * F-007). Previously they existed solely in Vercel's config, which meant
   * `next start`, Playwright and Lighthouse never saw them — so no gate could
   * observe the header set and it could regress silently. e2e now asserts them.
   *
   * The per-request CSP is set in src/proxy.ts, because a nonce cannot be a
   * static value.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }]
      },
      {
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS]
      }
    ];
  }
};

export default nextConfig;
