import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility scan. Fails the build on any `serious` or `critical` violation
 * to keep the spec aligned with WCAG 2.1 AA in practice. `moderate` and `minor`
 * are reported in the HTML report but do not fail CI.
 */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

test.describe("axe a11y scan", () => {
  for (const path of ["/", "/login"]) {
    test(`route ${path} has no serious/critical violations`, async ({ page }) => {
      await page.goto(path);
      // Wait for at least one canvas to mount so r3f-injected DOM is present in the scan.
      if (path === "/") {
        await page.locator("canvas").first().waitFor({ timeout: 15_000 });
      }
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
