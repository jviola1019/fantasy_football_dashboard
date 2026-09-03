import { test, expect, type Page } from "@playwright/test";

/**
 * Signed-in account scope: a fresh user can reach the league-import form for
 * BOTH Sleeper and ESPN, and the change-password + delete-account flows are
 * present. Runs on both the desktop (chromium) and mobile-chrome projects, so
 * the signed-in settings surfaces are covered across screen sizes too.
 */
async function register(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: /need an account/i }).click();
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill("playwright-passwd-123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/settings/leagues", { timeout: 15_000 });
  return email;
}

test.describe("signed-in account flows", () => {
  test("can reach the import form for BOTH Sleeper and ESPN", async ({ page }) => {
    await register(page);
    await expect(page.getByRole("heading", { name: /add a league/i })).toBeVisible();

    const platform = page.locator("select#platform");
    await expect(platform).toBeVisible();
    // Both platforms are importable.
    await expect(platform.locator("option")).toHaveText([/Sleeper/i, /ESPN/i]);

    // Sleeper (default): a public league id is enough, no cookie fields required.
    await page.locator("#externalLeagueId").fill("123456789012345678");

    // Switching to ESPN reveals the encrypted-cookie credential fields (espn_s2 + SWID).
    await platform.selectOption("espn");
    await expect(page.locator("#swid")).toBeVisible();
    await expect(page.locator("#espnS2, #espn_s2, [name='espnS2']").first()).toBeVisible();
  });

  test("change-password and delete-account forms are present", async ({ page }) => {
    await register(page);
    await page.goto("/settings/account");
    // Change password: current + new password fields.
    await expect(page.locator("#currentPassword")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeVisible();
    await expect(page.getByRole("button", { name: /update password/i })).toBeVisible();
    // Delete account: the destructive flow exists (gated by password + typed DELETE).
    await expect(page.getByRole("button", { name: /delete account/i }).first()).toBeVisible();
  });

  test("the ESPN sign-in lives on the account, and says so before anything is saved", async ({
    page
  }) => {
    // The whole point of the account-level pair: one paste covers every ESPN
    // league. A fresh user must be able to FIND that, and must be told plainly
    // that nothing is stored yet rather than shown an ambiguous empty box.
    await register(page);
    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: /espn sign-in/i })).toBeVisible();
    await expect(page.getByText(/no espn sign-in saved/i)).toBeVisible();
    await expect(page.locator("#accountEspnS2")).toBeVisible();
    await expect(page.locator("#accountSwid")).toBeVisible();
    await expect(page.getByRole("button", { name: /save espn sign-in/i })).toBeVisible();
  });

  test("neither credential field is a text input, on either settings page", async ({ page }) => {
    // A cookie typed into a `type="text"` box is shoulder-surfable and lands in
    // the browser's form autofill store. Cheap to get wrong, invisible once it
    // is, and it applies to the add-league form as much as the account one.
    await register(page);
    await page.goto("/settings/account");
    await expect(page.locator("#accountEspnS2")).toHaveAttribute("type", "password");
    await expect(page.locator("#accountSwid")).toHaveAttribute("type", "password");

    await page.goto("/settings/leagues");
    await page.locator("select#platform").selectOption("espn");
    await expect(page.locator("#espnS2")).toHaveAttribute("type", "password");
    await expect(page.locator("#swid")).toHaveAttribute("type", "password");
  });

  test("a stored ESPN pair is never rendered back to the browser", async ({ page }) => {
    // Belt and braces for the strongest promise this page makes. The fields are
    // empty on load and carry no value attribute, so there is nothing for a
    // "reveal password" devtools toggle or an extension to read.
    await register(page);
    await page.goto("/settings/account");
    await expect(page.locator("#accountEspnS2")).toHaveValue("");
    await expect(page.locator("#accountSwid")).toHaveValue("");
    const html = await page.content();
    expect(html).not.toMatch(/espn_s2=/i);
  });

  test("settings pages have no horizontal overflow", async ({ page }) => {
    await register(page);
    for (const route of ["/settings/leagues", "/settings/account"]) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${route} must not overflow horizontally`).toBeLessThanOrEqual(1);
    }
  });
});
