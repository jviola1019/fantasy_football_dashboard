import { test, expect } from "@playwright/test";

test.describe("draft + lifecycle panels on their routes", () => {
  test("Draft Intelligence content is present on /draft", async ({ page }) => {
    await page.goto("/draft");
    await expect(page.locator("#dr-title")).toHaveText(/Draft Intelligence/i);
    await expect(page.getByText(/Live Board/i).first()).toBeVisible();
    await expect(page.getByText(/Recommendations/i).first()).toBeVisible();
  });

  test("Live Board is searchable across all available players and shows recommendations on-board", async ({
    page
  }) => {
    await page.goto("/draft");
    const section = page.locator("#draft-intelligence");

    // Full-pool search exists (every player is reachable, not just the top few).
    const search = section.locator('input[aria-label="Search available players"]');
    await expect(search).toBeVisible();

    // Recommendations are ALWAYS on the board — the ★ marker proves a recommended
    // player is present in the AVAILABLE table (not stranded off-board).
    await expect(section.locator(".draft-rec-star").first()).toBeVisible();

    const baseRows = await section.locator("table tbody tr").count();
    expect(baseRows).toBeGreaterThan(0);

    // A nonsense query yields the honest empty-state, not a crash or stale rows.
    await search.fill("zzzz-no-such-player");
    await expect(section.getByText(/No available players match/i)).toBeVisible();

    // Clearing the search restores the board.
    await search.fill("");
    await expect(section.locator("table tbody tr").first()).toBeVisible();
  });

  test("Pre-Draft, Waiver Wire, Trade Center panels render on their routes", async ({ page }) => {
    await page.goto("/draft");
    await expect(page.locator("#pda-title")).toHaveText(/Pre-Draft Audit/i);
    await page.goto("/waivers");
    await expect(page.locator("#ww-title")).toHaveText(/Waiver Wire/i);
    await page.goto("/trades");
    await expect(page.locator("#tc-title")).toHaveText(/Trade Center/i);
  });

  test("Waiver Wire populates a ranked free-agent table from the envelope", async ({ page }) => {
    await page.goto("/waivers");
    const section = page.locator("#waiver-wire");
    // The fixture envelope ships 8 players, so the table should have rows beyond the header.
    await expect(section.getByText(/RANKED FREE AGENTS/i)).toBeVisible();
    const rowCount = await section.locator("tbody tr").count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("Trade Center renders the Trade Builder tab and loads values or shows an honest state", async ({
    page
  }) => {
    await page.goto("/trades");
    const section = page.locator("#trade-center");
    // The panel must be present and show the "Trade Builder" tab (role="tab").
    await expect(section.getByRole("tab", { name: /Trade Builder/i })).toBeVisible();
    // The builder loads values async; it shows either the search box (ready)
    // or an honest loading/unavailable message — never a crash.
    await expect(
      section.locator('input[aria-label="Search players"], .muted-note')
    ).toBeVisible({ timeout: 30_000 });
  });
});
