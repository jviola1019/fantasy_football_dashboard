import { test, expect } from "@playwright/test";

/**
 * Registers a fresh user, then asserts the protected /settings/leagues route
 * renders for that session. Uses a per-run unique email so reruns don't collide
 * on the unique-constraint.
 */
test.describe("auth — register → /settings/leagues", () => {
  test("register a new user, then reach /settings/leagues", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /need an account/i }).click();

    const uniqueEmail = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await page.getByLabel(/^Email$/i).fill(uniqueEmail);
    await page.getByLabel(/^Password$/i).fill("playwright-passwd-123");
    await page.getByRole("button", { name: /create account/i }).click();

    await page.waitForURL("**/settings/leagues", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /your leagues/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /add a league/i })).toBeVisible();
  });

  test("unauthenticated visit to /settings/leagues redirects to /login", async ({ browser }) => {
    // Fresh context so no session cookie leaks from the prior test.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/settings/leagues");
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /sign in to rae/i })).toBeVisible();
    await context.close();
  });
});
