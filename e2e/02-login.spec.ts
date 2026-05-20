import { test, expect } from "@playwright/test";

test.describe("/login", () => {
  test("renders the credentials form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in to rae/i })).toBeVisible();
    await expect(page.getByLabel(/^Email$/i)).toBeVisible();
    await expect(page.getByLabel(/^Password$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("can toggle to the register variant", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /need an account/i }).click();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
    await expect(page.getByLabel(/name/i)).toBeVisible();
  });
});
