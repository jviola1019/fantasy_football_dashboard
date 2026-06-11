import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Local + CI Playwright config. `next start` is launched by Playwright when
 * not already running. Cold starts on Windows (next-server boot + first-route
 * render) take real time, so the local default per-test timeout is generous.
 * (The old "6 WebGL canvases" rationale is gone — current panels are SVG/RSC.)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: process.env.CI ? 45_000 : 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 15_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } }
  ],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-secret-do-not-use-in-prod",
      CREDENTIAL_ENCRYPTION_KEY:
        process.env.CREDENTIAL_ENCRYPTION_KEY ??
        Buffer.alloc(32, 9).toString("base64"),
      DATABASE_URL: process.env.DATABASE_URL ?? "file:.data/playwright.sqlite"
    }
  }
});
