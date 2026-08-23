import { test, expect } from "@playwright/test";

/**
 * The validated in-season ranking, as a standing gate.
 *
 * This is the only model in the product with a positive out-of-sample result,
 * which makes it the easiest one to overstate and the most damaging one to
 * misrepresent. A refuted model disclosed as refuted harms nobody; a validated
 * model shown without its limits is a claim the evidence does not cover.
 *
 * So these check the DISCLOSURE as carefully as the numbers.
 */
test.describe("validated in-season ranking", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/waivers");
    await expect(page.locator("#in-season-board")).toBeVisible();
  });

  test("ranks players, and shows both inputs it ranks on", async ({ page }) => {
    const board = page.locator("#in-season-board");
    // Case-insensitive: `th` is uppercased by CSS and `innerText` returns the
    // rendered text, so asserting source casing would be testing the stylesheet.
    const headers = await board.locator("table thead th").allInnerTexts();
    expect(headers.map((h) => h.trim().toLowerCase())).toEqual([
      "player",
      "position",
      "pts/g",
      "touch/g",
      "score"
    ]);

    const rows = board.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(4);
  });

  test("is sorted by score, descending", async ({ page }) => {
    const cells = await page
      .locator("#in-season-board table tbody tr td:nth-child(5)")
      .allInnerTexts();
    const scores = cells.map((c) => Number(c.replace("+", "")));
    expect(scores.every((s) => Number.isFinite(s))).toBe(true);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  test("states the measured magnitude, not just that it was validated", async ({ page }) => {
    // "Validated" without a number invites the reader to supply their own, and
    // the number here is small: +0.0137 and +0.0195 Spearman.
    const board = page.locator("#in-season-board");
    await expect(board).toContainText("0.0137");
    await expect(board).toContainText("0.0195");
  });

  test("states the in-season scope, so it cannot be read as a draft claim", async ({ page }) => {
    await expect(page.locator("#in-season-board")).toContainText(/in-season only/i);
  });

  test("refuses forecast and probability framing", async ({ page }) => {
    const text = await page.locator("#in-season-board").innerText();
    expect(text).toMatch(/ranking, not a forecast/i);
    expect(text).not.toMatch(/\bprobability of\b/i);
  });

  test("discloses that the weight's magnitude did not generalise", async ({ page }) => {
    // Protocol 5's D2 refit the weight on the evaluation set and got 1.42
    // against the fitted 0.76. Direction generalised; size did not.
    await expect(page.locator("#in-season-board")).toContainText("1.42");
  });

  test("points at the evidence file", async ({ page }) => {
    await expect(page.locator("#in-season-board")).toContainText("holdout-protocol-5");
  });

  test("announces a positive result in the positive palette, not the failure one", async ({ page }) => {
    // The notice component has a `is-validated` variant. Without it, the one
    // model that worked announced itself in warning colours — miscolouring a
    // result is miscommunicating it.
    await expect(page.locator("#in-season-board .model-scenario-banner.is-validated")).toHaveCount(1);
  });

  test("stays separate from the refuted edge ranking below it", async ({ page }) => {
    // Folding a validated ranking into a refuted one produces a third ordering
    // neither result covers, and a reader could not tell which part they were
    // trusting.
    const board = page.locator("#in-season-board");
    const waiverTable = page.locator("#waiver-wire .table-wrap").last();
    await expect(board).toBeVisible();
    await expect(waiverTable).toBeVisible();
    expect(await board.locator("table").count()).toBe(1);
  });
});
