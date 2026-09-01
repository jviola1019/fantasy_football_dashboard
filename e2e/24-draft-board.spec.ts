import { test, expect, type Page } from "@playwright/test";

/**
 * The draft board's state machine, as a standing gate (audit 2026-08-23).
 *
 * Every panel on `/draft` derives from two sets — the players you took and the
 * players an opponent took — and every one of them has to recompute on every
 * pick. That is the product's most stateful surface and none of it was covered:
 * the existing specs asserted the panel RENDERS, not that it responds.
 *
 * These were written as a throwaway audit script first, and are kept because a
 * one-off audit proves a moment while a test proves it every run.
 */
const counterText = (page: Page) => page.locator("#draft-intelligence .muted-text").first();

async function counts(page: Page): Promise<{ mine: number; taken: number; left: number }> {
  const raw = await counterText(page).innerText();
  const m = /(\d+) mine · (\d+) taken · (\d+) left/.exec(raw);
  if (!m) throw new Error(`draft counter did not match its documented shape: "${raw}"`);
  return { mine: Number(m[1]), taken: Number(m[2]), left: Number(m[3]) };
}

const boardNames = (page: Page) =>
  page.locator("#draft-intelligence table tbody tr td:first-child").allInnerTexts();

const clean = (s: string) => s.replace(/^★\s*/, "").trim();

test.describe("draft board responds to every pick", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/draft");
    await expect(page.locator("#draft-intelligence")).toBeVisible();
    await expect(counterText(page)).toContainText("left");
  });

  test("drafting to your team moves the player from the pool to your roster", async ({ page }) => {
    const before = await counts(page);
    const name = clean((await boardNames(page))[0]!);

    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-mine").click();

    const after = await counts(page);
    expect(after.mine).toBe(before.mine + 1);
    expect(after.left).toBe(before.left - 1);
    expect(after.taken).toBe(before.taken);

    // Gone from the board, present on the roster. Both halves matter: a player
    // who leaves the pool without arriving anywhere has been deleted, not drafted.
    expect((await boardNames(page)).map(clean)).not.toContain(name);
    await expect(page.locator("#draft-intelligence")).toContainText(name);
  });

  test("an opponent pick leaves the pool WITHOUT joining your roster", async ({ page }) => {
    const before = await counts(page);
    const name = clean((await boardNames(page))[0]!);

    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-opp").click();

    const after = await counts(page);
    expect(after.taken).toBe(before.taken + 1);
    expect(after.left).toBe(before.left - 1);
    // The distinction the whole mock-draft feature rests on.
    expect(after.mine).toBe(before.mine);
    expect((await boardNames(page)).map(clean)).not.toContain(name);
  });

  test("every dependent tab recomputes after a pick", async ({ page }) => {
    const mine = clean((await boardNames(page))[0]!);
    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-mine").click();
    const opponent = clean((await boardNames(page))[0]!);
    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-opp").click();

    for (const tab of ["Recommendations", "Tier Collapse", "Big Board"]) {
      await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
      const panel = page.locator("#draft-intelligence");
      await expect(panel, `${tab} must not still offer a drafted player`).not.toContainText(opponent);
      if (tab !== "Recommendations") continue;
      await expect(panel).not.toContainText(mine);
    }
  });

  test("release returns a pick to the pool and reset restores the board exactly", async ({ page }) => {
    const start = await counts(page);
    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-mine").click();
    await page.locator("#draft-intelligence table tbody tr").first().locator(".draft-btn-opp").click();
    expect((await counts(page)).left).toBe(start.left - 2);

    await page.locator("#draft-intelligence .draft-roster-row").first().click();
    expect((await counts(page)).left).toBe(start.left - 1);

    await page.locator("#draft-intelligence .draft-reset-btn").click();
    const end = await counts(page);
    expect(end).toEqual(start);
  });
});

