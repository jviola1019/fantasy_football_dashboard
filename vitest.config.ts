import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `.tsx` added 2026-09-01 (S4). The repo carried @testing-library/react as a
    // dependency with ZERO `.test.tsx` files consuming it, so no component had a
    // render test of any kind — and the only per-panel coverage was an e2e run,
    // which in CI hits an EMPTY database and therefore only ever exercises the
    // unavailable state. The populated branch of every panel shipped unverified.
    // The two new panels render through `react-dom/server`, already a
    // dependency, which works under this node environment and needs no jsdom.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    pool: "forks",
    // A few integration tests dynamically `import()` modules inside the test
    // body (so vi.mock is set up first). Under the forked pool's parallel CPU
    // load that transform/import can exceed the 5s default and flake, even
    // though each test passes in ~2s in isolation. 20s gives ample headroom
    // while still failing a genuinely hung test.
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
