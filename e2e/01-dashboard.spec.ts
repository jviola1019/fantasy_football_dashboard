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

    // At least one WebGL scene must mount and paint near the top of the page.
    // We assert ≥ 1 rather than a fixed count: the number of *concurrent*
    // WebGL contexts a browser grants is GPU-dependent — headless software
    // rendering (CI) caps it lower than a real GPU. Panels that can't get a
    // context degrade to a static fallback via <SceneErrorBoundary> instead of
    // crashing the page, so the meaningful assertions are "WebGL works at all"
    // + "page did not crash".
    const canvases = page.locator("canvas");
    await expect(canvases.first()).toBeVisible({ timeout: 30_000 });
    expect(await canvases.count()).toBeGreaterThanOrEqual(1);

    // 3-D scenes lazy-mount: Canvas3D only spins up its WebGL <Canvas> once the
    // wrapper scrolls near the viewport (IntersectionObserver), and shows a
    // `.scene-placeholder` before that. So every panel's scene region must, at
    // any time, be exactly one of: a live canvas, the lazy placeholder, or the
    // graceful error fallback — never a blank/broken region.
    const sceneRegionCount = await page
      .locator("canvas, .scene-fallback, .scene-placeholder")
      .count();
    expect(sceneRegionCount).toBeGreaterThanOrEqual(4);

    // Scrolling each 3-D panel into view must lazy-mount a real WebGL canvas
    // for it (or the honest error fallback if the GPU refuses a context) —
    // proving the lazy-mount path actually delivers the scene, not a permanent
    // placeholder. Only panels whose *default* tab embeds a scene are listed:
    // Market Intelligence and Draft Intelligence keep their scenes behind a
    // non-default tab, so they are excluded here.
    for (const panelId of [
      "command-center",
      "player-universe",
      "narrative-engine",
      "nexus-simulator"
    ]) {
      const panel = page.locator(`#${panelId}`);
      await panel.scrollIntoViewIfNeeded();
      // After scroll-in the panel resolves to a canvas or the error fallback;
      // the placeholder is transient and must not be the resting state.
      await expect(
        panel.locator("canvas, .scene-fallback").first()
      ).toBeVisible({ timeout: 30_000 });
    }
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
