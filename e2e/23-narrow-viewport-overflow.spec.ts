import { test, expect } from "@playwright/test";

/**
 * Horizontal overflow at the NARROWEST supported width, on EVERY route.
 *
 * The existing check in `01-dashboard.spec.ts` covers one route (`/dashboard`)
 * and stops at 390px. The audit had a standing known defect — `/analytics`
 * overflows at 320px — that survived precisely because nothing tested that
 * route at that width. A known bug with no test is a bug that comes back.
 *
 * 320px is the floor: it is the narrowest viewport in common use (iPhone SE and
 * equivalents), and CLAUDE.md commits this product to mobile-first.
 *
 * Horizontal page scroll is not cosmetic on a phone. It hides the right edge of
 * every panel and makes vertical scrolling feel broken, which is why this is a
 * gate rather than a note.
 */
const ROUTES = [
  "/",
  "/dashboard",
  "/players",
  "/analytics",
  "/draft",
  "/waivers",
  "/trades",
  "/reports",
  "/login",
  "/mock-draft",
  "/settings/leagues",
  "/settings/account"
];

const WIDTHS = [320, 360];

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`${route} has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html#__next_error__")).toHaveCount(0);
      await page.waitForLoadState("networkidle").catch(() => {});

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );

      // On failure, name the widest offending element rather than just the
      // number — "something overflows by 40px" is not actionable.
      if (overflow > 1) {
        const culprits = await page.evaluate((vw: number) => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > vw + 1) {
              const cls = typeof el.className === "string" ? el.className : "";
              out.push(
                `${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : ""} ` +
                  `right=${Math.round(r.right)} width=${Math.round(r.width)}`
              );
            }
          }
          return out.slice(0, 8);
        }, width);
        throw new Error(
          `${route} overflows by ${overflow}px at ${width}px.\nWidest offenders:\n  ${culprits.join("\n  ")}`
        );
      }

      expect(overflow, `${route} must not overflow at ${width}px`).toBeLessThanOrEqual(1);
    });
  }
}
