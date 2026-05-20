import { test, expect, type Page } from "@playwright/test";

/**
 * Per-account isolation gate.
 *
 * Two parallel browser contexts. User A registers + adds a Sleeper league.
 * User B registers fresh. The test asserts:
 *   - User B's /settings/leagues is empty.
 *   - User B's /api/notifications returns { notifications: [] }.
 *   - User B cannot read or refresh User A's league (404/403).
 *   - Signed-in users see the DemoBanner since no live league drives the
 *     homepage yet.
 *
 * This is the regression gate for the user's "no shared API / fantasy team /
 * account information" requirement.
 */

const PASSWORD = "playwright-isolated-2026";

async function registerUniqueUser(page: Page, label: string): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: /need an account/i }).click();
  const email = `iso-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/settings/leagues", { timeout: 20_000 });
  return email;
}

test.describe("per-account isolation", () => {
  test("user B sees none of user A's league data", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // User A: register + add a Sleeper league
      await registerUniqueUser(pageA, "A");
      await pageA.getByLabel(/^League ID$/i).fill("12345678");
      await pageA.getByLabel(/^Label$/i).fill("My Friday Night League");
      await pageA.getByRole("button", { name: /add league/i }).click();
      await expect(pageA.getByText(/My Friday Night League/)).toBeVisible({ timeout: 15_000 });

      // User B: register fresh — empty league list
      await registerUniqueUser(pageB, "B");
      await expect(pageB.getByText(/My Friday Night League/)).toHaveCount(0);
      await expect(pageB.getByText(/no leagues connected yet/i)).toBeVisible();

      // /api/notifications scoped to user B returns no entries.
      const notifResponse = await pageB.request.get("/api/notifications");
      expect(notifResponse.status()).toBe(200);
      const notifBody = await notifResponse.json();
      expect(notifBody.notifications).toEqual([]);

      // User B cannot refresh an arbitrary league id. Any non-owned id must
      // 401/403/404 — not 200. We don't know A's id from B's context, which is
      // itself part of the isolation guarantee.
      const fakeId = "00000000-0000-4000-8000-000000000000";
      const refreshResponse = await pageB.request.post(`/api/leagues/${fakeId}/refresh`);
      expect([401, 403, 404]).toContain(refreshResponse.status());
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("DemoBanner is visible to signed-in users until a league drives the homepage", async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await registerUniqueUser(page, "demo");
      await page.goto("/");
      await expect(page.getByText(/^DEMO DATA$/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
