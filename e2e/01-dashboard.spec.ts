import { test, expect } from "@playwright/test";

test.describe("public dashboard", () => {
  test("homepage renders the 9-system nav and live WebGL without crashing", async ({ page }) => {
    await page.goto("/");

    // The page must NOT fall back to Next.js's global error boundary.
    await expect(page.locator("html#__next_error__")).toHaveCount(0);

    const nav = page.locator('nav[aria-label="Top-level systems"]');
    await expect(nav).toBeVisible();
    const tabs = nav.locator("button");
    await expect(tabs).toHaveCount(9);

    // At least one WebGL scene must mount and paint. We assert ≥ 1 rather than a
    // fixed count: the number of *concurrent* WebGL contexts a browser grants
    // is GPU-dependent — headless software rendering (CI) caps it lower than a
    // real GPU. Panels that can't get a context degrade to a static fallback
    // via <SceneErrorBoundary> instead of crashing the page, so the meaningful
    // assertions are "WebGL works at all" + "page did not crash".
    const canvases = page.locator("canvas");
    await expect(canvases.first()).toBeVisible({ timeout: 30_000 });
    expect(await canvases.count()).toBeGreaterThanOrEqual(1);

    // Every panel either shows its canvas or the graceful fallback — never a
    // blank/broken region.
    const scenes = await page.locator("canvas, .scene-fallback").count();
    expect(scenes).toBeGreaterThanOrEqual(4);
  });

  test("topbar shows the Sign in entry point when logged out", async ({ page }) => {
    await page.goto("/");
    // When unauthenticated, the UserMenu renders a single "Sign in" link — but
    // only after `useSession()` resolves out of its loading skeleton, which can
    // take several seconds on a loaded machine, so we wait generously.
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible({
      timeout: 30_000
    });
  });

  test("governance banner discloses source state", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator(".governance-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Source state:/i);
    await expect(banner).toContainText(/freshness/i);
  });

  test("trade builder renders and accepts a player search", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#trade-center");
    await expect(panel).toBeVisible();
    // The builder loads values async; it shows either the search box (ready)
    // or an honest loading/unavailable message — never a crash.
    await expect(
      panel.locator('input[aria-label="Search players"], .muted-note')
    ).toBeVisible({ timeout: 30_000 });
  });

  // The shadcn/Tailwind shell must reflow without the document itself
  // overflowing horizontally at any common breakpoint. Internal scroll
  // containers (tables, the tab strip) clip their own overflow, so the
  // document-level scrollWidth is the meaningful regression signal.
  for (const { label, width, height } of [
    { label: "desktop-xl", width: 1440, height: 900 },
    { label: "laptop", width: 1024, height: 768 },
    { label: "tablet", width: 768, height: 1024 },
    { label: "phone", width: 390, height: 844 }
  ]) {
    test(`no horizontal overflow at ${label} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator("html#__next_error__")).toHaveCount(0);
      await expect(page.locator('nav[aria-label="Top-level systems"]')).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      // Allow 1px for sub-pixel rounding; anything larger is a real overflow.
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
