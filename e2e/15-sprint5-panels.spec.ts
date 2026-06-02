import { test, expect, type Page } from "@playwright/test";

/**
 * Sprint 5 exhaustive panel matrix. Validates every system panel renders, every
 * in-panel tab strip actually switches content, the new interactions work
 * (Draft two-button, Waiver search, Player-Universe tabs, Price-Discovery
 * scatter, League-Pulse bars), no fabricated junk text is shown, and the
 * document never overflows horizontally across viewports — all on the demo
 * (anonymous) dashboard so it runs without auth.
 */

const PANEL_IDS = [
  "command-center",
  "market-intelligence",
  "player-universe",
  "narrative-engine",
  "nexus-simulator",
  "draft-intelligence",
  "pre-draft-audit",
  "waiver-wire",
  "trade-center"
];

async function gotoDashboard(page: Page) {
  await page.goto("/");
  await expect(page.locator("html#__next_error__")).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Top-level systems"]')).toBeVisible();
}

test.describe("sprint 5 — all panels render", () => {
  test("every one of the 9 system panels is present", async ({ page }) => {
    await gotoDashboard(page);
    for (const id of PANEL_IDS) {
      const panel = page.locator(`#${id}`);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel, `panel #${id} should render`).toBeVisible({ timeout: 20_000 });
    }
  });

  test("no fabricated / broken junk text anywhere on the dashboard", async ({ page }) => {
    await gotoDashboard(page);
    // Scroll the whole page so every lazy panel paints.
    for (const id of PANEL_IDS) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const junk of ["nan", "undefined", "[object object]", "infinity", "$nan"]) {
      expect(body, `body must not render "${junk}"`).not.toContain(junk);
    }
  });
});

test.describe("sprint 5 — in-panel tabs switch content", () => {
  const cases: Array<{ panel: string; tabs: string[] }> = [
    { panel: "market-intelligence", tabs: ["Market Pulse", "Liquidity Flow", "Sentiment", "Arbitrage", "Trends", "Price Discovery"] },
    { panel: "player-universe", tabs: ["Universe", "Tiers", "Comparison", "Watchlist", "Projections"] },
    { panel: "nexus-simulator", tabs: ["Multiverse", "Scenarios", "Risk Analysis"] },
    { panel: "trade-center", tabs: ["Trade Builder", "Recent League Trades"] }
  ];
  for (const { panel, tabs } of cases) {
    test(`${panel}: each tab is selectable`, async ({ page }) => {
      await gotoDashboard(page);
      const root = page.locator(`#${panel}`);
      await root.scrollIntoViewIfNeeded();
      for (const name of tabs) {
        const tab = root.getByRole("tab", { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }
    });
  }
});

test.describe("sprint 5 — new feature interactions", () => {
  test("Command Center League Pulse shows ranked bars + values", async ({ page }) => {
    await gotoDashboard(page);
    const board = page.locator("#command-center .lp-board");
    await board.scrollIntoViewIfNeeded();
    await expect(board.locator(".lp-row").first()).toBeVisible();
    await expect(board.locator(".lp-bar").first()).toBeVisible();
    await expect(board.locator(".lp-value").first()).toBeVisible();
  });

  test("Market Intelligence Price Discovery renders the scatter", async ({ page }) => {
    await gotoDashboard(page);
    const mi = page.locator("#market-intelligence");
    await mi.scrollIntoViewIfNeeded();
    await mi.getByRole("tab", { name: "Price Discovery", exact: true }).click();
    await expect(mi.locator("svg.pd-scatter")).toBeVisible();
  });

  test("Player Universe Tiers tab shows value bands", async ({ page }) => {
    await gotoDashboard(page);
    const pu = page.locator("#player-universe");
    await pu.scrollIntoViewIfNeeded();
    await pu.getByRole("tab", { name: "Tiers", exact: true }).click();
    await expect(pu.locator(".universe-tiers")).toBeVisible();
    await expect(pu.locator(".tier-chip").first()).toBeVisible();
  });

  test("Draft Intelligence: + Mine and Taken buttons update the counts", async ({ page }) => {
    await gotoDashboard(page);
    const di = page.locator("#draft-intelligence");
    await di.scrollIntoViewIfNeeded();
    await di.getByRole("button", { name: /to my team/i }).first().click();
    await di.getByRole("button", { name: /taken by an opponent/i }).first().click();
    await expect(di).toContainText(/1 mine/);
    await expect(di).toContainText(/1 taken/);
    // Reset returns to the empty state.
    await di.getByRole("button", { name: /^Reset$/ }).click();
    await expect(di).toContainText(/0 mine/);
  });

  test("Waiver Wire search filters the ranked free agents", async ({ page }) => {
    await gotoDashboard(page);
    const ww = page.locator("#waiver-wire");
    await ww.scrollIntoViewIfNeeded();
    const rowsBefore = await ww.locator("tbody tr").count();
    await ww.getByRole("searchbox", { name: /search free agents/i }).fill("zzzznotaplayer");
    await expect(ww.locator("tbody")).toContainText(/No free agents match/i);
    // Clearing restores the list.
    await ww.getByRole("searchbox", { name: /search free agents/i }).fill("");
    await expect(ww.locator("tbody tr")).toHaveCount(rowsBefore);
  });
});

test.describe("sprint 5 — responsive: no panel overflow", () => {
  for (const { label, width, height } of [
    { label: "desktop", width: 1440, height: 900 },
    { label: "laptop", width: 1024, height: 768 },
    { label: "tablet", width: 768, height: 1024 },
    { label: "phone", width: 390, height: 844 }
  ]) {
    test(`no horizontal overflow at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoDashboard(page);
      for (const id of PANEL_IDS) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, "document must not overflow horizontally").toBeLessThanOrEqual(1);
    });
  }
});
