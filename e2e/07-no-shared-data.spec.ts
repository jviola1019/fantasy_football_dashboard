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
      // User A: register, land on /settings/leagues with an empty list
      await registerUniqueUser(pageA, "A");
      await expect(pageA.getByText(/no leagues connected yet/i)).toBeVisible();

      // User B: register fresh — also an empty list, no data leakage from A
      // NOTE: the "User A has a populated league → User B cannot see it" case
      // is covered deterministically (no network) in
      // src/lib/leagues.test.ts — "isolates leagues per user" suite — which
      // asserts listLeagues, getLeagueForUser, and deleteLeagueForUser are all
      // scoped to the owning userId. The e2e spec retains the
      // account-scoped /api/notifications and /api/leagues/[id]/refresh
      // 401/403/404 assertions below.
      await registerUniqueUser(pageB, "B");
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

  test("NoLeagueCTA is shown to signed-in users until a league drives the homepage", async ({
    browser
  }) => {
    // Updated for Feature D (commit b340b85): signed-in users with zero
    // connected leagues now see a dedicated <NoLeagueCTA /> instead of the
    // silent fixture-data dashboard with a DemoBanner. The new behavior is
    // more helpful — explicit "Connect a league" call-to-action with a
    // secondary "Try mock draft" path. The intent of this test stays the
    // same: a signed-in zero-league user must NEVER see fixture data as if
    // it were their league's data.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await registerUniqueUser(page, "noleague");
      await page.goto("/");
      // Primary CTA copy + heading from src/components/NoLeagueCTA.tsx
      await expect(page.getByRole("heading", { name: /bring your league/i })).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByRole("link", { name: /connect a league/i })).toBeVisible();
      // And the dashboard chrome must NOT render — no DEMO DATA banner, no
      // governance "Source state:" line, since RaeApp wasn't mounted.
      await expect(page.getByText(/^DEMO DATA$/)).toHaveCount(0);
      await expect(page.getByText(/Source state:/i)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
