import { test, expect } from "@playwright/test";

test.describe("public dashboard", () => {
  test("homepage renders the 9-system nav and 2-D player views without crashing", async ({ page }) => {
    await page.goto("/");

    // The page must NOT fall back to Next.js's global error boundary.
    await expect(page.locator("html#__next_error__")).toHaveCount(0);

    const nav = page.locator('nav[aria-label="Top-level systems"]');
    await expect(nav).toBeVisible();
    const tabs = nav.locator("button");
    await expect(tabs).toHaveCount(9);

    // ── Nexus Simulator: 3-D canvas replaced by Heatmap2D SVG in Sprint 3.
    // Assert the panel renders a visible SVG heatmap or the sim output.
    const nexus = page.locator("#nexus-simulator");
    await nexus.scrollIntoViewIfNeeded();
    await expect(
      nexus.locator("svg, .multiverse-wrap").first()
    ).toBeVisible({ timeout: 30_000 });

    // ── Command Center: leaderboard with player names (no 3-D scene).
    const cc = page.locator("#command-center");
    await cc.scrollIntoViewIfNeeded();
    await expect(cc.locator('[aria-label="League pulse player leaderboard"], .league-pulse-empty').first())
      .toBeVisible({ timeout: 15_000 });

    // ── Player Universe: 2-D player-grid cards (no 3-D scene).
    const pu = page.locator("#player-universe");
    await pu.scrollIntoViewIfNeeded();
    await expect(
      pu.locator('[aria-label="Player grid"], .player-grid-empty').first()
    ).toBeVisible({ timeout: 15_000 });

    // ── Narrative Engine: narrative bar list (no 3-D scene).
    const ne = page.locator("#narrative-engine");
    await ne.scrollIntoViewIfNeeded();
    await expect(
      ne.locator('[aria-label*="Narrative"], .empty-state').first()
    ).toBeVisible({ timeout: 15_000 });
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
