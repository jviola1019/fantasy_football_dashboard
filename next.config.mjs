/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "a.espncdn.com" }
    ]
  }
};

export default nextConfig;
