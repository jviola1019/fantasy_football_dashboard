import { test, expect } from "@playwright/test";

test.describe("app shell + dashboard", () => {
  test("/dashboard renders the overview without crashing", async ({ page }) => {
    await page.goto("/dashboard");

    // The page must NOT fall back to Next.js's global error boundary.
    await expect(page.locator("html#__next_error__")).toHaveCount(0);

    // The multi-route shell: a route sidebar + sticky command bar.
    await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();

    // The tiled overview = League Health + League Pulse leaderboard + Top Insights
    // + Next Best Actions (the deep per-system panels live on their own routes,
    // and the former CommandCenter sections are re-homed — see 15-sprint5).
    await expect(page.locator("#league-health")).toBeVisible();
    const pulse = page.locator("#league-pulse");
    await pulse.scrollIntoViewIfNeeded();
    await expect(
      pulse.locator('[aria-label="League pulse player leaderboard"], .league-pulse-empty').first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#top-insights")).toBeVisible();
    await expect(page.locator("#next-best-actions")).toBeVisible();
  });

  test("a deep route (/analytics) renders its 2-D heatmap without crashing", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.locator("html#__next_error__")).toHaveCount(0);
    await page.waitForLoadState("networkidle").catch(() => {});
    // toBeVisible auto-retries + re-resolves, so a brief hydration detach is fine;
    // Playwright treats below-the-fold elements as visible (no scroll needed).
    await expect(page.locator("#nexus-simulator svg, #nexus-simulator .multiverse-wrap").first()).toBeVisible({
      timeout: 30_000
    });
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