test.describe("bye week is on the board", () => {
  test("the live board has a Bye column beside Position", async ({ page }) => {
    await page.goto("/draft");
    const headers = await page.locator("#draft-intelligence table thead th").allInnerTexts();
    expect(headers.some((h) => /^position$/i.test(h.trim()))).toBe(true);
    expect(headers.some((h) => /^bye$/i.test(h.trim()))).toBe(true);
  });

  test("every row has exactly as many cells as the header has columns", async ({ page }) => {
    /**
     * Column alignment, pinned.
     *
     * Adding the Bye column, I replaced the TEAM cell instead of inserting
     * beside it: the header kept seven columns while every body row had six, so
     * every value shifted one place left. Nothing looked broken -- team codes
     * are short and bye weeks are small integers, so "BYE 8" sat under TEAM and
     * a true value of 84 sat under BYE, all of it perfectly plausible.
     *
     * A screenshot would not have caught it. Counting cells does.
     */
    await page.goto("/draft");
    const headerCount = await page.locator("#draft-intelligence table thead th").count();
    expect(headerCount).toBeGreaterThan(0);
    const rows = page.locator("#draft-intelligence table tbody tr");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const cells = await rows.nth(i).locator("td").count();
      // A colspan row (the empty state) is legitimately one cell.
      if (cells === 1) continue;
      expect(cells, `row ${i} must have ${headerCount} cells`).toBe(headerCount);
    }
  });

  test("every row shows a bye week or an explicit em dash, never a blank", async ({ page }) => {
    await page.goto("/draft");
    const byeIdx = (await page.locator("#draft-intelligence table thead th").allInnerTexts()).findIndex(
      (h) => /^bye$/i.test(h.trim())
    );
    expect(byeIdx).toBeGreaterThan(-1);
    const cells = await page
      .locator(`#draft-intelligence table tbody tr td:nth-child(${byeIdx + 1})`)
      .allInnerTexts();
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      // A blank cell is the failure mode: it reads as "no bye" rather than as
      // "not known", and those are different claims.
      expect(c.trim(), "bye cell must not be empty").not.toBe("");
      expect(c.trim()).toMatch(/^(—|\d{1,2}(\s*clash)?)$/i);
    }
  });

  /**
   * Draft the running back whose bye is SHARED with another running back.
   *
   * The first RB on the board is not necessarily one of them -- the board is
   * ordered by recommendation score, not by bye -- so picking row order made
   * this test pass or fail on which RB happened to sort first. Read the column
   * and choose deterministically instead.
   */
  async function draftAnRbWithASharedBye(page: Page): Promise<string> {
    const headers = await page.locator("#draft-intelligence table thead th").allInnerTexts();
    const posIdx = headers.findIndex((h) => /^position$/i.test(h.trim()));
    const byeIdx = headers.findIndex((h) => /^bye$/i.test(h.trim()));
    expect(posIdx).toBeGreaterThan(-1);
    expect(byeIdx).toBeGreaterThan(-1);

    const rows = page.locator("#draft-intelligence table tbody tr");
    const n = await rows.count();
    const rbs: Array<{ i: number; bye: string }> = [];
    for (let i = 0; i < n; i += 1) {
      const cells = rows.nth(i).locator("td");
      const pos = (await cells.nth(posIdx).innerText()).trim();
      const bye = (await cells.nth(byeIdx).innerText()).trim();
      if (pos === "RB" && /^\d+$/.test(bye)) rbs.push({ i, bye });
    }
    const shared = rbs.find((r) => rbs.filter((o) => o.bye === r.bye).length > 1);
    expect(
      shared,
      "the fixture board must contain two running backs sharing a bye, or the clash warning is unreachable"
    ).toBeDefined();
    await rows.nth(shared!.i).locator(".draft-btn-mine").click();
    return shared!.bye;
  }

  test("a same-position bye clash is flagged in words, not colour alone", async ({ page }) => {
    await page.goto("/draft");
    await draftAnRbWithASharedBye(page);
    // WCAG 1.4.1: the word carries the meaning, the tint only reinforces it.
    await expect(page.locator("#draft-intelligence .draft-bye-flag").first()).toContainText(/clash/i);
  });


  /** See the note in the test below. Returns the shared bye week. */
  async function draftLowestRankedRbWithASharedBye(page: Page): Promise<string> {
    const headers = await page.locator("#draft-intelligence table thead th").allInnerTexts();
    const posIdx = headers.findIndex((h) => /^position$/i.test(h.trim()));
    const byeIdx = headers.findIndex((h) => /^bye$/i.test(h.trim()));
    const rows = page.locator("#draft-intelligence table tbody tr");
    const n = await rows.count();
    const rbs: Array<{ i: number; bye: string }> = [];
    for (let i = 0; i < n; i += 1) {
      const cells = rows.nth(i).locator("td");
      const pos = (await cells.nth(posIdx).innerText()).trim();
      const bye = (await cells.nth(byeIdx).innerText()).trim();
      if (pos === "RB" && /^[0-9]+$/.test(bye)) rbs.push({ i, bye });
    }
    const group = rbs.filter((r) => rbs.filter((o) => o.bye === r.bye).length > 1);
    expect(group.length, "two running backs must share a bye for this to be reachable").toBeGreaterThan(1);
    // Board rows are ordered by score, so the LAST index in the group is the
    // lowest-ranked of them.
    const target = group[group.length - 1]!;
    await rows.nth(target.i).locator(".draft-btn-mine").click();
    return target.bye;
  }

  test("the recommender states the clash as a reason", async ({ page }) => {
    /**
     * Draft the LOWEST-ranked running back among those sharing a bye.
     *
     * The queue shows the top eight, and the board is ordered by draft score.
     * Drafting whichever shared-bye RB happened to come first could remove the
     * only one the queue would have shown, and the test then failed on pool
     * composition rather than on the feature. Taking the lowest-ranked of the
     * group leaves the higher-ranked partner in the queue by construction.
     */
    await page.goto("/draft");
    const bye = await draftLowestRankedRbWithASharedBye(page);
    await page.getByRole("tab", { name: /Recommendations/i }).click();
    // Built without a template literal: escaping a \d through the layers that
    // produced this file dropped the backslash and left a literal "d+", so the
    // test failed while the feature worked. String concatenation has no
    // escaping to lose.
    const pattern = new RegExp("bye week " + bye + " clashes with [0-9]+ RB", "i");
    await expect(page.locator("#draft-intelligence")).toContainText(pattern);
  });
});
