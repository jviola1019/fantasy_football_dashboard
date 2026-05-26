import { test, expect, type Page } from "@playwright/test";

/**
 * Wrong-password UX regression gate (Sprint 2 Task 13).
 *
 * Verifies that:
 *   1. A failed sign-in surfaces a friendly, accessible error string on /login
 *      (no page redirect, no silent failure).
 *   2. The friendly error is mapped through src/lib/auth/errors.ts and never
 *      echoes raw Auth.js internals (no "CredentialsSignin" leak, no stack
 *      trace, no SQL details).
 *   3. The error is wrapped in role="alert" so screen-readers announce it.
 *   4. A subsequent sign-in with the CORRECT password still works
 *      (proves the error didn't put the form into a broken state).
 */

const PASSWORD_CORRECT = "playwright-correct-2026";
const PASSWORD_WRONG = "playwright-wrong-9999";

async function registerUser(page: Page): Promise<string> {
  const email = `wrong-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: /need an account/i }).click();
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(PASSWORD_CORRECT);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/settings/leagues", { timeout: 20_000 });
  return email;
}

test.describe("wrong-password UX", () => {
  test("displays friendly error on bad password without leaking auth internals", async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      const email = await registerUser(page);

      // Sign out — the simplest path is to clear the auth cookie. Auth.js's
      // session cookie name is environment-dependent; deleting all cookies
      // is fast and reliable for a fresh-state test.
      await ctx.clearCookies();

      // Attempt sign-in with the wrong password.
      await page.goto("/login");
      await page.getByLabel(/^Email$/i).fill(email);
      await page.getByLabel(/^Password$/i).fill(PASSWORD_WRONG);
      await page.getByRole("button", { name: /^Sign in$/i }).click();

      // Wait for the friendly error to populate the error banner. We
      // intentionally locate by class (not by role) because Next.js renders
      // a sibling <div role="alert" aria-live="assertive"
      // id="__next-route-announcer__"> for route-change announcements —
      // getByRole("alert") would hit a strict-mode-violation matching both.
      // The LoginForm at src/app/login/LoginForm.tsx:110 renders our error
      // as <p className="error-banner" role="alert">{error}</p>, so the
      // class disambiguates while still asserting accessible semantics
      // (the class is only used on the error-banner element).
      const alert = page.locator(".error-banner");
      await expect(alert).toContainText(/email or password is incorrect/i, {
        timeout: 10_000
      });
      // Belt + suspenders: the element we matched IS the role="alert"
      // element, so screen-reader semantics are still verified.
      await expect(alert).toHaveAttribute("role", "alert");

      // Snapshot the final string for the no-leak assertions.
      const errorText = (await alert.textContent()) ?? "";

      // No Auth.js internals leak. These strings would indicate the
      // mapAuthError contract is broken.
      expect(errorText).not.toMatch(/CredentialsSignin/);
      expect(errorText).not.toMatch(/AuthError/);
      expect(errorText).not.toMatch(/stack trace/i);
      expect(errorText).not.toMatch(/drizzle/i);
      expect(errorText).not.toMatch(/postgres|sqlite/i);
      // Should not include any path or filename.
      expect(errorText).not.toMatch(/\.ts:|\.js:|node_modules/i);

      // Browser stayed on /login (no redirect on failure).
      expect(page.url()).toMatch(/\/login(\?.*)?$/);

      // Now confirm the correct password still works — the error didn't
      // leave the form unusable.
      await page.getByLabel(/^Password$/i).fill(PASSWORD_CORRECT);
      await page.getByRole("button", { name: /^Sign in$/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 20_000
      });
    } finally {
      await ctx.close();
    }
  });
});
