/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "a.espncdn.com", pathname: "/i/headshots/nfl/players/full/**" },
      { protocol: "http", hostname: "a.espncdn.com", pathname: "/i/headshots/nfl/players/full/**" }
    ]
  },
  experimental: {},
  poweredByHeader: false
};

export default nextConfig;
