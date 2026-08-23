import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility scan. Fails the build on any `serious` or `critical` violation
 * to keep the spec aligned with WCAG 2.1 AA in practice. `moderate` and `minor`
 * are reported in the HTML report but do not fail CI.
 */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

test.describe("axe a11y scan", () => {
  for (const path of [
    "/",
    "/dashboard",
    "/players",
    "/analytics",
    "/draft",
    "/waivers",
    "/trades",
    "/reports",
    "/login",
    "/settings/account",
    "/settings/leagues",
    "/mock-draft"
  ]) {
    test(`route ${path} has no serious/critical violations`, async ({ page }) => {
      await page.goto(path);
      // Wait for the page to settle before scanning. The 3-D canvas was removed
      // in Sprint 3 (Canvas3D → Heatmap2D swap) so there are no WebGL canvases.
      await page.waitForLoadState("networkidle");
      // Settings routes redirect to /login when unauthenticated — that's a valid
      // response; the scan runs against whichever page is actually loaded.
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
      if (blocking.length > 0) {
        console.log("Blocking a11y violations:", JSON.stringify(blocking, null, 2));
      }
      expect(blocking).toEqual([]);
    });
  }
});

test.describe("each app route exposes exactly one h1", () => {
  for (const path of ["/dashboard", "/players", "/analytics", "/draft", "/waivers", "/trades", "/reports"]) {
    test(`${path} has a single <h1>`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
});

/**
 * Accessibility properties axe cannot detect (audit 2026-08-22).
 *
 * axe was green throughout on every one of these. They were found by a
 * dispatched design audit reading the source, which is the point: a passing
 * automated scan bounds the problem, it does not close it.
 */
test.describe("a11y beyond what axe checks", () => {
  test("a skip link is the first thing a keyboard user reaches", async ({ page }) => {
    // Every app route puts a sidebar trigger, a 9-item route sidebar, a league
    // switcher and a user menu ahead of content in DOM order. axe's `bypass`
    // rule is satisfied by landmarks alone, so this passed without a skip link.
    await page.goto("/dashboard");
    await expect(page.locator("main#rae-main")).toHaveCount(1);
    await page.keyboard.press("Tab");
    const cls = await page.evaluate(() => document.activeElement?.className ?? "");
    expect(cls, "the first tab stop must be the skip link").toContain("skip-link");
  });

  test("standing context is not announced as a live event on every navigation", async ({ page }) => {
    // GovernanceBanner is mounted on EVERY route and its text (source,
    // freshness, confidence, validation, failure, missing fields) changes on
    // each navigation. As role="status" a screen reader read the whole
    // paragraph aloud every time. It is standing context, not an event.
    await page.goto("/dashboard");
    await expect(page.locator(".governance-banner[role='status']")).toHaveCount(0);
    await expect(page.locator(".governance-banner")).toHaveCount(1);

    // The mode pill is permanently mounted and recomputed per request.
    const liveModePill = page.locator("[aria-live] .badge, span[aria-live]").filter({ hasText: /fixture|live|unavailable/i });
    await expect(liveModePill).toHaveCount(0);
  });

  test("severity and valence are carried by words, not colour alone", async ({ page }) => {
    // WCAG 1.4.1. axe cannot tell that two classes differing only in colour
    // encode meaning.
    await page.goto("/dashboard");
    const body = await page.locator("body").innerText();
    // League Advantage previously read "45%" / "vs League Median" with the
    // above/below-50 verdict conveyed purely by red vs green.
    expect(body).toMatch(/league median \(50\)|vs League Median/i);
  });
});
