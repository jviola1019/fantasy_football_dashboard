import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
