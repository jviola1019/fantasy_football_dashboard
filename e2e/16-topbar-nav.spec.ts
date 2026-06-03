import { test, expect, type Page } from "@playwright/test";

/**
 * TopBar system-nav behaviour: scroll-spy (the active highlight follows the
 * scroll position), click-to-activate, the sliding solid blue pill that marks
 * the active system, and the numbered badges being large enough to contain
 * their digit (no text leak).
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
    // Drive ABSOLUTE scroll positions (deterministic across headless/desktop —
    // unlike scrollIntoViewIfNeeded, which aligns variably). At the very bottom
    // the highlight must leave the top row; back at the top it must return.
    // We don't assert the exact system (the grid puts 2-3 panels per row, so the
    // IntersectionObserver's row-lead can be either) — only that it tracks scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(async () => (await activeTabText(page)).toLowerCase(), { timeout: 12_000 })
      .not.toMatch(/command center|market intelligence/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(async () => (await activeTabText(page)).toLowerCase(), { timeout: 12_000 })
      .toMatch(/command center|market intelligence/);
  });

  test("clicking a system tab activates it", async ({ page }) => {
    await load(page);
    await page.locator(`${NAV} button`, { hasText: "Nexus Simulator" }).click();
    await expect(page.locator(`${NAV} button[aria-current="true"]`)).toContainText(/Nexus Simulator/i);
  });

  test("the active tab renders the sliding solid blue pill", async ({ page }) => {
    await load(page);
    const activeBtn = page.locator(`${NAV} button[aria-current="true"]`).first();
    const pill = activeBtn.locator(".topbar-pill");
    await expect(pill).toBeVisible();
    // The pill is the active segment's BACKGROUND, so it should cover essentially
    // the whole button — not a thin sliver/underline. Assert relative to the
    // button box rather than hardcoded pixels (robust across viewports).
    const btnBox = await activeBtn.boundingBox();
    const pillBox = await pill.boundingBox();
    expect(btnBox, "active button should have a box").not.toBeNull();
    expect(pillBox, "active pill should have a box").not.toBeNull();
    expect(pillBox!.width).toBeGreaterThanOrEqual(btnBox!.width * 0.85);
    expect(pillBox!.height).toBeGreaterThanOrEqual(btnBox!.height * 0.85);
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
