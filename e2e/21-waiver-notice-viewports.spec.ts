import { test, expect, type Page } from "@playwright/test";

/**
 * Viewport evidence for the protocol-4 opportunity notice (CLAUDE.md testing
 * rules: mobile, tablet and desktop screenshots for a UI change).
 *
 * These are not decorative captures. Each viewport also asserts the two things
 * that would actually make the notice fail in the wild: that it does not force
 * the page to scroll sideways, and that its text is still fully present rather
 * than clipped. A notice that is unreadable on a phone has not disclosed
 * anything.
 */
const VIEWPORTS = [
  { name: "mobile", width: 320, height: 720 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
] as const;

async function openWaivers(page: Page) {
  await page.goto("/waivers", { waitUntil: "domcontentloaded" });
  const panel = page.locator("#waiver-wire");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

for (const vp of VIEWPORTS) {
  test(`opportunity notice renders correctly at ${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const panel = await openWaivers(page);

    const notice = panel.locator(".model-scenario-banner.is-validated").first();
    await expect(notice).toBeVisible();

    await page.screenshot({
      path: `reports/2026-08-20/screens/waiver-opportunity-${vp.name}.png`,
      fullPage: false
    });

    // The notice must not be the thing that breaks the layout. 320px is the
    // narrowest supported width and the one most likely to overflow.
    const box = await notice.boundingBox();
    expect(box, "notice must have a layout box").not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(vp.width);

    // Text present, not clipped away — a truncated disclosure discloses nothing.
    const text = await notice.innerText();
    expect(text).toMatch(/validated in-season signal/i);
    expect(text).toMatch(/in-season only/i);
    expect(text).toMatch(/0\.748/);

    // The notice must not introduce horizontal page scroll.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector(".model-scenario-banner.is-validated");
      if (!el) return null;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    expect(overflow, "notice must be measurable").not.toBeNull();
    expect(
      overflow!.scrollW,
      `notice overflows its own box at ${vp.width}px`
    ).toBeLessThanOrEqual(overflow!.clientW + 1);
  });
}

test("unavailable-data panels do not clip their own text", async ({ page }) => {
  // Regression: the FAAB sidebar rendered "/api/leagues/[id]/refres" — the
  // wrapper sets overflow:hidden, the description names an API route with no
  // break opportunity, and a grid item's default min-width:auto refused to
  // shrink. A truncated instruction is worse than no instruction, because it
  // reads as complete.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWaivers(page);

  const blocks = page.locator(".data-unavailable");
  const count = await blocks.count();
  expect(count, "expected at least one unavailable-data block on /waivers").toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const clipped = await blocks.nth(i).evaluate((el) => {
      const offenders: string[] = [];
      for (const node of el.querySelectorAll("h3, p, div")) {
        // +1 absorbs sub-pixel rounding; anything beyond that is real clipping.
        if (node.scrollWidth > node.clientWidth + 1) {
          offenders.push(`${node.tagName}: ${(node.textContent ?? "").slice(0, 40)}`);
        }
      }
      return offenders;
    });
    expect(clipped, `block ${i} clips text horizontally`).toEqual([]);
  }
});
