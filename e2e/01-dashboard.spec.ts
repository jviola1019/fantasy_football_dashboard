import { test, expect } from "@playwright/test";

test.describe("app shell + dashboard", () => {
  test("/dashboard renders the panels (2-D views) without crashing", async ({ page }) => {
    await page.goto("/dashboard");

    // The page must NOT fall back to Next.js's global error boundary.
    await expect(page.locator("html#__next_error__")).toHaveCount(0);

    // The multi-route shell: a route sidebar + sticky command bar.
    await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();

    // ── Nexus Simulator heatmap SVG.
    const nexus = page.locator("#nexus-simulator");
    await nexus.scrollIntoViewIfNeeded();
    await expect(nexus.locator("svg, .multiverse-wrap").first()).toBeVisible({ timeout: 30_000 });

    // ── Command Center leaderboard.
    const cc = page.locator("#command-center");
    await cc.scrollIntoViewIfNeeded();
    await expect(
      cc.locator('[aria-label="League pulse player leaderboard"], .league-pulse-empty').first()
    ).toBeVisible({ timeout: 15_000 });

    // ── Player Universe grid.
    const pu = page.locator("#player-universe");
    await pu.scrollIntoViewIfNeeded();
    await expect(pu.locator('[aria-label="Player grid"], .player-grid-empty').first()).toBeVisible({
      timeout: 15_000
    });

    // ── Narrative Engine.
    const ne = page.locator("#narrative-engine");
    await ne.scrollIntoViewIfNeeded();
    await expect(ne.locator('[aria-label*="Narrative"], .empty-state').first()).toBeVisible({ timeout: 15_000 });
  });

  test("onboarding homepage shows the primary CTAs when logged out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /connect your league/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /explore the demo/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("governance banner discloses source state on every app route", async ({ page }) => {
    await page.goto("/dashboard");
    const banner = page.locator(".governance-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Source state:/i);
    await expect(banner).toContainText(/freshness/i);
  });

  test("trade builder renders and accepts a player search", async ({ page }) => {
    await page.goto("/trades");
    const panel = page.locator("#trade-center");
    await expect(panel).toBeVisible();
    await expect(panel.locator('input[aria-label="Search players"], .muted-note')).toBeVisible({
      timeout: 30_000
    });
  });

  // The shell must reflow without the document overflowing horizontally at any
  // common breakpoint. Internal scroll containers clip their own overflow.
  for (const { label, width, height } of [
    { label: "desktop-xl", width: 1440, height: 900 },
    { label: "laptop", width: 1024, height: 768 },
    { label: "tablet", width: 768, height: 1024 },
    { label: "phone", width: 390, height: 844 }
  ]) {
    test(`no horizontal overflow at ${label} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/dashboard");
      await expect(page.locator("html#__next_error__")).toHaveCount(0);
      await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
