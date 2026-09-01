import { expect, test } from "@playwright/test";

/**
 * Two feeds the app fetched daily and then threw away (audit S4).
 *
 * `/waivers` rendered *"Free-agent acquisition budgets not connected … no real
 * budget data is integrated yet"* while `fetchLive` was extracting the budget
 * for both platforms and the lifecycle cron was firing `faab-depleted` alerts
 * on it. `/players` showed a "Trending" figure computed from ESPN headlines
 * while the headlines themselves were discarded inside the loader, so the reader
 * had no way to see what moved.
 *
 * Both surfaces are now REQUIRED to exist and to say which of the honest states
 * they are in. The tests below assert the surface, not a particular value: CI
 * has an empty database and therefore no news snapshot and no connected league,
 * so a value assertion would be asserting the demo fixture rather than the
 * product. What must never come back is a panel claiming a capability the app
 * already has.
 */

// The exact sentences that were false when this spec was written. A rename that
// reintroduces the claim in other words is a different failure; these strings
// guard against the specific regression of restoring the old copy.
const RETIRED_CLAIMS = [
  "Free-agent acquisition budgets not connected",
  "No real budget data is integrated yet"
];

test.describe("FAAB is no longer described as unavailable when it is not", () => {
  test("the /waivers budget surface exists and states one of the honest cases", async ({ page }) => {
    await page.goto("/waivers");
    const heading = page.getByText("FAAB (FREE-AGENT BUDGET)", { exact: true });
    await expect(heading).toBeVisible();

    const body = await page.locator("body").innerText();
    for (const claim of RETIRED_CLAIMS) {
      expect(body, `"${claim}" was false: the budget is fetched, parsed and alerted on`).not.toContain(
        claim
      );
    }

    // Exactly one of: a real board, or a reason naming the settings that were read.
    const board = page.getByTestId("faab-board");
    const noFaab = page.getByText("This league does not use FAAB", { exact: false });
    const shownBoard = await board.count();
    const shownReason = await noFaab.count();
    expect(shownBoard + shownReason).toBeGreaterThan(0);

    if (shownBoard > 0) {
      // A board that renders must show dollars, not a bare percentage: a manager
      // bids $63, not 0.63.
      await expect(board.locator(".faab-amount").first()).toContainText("$");
    } else {
      // The honest case must name the field it read, so a user whose league DOES
      // use FAAB can tell us the detection is wrong.
      await expect(noFaab.first()).toBeVisible();
      expect(body).toContain("waiver_type 2");
    }
  });
});

test.describe("player news is visible as news", () => {
  test("the /players profile carries a news surface with real provenance", async ({ page }) => {
    await page.goto("/players");
    const news = page.getByTestId("player-news");
    await expect(news).toBeVisible();
    await expect(news.getByText("PLAYER NEWS", { exact: false })).toBeVisible();

    const headlines = news.locator(".player-news-headline");
    const count = await headlines.count();

    if (count > 0) {
      // Every headline that renders carries an age, and any link is external and
      // safe. A headline with no stated age is the "fabricated Xm ago" failure
      // the intel feed already had to remove once.
      await expect(news.locator(".player-news-age").first()).toBeVisible();
      const links = news.locator("a.player-news-headline");
      for (let i = 0; i < (await links.count()); i += 1) {
        const link = links.nth(i);
        await expect(link).toHaveAttribute("href", /^https:\/\//);
        await expect(link).toHaveAttribute("rel", /noopener/);
        await expect(link).toHaveAttribute("target", "_blank");
      }
      // Provenance, always: which snapshot and how old.
      await expect(news.getByText("in the snapshot", { exact: false })).toBeVisible();
    } else {
      // No snapshot / no coverage — both must SAY so rather than render blank.
      const text = await news.innerText();
      // Case-insensitive deliberately: `innerText` returns the RENDERED text, and
      // `DataUnavailable` uppercases its title through `text-transform`. A
      // case-sensitive match here reports a missing explanation that is on screen.
      expect(
        /News feed not loaded|No ESPN article in the current snapshot/i.test(text),
        `the news surface rendered no headlines and no explanation:\n${text}`
      ).toBe(true);
    }
  });
});
