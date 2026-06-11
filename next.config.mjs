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
  }
};

export default nextConfig;
