import { test, expect, type Page } from "@playwright/test";

/**
 * TopBar system-nav behaviour: scroll-spy (the active highlight follows the
 * scroll position), click-to-activate, the sliding blue underline, and the
 * numbered badges being large enough to contain their digit (no text leak).
 */

const NAV = 'nav[aria-label="Top-level systems"]';

async function load(page: Page) {
  await page.goto("/");
  await expect(page.locator(NAV)).toBeVisible();
}

function activeTabText(page: Page) {
  return page.locator(`${NAV} button[aria-current="true"]`).first().innerText();
}

test.describe("topbar system nav", () => {
  test("active highlight follows scroll (scroll-spy)", async ({ page }) => {
    await load(page);
    // At the top, Command Center is active.
    await expect(page.locator(`${NAV} button[aria-current="true"]`)).toContainText(/Command Center/i);
    // Scroll to a panel far down the page; the active highlight must move off
    // Command Center to a later system.
    await page.locator("#trade-center").scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await activeTabText(page)).toLowerCase(), { timeout: 10_000 })
      .not.toContain("command center");
    // Scrolling back to the top returns the highlight to Command Center.
    await page.locator("#command-center").scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await activeTabText(page)).toLowerCase(), { timeout: 10_000 })
      .toContain("command center");
  });

  test("clicking a system tab activates it", async ({ page }) => {
    await load(page);
    await page.locator(`${NAV} button`, { hasText: "Nexus Simulator" }).click();
    await expect(page.locator(`${NAV} button[aria-current="true"]`)).toContainText(/Nexus Simulator/i);
  });

  test("the active tab renders the sliding blue underline", async ({ page }) => {
    await load(page);
    await expect(page.locator(`${NAV} .topbar-underline`)).toBeVisible();
  });

  test("number badges are sized to contain their digit (no leak)", async ({ page }) => {
    await load(page);
    // Each of the 9 system tabs has a numbered badge; assert it is at least a
    // ~20px box so a digit is never clipped/leaking.
    const badges = page.locator(`${NAV} button > span[aria-hidden="true"]`).filter({ hasText: /^[1-9]$/ });
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < count; i++) {
      const box = await badges.nth(i).boundingBox();
      expect(box, `badge ${i} should have a box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(18);
      expect(box!.height).toBeGreaterThanOrEqual(18);
    }
  });
});
