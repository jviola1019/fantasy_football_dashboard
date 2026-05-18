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
    }
  },
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
