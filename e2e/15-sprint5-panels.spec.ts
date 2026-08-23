import { test, expect, type Page } from "@playwright/test";
import { EDGE_LABELS } from "../src/lib/models/edgeDisclosure";

/**
 * Panel matrix across the multi-route app: every system panel renders on its
 * route, every in-panel tab strip switches content, the key interactions work,
 * and no fabricated junk text appears — all on the demo (anonymous) surfaces so
 * it runs without auth.
 */

// Each panel and the route that hosts it (the dashboard is now a slim overview).
const PANELS: Array<{ id: string; route: string }> = [
  // /dashboard tiled overview
  { id: "league-health", route: "/dashboard" },
  { id: "league-pulse", route: "/dashboard" },
  { id: "top-insights", route: "/dashboard" },
  { id: "next-best-actions", route: "/dashboard" },
  // /analytics (incl. the re-homed Team Signals)
  { id: "market-intelligence", route: "/analytics" },
  { id: "narrative-engine", route: "/analytics" },
  { id: "nexus-simulator", route: "/analytics" },
  { id: "team-signals", route: "/analytics" },
  // /players (incl. the re-homed Roster Health)
  { id: "player-universe", route: "/players" },
  { id: "roster-health", route: "/players" },
  // /draft (incl. the re-homed Team Construction)
  { id: "draft-intelligence", route: "/draft" },
  { id: "pre-draft-audit", route: "/draft" },
  { id: "team-construction", route: "/draft" },
  { id: "waiver-wire", route: "/waivers" },
  { id: "trade-center", route: "/trades" }
];

async function gotoRoute(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("html#__next_error__")).toHaveCount(0);
  await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();
  // Let client hydration settle so locators don't detach mid-action.
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("panels render on their routes", () => {
  for (const { id, route } of PANELS) {
    test(`#${id} renders on ${route}`, async ({ page }) => {
      await gotoRoute(page, route);
      const panel = page.locator(`#${id}`);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel, `panel #${id} should render on ${route}`).toBeVisible({ timeout: 20_000 });
    });
  }

  test("no fabricated / broken junk text in the deterministic (fixture) panels", async ({ page }) => {
    // Word-boundary matches so legitimate substrings never false-positive — only
    // literal broken tokens like "NaN", "undefined", "[object Object]".
    const junk = /(\bNaN\b|\$NaN\b|\bundefined\b|\[object Object\]|\bInfinity\b)/;
    const routes = [...new Set(PANELS.map((p) => p.route))];
    for (const route of routes) {
      await gotoRoute(page, route);
      await expect(page.locator(".governance-banner")).toBeVisible();
      for (const { id, route: r } of PANELS) {
        if (r !== route || id === "trade-center") continue; // trade values are live/env-varying
        const panel = page.locator(`#${id}`);
        await panel.scrollIntoViewIfNeeded();
        const text = await panel.innerText();
        expect(text, `panel #${id} must not render a broken token`).not.toMatch(junk);
      }
    }
  });
});

