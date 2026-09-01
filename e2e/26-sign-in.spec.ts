import { test, expect, type Page } from "@playwright/test";

/**
 * Sign-in, end to end, including the part that was broken.
 *
 * THE BUG THIS EXISTS FOR (audit 2026-08-23). Authentication SUCCEEDED — the
 * cookie was set, `/api/auth/session` returned the user, and the protected
 * route rendered — and the topbar still showed a **"Sign in" button**. The one
 * piece of chrome a person checks to confirm they are signed in was telling
 * them they were not.
 *
 * The cause: the server action passed `redirectTo`, so Auth.js threw
 * NEXT_REDIRECT and Next performed a CLIENT-side navigation. The React tree
 * survived it, so `SessionProvider` kept the unauthenticated session it fetched
 * on first mount. It also made the form's success branch unreachable, so the
 * first two attempts at fixing it were dead code that measured as no change.
 *
 * Every existing auth spec passed throughout: they assert redirects and
 * protected-route access, and this was a state that looked wrong while being
 * right underneath. So this file checks what a person actually sees.
 */
const unique = () => `e2e-signin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const PASSWORD = "e2e-sign-in-password";

const topbar = (page: Page) => page.locator('header[aria-label="RAE command bar"]');


/** Open the account dropdown and sign out. */
async function signOut(page: Page): Promise<void> {
  await topbar(page).getByRole("button", { name: /account|menu|@/i }).first().click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL((u) => !/settings/.test(u.pathname), { timeout: 30_000 });
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /need an account\? register/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /create account|register|sign up|sign in/i }).first().click();
  await page.waitForURL(/settings\/leagues/, { timeout: 30_000 });
}

test.describe("sign-in reaches the UI, not just the cookie", () => {
  test("registering signs you in AND the topbar says so immediately", async ({ page }) => {
    const email = unique();
    await register(page, email);

    // The assertion the old behaviour failed: no reload, no second navigation.
    await expect(topbar(page)).toContainText(email, { timeout: 20_000 });
    await expect(topbar(page).getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
  });

  test("signing out and back in shows the account again, without a reload", async ({ page }) => {
    const email = unique();
    await register(page, email);

    await signOut(page);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForURL(/settings\/leagues/, { timeout: 30_000 });

    await expect(topbar(page)).toContainText(email, { timeout: 20_000 });
  });

  test("the session endpoint and the UI agree", async ({ page }) => {
    // They disagreed before: the endpoint returned a user while the topbar
    // offered a sign-in button. Either alone would have looked fine.
    const email = unique();
    await register(page, email);

    const session = await page.evaluate(async () => {
      const r = await fetch("/api/auth/session");
      return (await r.json()) as { user?: { email?: string } };
    });
    expect(session.user?.email).toBe(email);
    await expect(topbar(page)).toContainText(email, { timeout: 20_000 });
  });

  test("a wrong password does not sign you in, and says so", async ({ page }) => {
    const email = unique();
    await register(page, email);
    await signOut(page);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).first().click();

    await expect(page.locator(".error-banner").first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unknown account fails the same way a wrong password does", async ({ page }) => {
    // Account-existence non-disclosure (F-005 / F-009). If these two differed,
    // the login form would be an account-enumeration oracle.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(unique());
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    const unknownError = await page
      .locator(".error-banner")
      .first()
      .innerText({ timeout: 20_000 });

    const email = unique();
    await register(page, email);
    await signOut(page);
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).first().click();
    const wrongPasswordError = await page
      .locator(".error-banner")
      .first()
      .innerText({ timeout: 20_000 });

    expect(unknownError.trim()).toBe(wrongPasswordError.trim());
  });

  test("a protected route still redirects an anonymous visitor to /login", async ({ browser }) => {
    // The other half: the fix must not have made anything reachable that was
    // not reachable before.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/settings/leagues");
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await ctx.close();
  });

  test("that redirect stays on the SAME ORIGIN", async ({ baseURL, browser }) => {
    // On a Vercel preview it did not. The Auth.js middleware wrapper was doing
    // the redirect and resolving /login against its own base URL, and AUTH_URL
    // overrides trustHost — so an anonymous visit to /settings/leagues on a
    // preview landed on PRODUCTION's login page. You would sign in there, come
    // back, and still be anonymous, because the session cookie belongs to a
    // different host. Sign-in was unreachable on every preview, silently, and a
    // test that only matched /login passed the whole time.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/settings/leagues");
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    await ctx.close();
  });
});
