import { test, expect } from "@playwright/test";

/**
 * Multi-route navigation: every top-level route renders its panel(s) inside the
 * shared app shell, the current route is marked active in the nav, and the nav
 * links perform real client-side navigation. Replaces the former single-page
 * scroll-spy nav spec.
 */
const ROUTES = [
  { href: "/dashboard", anchor: "#league-health" },
  { href: "/players", anchor: "#player-universe" },
  { href: "/analytics", anchor: "#market-intelligence" },
  { href: "/draft", anchor: "#draft-intelligence" },
  { href: "/waivers", anchor: "#waiver-wire" },
  { href: "/trades", anchor: "#trade-center" }
];

test.describe("multi-route navigation", () => {
  for (const { href, anchor } of ROUTES) {
    test(`${href} renders its panel inside the app shell`, async ({ page }) => {
      await page.goto(href);
      await expect(page.locator("html#__next_error__")).toHaveCount(0);
      await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();
      await expect(page.locator(anchor)).toBeVisible({ timeout: 20_000 });
    });
  }

  test("the active route is marked aria-current in the visible nav", async ({ page }) => {
    // /dashboard is a primary route, so it has a VISIBLE active marker on both
    // desktop (sidebar) and mobile (bottom nav). The sidebar on mobile is an
    // unmounted drawer, so only primary routes can be asserted there.
    await page.goto("/dashboard");
    await expect(page.locator('a[href="/dashboard"][aria-current="page"]:visible').first()).toBeVisible();
  });

  test("clicking a nav link performs a client navigation", async ({ page }) => {
    await page.goto("/dashboard");
    // The visible nav link (sidebar on desktop, bottom nav on mobile).
    await page.locator('a[href="/players"]:visible').first().click();
    await page.waitForURL("**/players", { timeout: 15_000 });
    await expect(page.locator("#player-universe")).toBeVisible({ timeout: 20_000 });
  });
});