test.describe("in-panel tabs switch content", () => {
  const cases: Array<{ panel: string; route: string; tabs: string[] }> = [
    { panel: "market-intelligence", route: "/analytics", tabs: ["Market Pulse", "Liquidity Flow", "Sentiment", EDGE_LABELS.gapsTab, "Trends", "Price Discovery"] },
    { panel: "player-universe", route: "/players", tabs: ["Universe", "Tiers", "Comparison", "Watchlist", "Projections"] },
    { panel: "nexus-simulator", route: "/analytics", tabs: ["Multiverse", "Scenarios", "Risk Analysis"] },
    { panel: "trade-center", route: "/trades", tabs: ["Trade Builder", "Recent League Trades"] }
  ];
  for (const { panel, route, tabs } of cases) {
    test(`${panel}: each tab is selectable`, async ({ page }) => {
      await gotoRoute(page, route);
      const root = page.locator(`#${panel}`);
      await root.scrollIntoViewIfNeeded();
      for (const name of tabs) {
        const tab = root.getByRole("tab", { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }
    });
  }

  test("Value × Usage board: sort buttons re-sort and expose pressed state", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const board = page.locator("#market-intelligence .vub-wrap");
    await board.scrollIntoViewIfNeeded();
    const valueSort = board.getByRole("button", { name: /^Value/ });
    const edgeSort = board.getByRole("button", { name: /^Edge/ });
    await expect(valueSort).toHaveAttribute("aria-pressed", "true");
    const firstByValue = await board.locator(".vub-row .vub-name").first().innerText();

    await edgeSort.click();
    await expect(edgeSort).toHaveAttribute("aria-pressed", "true");
    await expect(valueSort).toHaveAttribute("aria-pressed", "false");
    await expect(board.locator(".vub-board")).toHaveAttribute("aria-label", /sorted by edge/i);
    // The ranking actually changes (fixture data has distinct value/edge orders).
    const firstByEdge = await board.locator(".vub-row .vub-name").first().innerText();
    expect(firstByEdge).not.toBe(firstByValue);
  });

  // WCAG 2.2 / mobile-ergonomics: on touch devices every tab must present a
  // ≥44px-tall target (audit F-10 — text-xs + py-2.5 computes to ~36px without
  // a coarse-pointer minimum).
  test("tab targets are at least 44px tall on touch devices", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "touch-target rule applies to coarse pointers");
    await gotoRoute(page, "/analytics");
    const root = page.locator("#nexus-simulator");
    await root.scrollIntoViewIfNeeded();
    const tab = root.getByRole("tab", { name: "Multiverse", exact: true });
    const box = await tab.boundingBox();
    expect(box, "tab must be visible").not.toBeNull();
    expect(box!.height, `tab height ${box!.height}px must be ≥ 44px on touch`).toBeGreaterThanOrEqual(44);
  });
});

test.describe("feature interactions", () => {
  test("League Pulse shows ranked bars + values", async ({ page }) => {
    await gotoRoute(page, "/dashboard");
    const board = page.locator("#league-pulse .lp-board");
    // Rows + values are robust visible signals; the bar is a thin element that
    // re-lays-out as headshots load, so assert its presence by count.
    await expect(board.locator(".lp-row")).not.toHaveCount(0);
    await expect(board.locator(".lp-value").first()).toBeVisible();
    await expect(board.locator(".lp-bar")).not.toHaveCount(0);
  });

  test("Market Intelligence Price Discovery renders the scatter", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const mi = page.locator("#market-intelligence");
    await mi.scrollIntoViewIfNeeded();
    await mi.getByRole("tab", { name: "Price Discovery", exact: true }).click();
    await expect(mi.locator("svg.pd-scatter")).toBeVisible();
  });

  test("Player Universe Tiers tab shows value bands", async ({ page }) => {
    await gotoRoute(page, "/players");
    const pu = page.locator("#player-universe");
    await pu.scrollIntoViewIfNeeded();
    await pu.getByRole("tab", { name: "Tiers", exact: true }).click();
    await expect(pu.locator(".universe-tiers")).toBeVisible();
    await expect(pu.locator(".tier-chip").first()).toBeVisible();
  });

  test("Draft Intelligence: + Mine and Taken buttons update the counts", async ({ page }) => {
    await gotoRoute(page, "/draft");
    const di = page.locator("#draft-intelligence");
    await di.scrollIntoViewIfNeeded();
    await di.getByRole("button", { name: /to my team/i }).first().click();
    await di.getByRole("button", { name: /taken by an opponent/i }).first().click();
    await expect(di).toContainText(/1 mine/);
    await expect(di).toContainText(/1 taken/);
    await di.getByRole("button", { name: /^Reset$/ }).click();
    await expect(di).toContainText(/0 mine/);
  });

  test("Waiver Wire search filters the ranked free agents", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const ww = page.locator("#waiver-wire");
    await ww.scrollIntoViewIfNeeded();
    // Scoped to the FREE-AGENT table. The panel now also hosts the validated
    // in-season board, so a bare `tbody` under `#waiver-wire` is ambiguous --
    // and an ambiguous locator in strict mode is a test that stops testing.
    const faTable = ww.getByRole("region", { name: /ranked free agents table/i });
    const rowsBefore = await faTable.locator("tbody tr").count();
    await ww.getByRole("searchbox", { name: /search free agents/i }).fill("zzzznotaplayer");
    await expect(faTable.locator("tbody")).toContainText(/No free agents match/i);
    await ww.getByRole("searchbox", { name: /search free agents/i }).fill("");
    await expect(faTable.locator("tbody tr")).toHaveCount(rowsBefore);
  });
});
