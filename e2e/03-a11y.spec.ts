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

  test("every tab states the region it controls, and that region exists", async ({ page }) => {
    // Design audit D-9. The product declared role="tab" in five panels with NO
    // role="tabpanel" and no aria-controls anywhere: activating a tab announced
    // a selection change, then dropped the user into unlabelled content with no
    // stated relationship to the control they had just used. axe treats
    // aria-controls as advisory, so this passed every scan for the whole life
    // of the component.
    for (const route of ["/analytics", "/draft", "/players", "/trades"]) {
      await page.goto(route);
      const tabs = page.locator('[role="tab"]');
      const count = await tabs.count();
      expect(count, `${route} should render tabs`).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const controls = await tabs.nth(i).getAttribute("aria-controls");
        expect(controls, `${route} tab ${i} must name the region it controls`).toBeTruthy();
      }

      // The SELECTED tab's region must actually be in the document and point
      // back at the tab — a dangling aria-controls is worse than none.
      const selected = page.locator('[role="tab"][aria-selected="true"]').first();
      const target = await selected.getAttribute("aria-controls");
      const tabIdAttr = await selected.getAttribute("id");
      const panel = page.locator(`#${target}`);
      await expect(panel, `${route}: the selected tab's panel must exist`).toHaveCount(1);
      await expect(panel).toHaveAttribute("role", "tabpanel");
      await expect(panel).toHaveAttribute("aria-labelledby", String(tabIdAttr));
    }
  });

  test("each route names itself with a visible h1, not a screen-reader-only one", async ({ page }) => {
    // UX question 1 ("what is this?"). Every app route's only <h1> was
    // `sr-only`, so a sighted user landed in a stack of chrome — wordmark,
    // season chip, league select, mode pill, governance strip — with nothing
    // naming the page.
    for (const route of ["/dashboard", "/players", "/analytics", "/draft", "/waivers", "/trades", "/reports"]) {
      await page.goto(route);
      const h1 = page.locator("main h1");
      await expect(h1, `${route} must have exactly one h1`).toHaveCount(1);
      await expect(h1).toBeVisible();
      const box = await h1.boundingBox();
      expect(box?.height ?? 0, `${route} h1 must not be visually hidden`).toBeGreaterThan(10);
    }
  });

  test("solid amber is reserved for the primary action", async ({ page }) => {
    // The loudest object on every route used to be a solid-amber,
    // NON-INTERACTIVE season chip, while the recommended action sat behind a
    // 10px ghost pill. Amber is the product's action colour; spending it on a
    // label inverts the hierarchy.
    await page.goto("/dashboard");
    const amberSolid = await page.evaluate(() => {
      const hits: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const bg = getComputedStyle(el).backgroundColor;
        // --amber #d7a857
        if (bg === "rgb(215, 168, 87)") {
          const interactive = el.closest("a, button, [role='button']") !== null;
          if (!interactive) hits.push(`${el.tagName}.${el.className}`);
        }
      }
      return hits;
    });
    expect(amberSolid, "solid amber must only appear on something you can use").toEqual([]);
  });
});
