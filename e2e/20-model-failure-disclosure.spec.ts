import { test, expect, type Page } from "@playwright/test";

/**
 * Audit 2026-08-20 §3 / §20 — the model-failure disclosure must be visible
 * ADJACENT to the decision-facing numbers, on the DEFAULT view.
 *
 * The precise failure this guards against: the warning existed, as
 * `sim.assumptions[4]`, but the only surface that rendered the full assumptions
 * list was inside the "Risk Analysis" tab, while the percentages sat on the
 * default "Multiverse" tab — and the one preview that did sit beside the numbers
 * rendered `assumptions.slice(0, 3)` truncated to 60 characters, which cut the
 * warning out entirely. Passing tests plus an invisible warning is exactly the
 * situation the audit calls "not equivalent to informed presentation", so the
 * assertions here are about VISIBILITY WITHOUT INTERACTION.
 */

async function gotoRoute(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("html#__next_error__")).toHaveCount(0);
  await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Panels that present season-simulation output, and the route that hosts them. */
const SIM_PANELS: Array<{ id: string; route: string }> = [
  { id: "nexus-simulator", route: "/analytics" },
  { id: "team-signals", route: "/analytics" },
  { id: "report-outlook", route: "/reports" }
];

test.describe("model-failure disclosure sits beside the numbers", () => {
  for (const { id, route } of SIM_PANELS) {
    test(`#${id} shows the notice without any interaction`, async ({ page }) => {
      await gotoRoute(page, route);
      const panel = page.locator(`#${id}`);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel).toBeVisible({ timeout: 20_000 });

      // No tab click, no expander, no scroll into a drawer.
      const notice = panel.locator(".model-scenario-banner").first();
      await expect(notice, `#${id} must render the failure notice on first paint`).toBeVisible();

      // It must say what it is, not hedge.
      await expect(notice).toContainText(/not a forecast/i);
      await expect(notice).toContainText(/worse than chance/i);

      // And it must point at reproducible evidence rather than asserting.
      await expect(notice).toContainText(/backtest-valuation\.md/);
    });
  }

  test("the notice is not inside a collapsed <details>", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const hiddenNotices = page.locator("details:not([open]) .model-scenario-banner");
    await expect(hiddenNotices).toHaveCount(0);
  });

  test("the default Nexus tab leads with the league baseline, not a model percentage", async ({
    page
  }) => {
    await gotoRoute(page, "/analytics");
    const panel = page.locator("#nexus-simulator");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // The prominent number is tagged as the structural baseline.
    const outlook = panel.locator(".scenario-outlook").first();
    await expect(outlook).toBeVisible();
    await expect(outlook.locator(".scenario-row-baseline-tag").first()).toContainText(
      /league baseline/i
    );

    // Every band label names the baseline, so none can read as a bare likelihood.
    const bands = outlook.locator(".scenario-row-band");
    const count = await bands.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(bands.nth(i)).toContainText(/baseline/i);
    }

    // The former presentation must be gone from the default view.
    await expect(panel).not.toContainText("95% Confidence Bands");
  });

  test("raw frequencies remain reachable and are labeled uncalibrated", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const panel = page.locator("#nexus-simulator");
    await panel.scrollIntoViewIfNeeded();
    const raw = panel.locator("details.scenario-raw").first();
    await expect(raw).toBeVisible();

    const summary = raw.locator("summary");
    await expect(summary).toContainText(/uncalibrated/i);

    // Nothing is hidden: the numbers are one keyboard-reachable step away.
    await summary.click();
    await expect(raw.locator(".ci-list")).toBeVisible();
    await expect(raw).toContainText(/simulated frequency under model assumptions/i);
    await expect(raw).toContainText(/not a forecast probability/i);
  });

  test("no surface presents the simulation as calibrated or validated", async ({ page }) => {
    // Wording guard: the audit forbids these claims for this model.
    const banned = /\b(calibrated probabilit|validated forecast|predictive edge|expected true probability)/i;
    for (const route of ["/analytics", "/reports", "/dashboard"]) {
      await gotoRoute(page, route);
      const body = await page.locator("body").innerText();
      expect(body, `${route} must not claim calibration`).not.toMatch(banned);
    }
  });
});
