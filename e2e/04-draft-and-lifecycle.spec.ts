import { test, expect } from "@playwright/test";

test.describe("draft + lifecycle tabs are reachable from the dashboard", () => {
  test("Draft Intelligence tab content is present in the rendered DOM", async ({ page }) => {
    await page.goto("/");
    // Each panel renders its h2 with a deterministic id. Use the h2 to confirm
    // the panel is on the page rather than depending on tab-click behavior
    // (the current shell renders all panels in stacked sections).
    await expect(page.locator("#dr-title")).toHaveText(/Draft Intelligence/i);
    await expect(page.getByText(/Live Board/i).first()).toBeVisible();
    await expect(page.getByText(/Recommendations/i).first()).toBeVisible();
  });

  test("Pre-Draft, Waiver Wire, Trade Center panels are rendered", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#pda-title")).toHaveText(/Pre-Draft Audit/i);
    await expect(page.locator("#ww-title")).toHaveText(/Waiver Wire/i);
    await expect(page.locator("#tc-title")).toHaveText(/Trade Center/i);
  });

  test("Waiver Wire populates a ranked free-agent table from the envelope", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#waiver-wire");
    // The fixture envelope ships 8 players, so the table should have rows beyond the header.
    await expect(section.getByText(/RANKED FREE AGENTS/i)).toBeVisible();
    const rowCount = await section.locator("tbody tr").count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("Trade Center shows fairness scores for demo trades", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#trade-center");
    await expect(section.getByText(/RANKED BY FAIRNESS/i)).toBeVisible();
    // Verdict column has at least one of balanced/slight-edge/lopsided.
    await expect(section.getByText(/balanced|slight-edge|lopsided/i).first()).toBeVisible();
  });
});
