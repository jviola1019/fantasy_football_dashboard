import { test, expect } from "@playwright/test";

/**
 * WCAG 2.2 AA — SC 2.5.8 Target Size (Minimum), 24x24 CSS px.
 *
 * Audit 2026-08-06 F-012. axe-core has no target-size rule, so the existing
 * axe sweep in 03-a11y.spec.ts passed on all 12 routes while the demo-banner
 * dismiss control was 19x18 and the next-best-action pills were 23px tall.
 * Measured in a real browser, at the mobile viewport where it actually matters.
 *
 * The spec's own exceptions are honoured rather than worked around:
 *  - "Inline": targets inside a sentence, sized by surrounding line-height
 *    (e.g. the "Add a league" link inside the demo banner copy).
 *  - "Equivalent": another control on the page does the same thing.
 */
const ROUTES = ["/", "/dashboard", "/players", "/draft", "/waivers", "/trades", "/reports"];

const MIN = 24;

test.describe("WCAG 2.2 AA target size (SC 2.5.8)", () => {
  for (const route of ROUTES) {
    test(`route ${route} has no undersized interactive targets`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const undersized = await page.evaluate((min) => {
        const isInlineInSentence = (el: Element): boolean => {
          // Exempt when the target sits inside a run of text: its height is
          // constrained by the line-height of the surrounding prose.
          const parent = el.parentElement;
          if (!parent) return false;
          const display = getComputedStyle(el).display;
          if (display !== "inline" && display !== "inline-block") return false;
          const parentText = (parent.textContent ?? "").trim();
          const ownText = (el.textContent ?? "").trim();
          return parentText.length > ownText.length + 12;
        };

        const bad: Array<{ tag: string; label: string; w: number; h: number }> = [];
        const nodes = document.querySelectorAll<HTMLElement>(
          'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="tab"],[role="switch"]'
        );
        nodes.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return; // not rendered
          if (getComputedStyle(el).visibility === "hidden") return;
          if (isInlineInSentence(el)) return;

          // SC 2.5.8 is satisfied by the target OR its enlarged hit area, so
          // take the union of the element and any ::after spacer it declares.
          let w = r.width;
          let h = r.height;
          const after = getComputedStyle(el, "::after");
          if (after.content && after.content !== "none") {
            const aw = parseFloat(after.width);
            const ah = parseFloat(after.height);
            if (Number.isFinite(aw)) w = Math.max(w, aw);
            if (Number.isFinite(ah)) h = Math.max(h, ah);
          }

          if (w < min || h < min) {
            bad.push({
              tag: el.tagName,
              label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40),
              w: Math.round(w),
              h: Math.round(h)
            });
          }
        });
        return bad;
      }, MIN);

      expect(
        undersized,
        `Targets under ${MIN}x${MIN}px: ${JSON.stringify(undersized, null, 2)}`
      ).toEqual([]);
    });
  }
});
