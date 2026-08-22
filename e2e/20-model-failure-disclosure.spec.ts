import { test, expect, type Page } from "@playwright/test";

/**
 * Audit 2026-08-20 §3 / §20 — the model-failure disclosure must be visible
 * ADJACENT to the decision-facing numbers, on the DEFAULT view.
 *
 * The precise failure this guards against: the warning existed, as
 * `sim.assumptions[4]`, but the only surface that rendered the full assumptions
 * list was inside the "Risk Analysis" tab, while the percentages sat on the
 * default "Multiverse" tab — and the one preview that did sit beside the numbers
 * rendered `assumptions.slice(0, 3)` truncated to 60 characters, which cut the
 * warning out entirely. Passing tests plus an invisible warning is exactly the
 * situation the audit calls "not equivalent to informed presentation", so the
 * assertions here are about VISIBILITY WITHOUT INTERACTION.
 */

async function gotoRoute(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("html#__next_error__")).toHaveCount(0);
  await expect(page.locator('header[aria-label="RAE command bar"]')).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Panels that present season-simulation output, and the route that hosts them. */
const SIM_PANELS: Array<{ id: string; route: string }> = [
  { id: "nexus-simulator", route: "/analytics" },
  { id: "team-signals", route: "/analytics" },
  { id: "report-outlook", route: "/reports" }
];

test.describe("model-failure disclosure sits beside the numbers", () => {
  for (const { id, route } of SIM_PANELS) {
    test(`#${id} shows the notice without any interaction`, async ({ page }) => {
      await gotoRoute(page, route);
      const panel = page.locator(`#${id}`);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel).toBeVisible({ timeout: 20_000 });

      // No tab click, no expander, no scroll into a drawer.
      const notice = panel.locator(".model-scenario-banner").first();
      await expect(notice, `#${id} must render the failure notice on first paint`).toBeVisible();

      // It must say what it is, not hedge.
      await expect(notice).toContainText(/not a forecast/i);
      // The claim is pinned to the EXTERNAL holdout, not the development set.
      await expect(notice).toContainText(/160 team-seasons/i);
      await expect(notice).toContainText(/never seen/i);

      // And it must point at reproducible evidence rather than asserting.
      await expect(notice).toContainText(/holdout-result\.md/);
    });
  }

  test("the notice is not inside a collapsed <details>", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const hiddenNotices = page.locator("details:not([open]) .model-scenario-banner");
    await expect(hiddenNotices).toHaveCount(0);
  });

  test("the default Nexus tab leads with the league baseline, not a model percentage", async ({
    page
  }) => {
    await gotoRoute(page, "/analytics");
    const panel = page.locator("#nexus-simulator");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // The prominent number is tagged as the structural baseline.
    const outlook = panel.locator(".scenario-outlook").first();
    await expect(outlook).toBeVisible();
    await expect(outlook.locator(".scenario-row-baseline-tag").first()).toContainText(
      /league baseline/i
    );

    // Every band label names the baseline, so none can read as a bare likelihood.
    const bands = outlook.locator(".scenario-row-band");
    const count = await bands.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(bands.nth(i)).toContainText(/baseline/i);
    }

    // The former presentation must be gone from the default view.
    await expect(panel).not.toContainText("95% Confidence Bands");
  });

  test("raw frequencies remain reachable and are labeled uncalibrated", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const panel = page.locator("#nexus-simulator");
    await panel.scrollIntoViewIfNeeded();
    const raw = panel.locator("details.scenario-raw").first();
    await expect(raw).toBeVisible();

    const summary = raw.locator("summary");
    await expect(summary).toContainText(/uncalibrated/i);

    // Nothing is hidden: the numbers are one keyboard-reachable step away.
    await summary.click();
    await expect(raw.locator(".ci-list")).toBeVisible();
    await expect(raw).toContainText(/simulated frequency under model assumptions/i);
    await expect(raw).toContainText(/not a forecast probability/i);
  });

  test("the raw disclosure is operable by keyboard alone (audit SS20)", async ({ page }) => {
    await gotoRoute(page, "/analytics");
    const panel = page.locator("#nexus-simulator");
    await panel.scrollIntoViewIfNeeded();
    const raw = panel.locator("details.scenario-raw").first();
    const summary = raw.locator("summary");
    await expect(summary).toBeVisible();

    // Focus without a mouse, and confirm the focus is actually visible rather
    // than only programmatic — a summary with outline:none would pass a naive
    // "is focused" check while being unusable.
    await summary.focus();
    await expect(summary).toBeFocused();
    const outline = await summary.evaluate((el) => {
      const cs = getComputedStyle(el, ":focus-visible");
      return { width: cs.outlineWidth, style: cs.outlineStyle };
    });
    expect(outline.style).not.toBe("none");

    // Enter toggles it open, then closed — native <details> semantics preserved.
    await page.keyboard.press("Enter");
    await expect(raw).toHaveAttribute("open", "");
    await expect(raw.locator(".ci-list")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(raw).not.toHaveAttribute("open", "");
  });

  test("the notice is exposed to assistive tech as a note, not an alert", async ({ page }) => {
    // role="note" is deliberate: this is a persistent property of the model, not
    // a transient event, so it must not interrupt a screen reader every render.
    await gotoRoute(page, "/analytics");
    const notice = page.locator("#nexus-simulator .model-scenario-banner").first();
    await expect(notice).toHaveAttribute("role", "note");
    await expect(page.locator('[role="alert"].model-scenario-banner')).toHaveCount(0);
  });

  test("edge-derived panels disclose the protocol-3 finding on first paint", async ({ page }) => {
    // Protocol 3 measured the reputation edge: it does not identify mispriced
    // players, and within a position it is inverted. Draft and waiver rankings
    // are presented as ADVICE, so the disclosure has to be visible without
    // interaction — the same rule §3 applied to the season simulator.
    for (const [route, panel] of [
      ["/analytics", "#market-intelligence"],
      ["/waivers", "#waiver-wire"]
    ] as const) {
      await gotoRoute(page, route);
      const p = page.locator(panel);
      await p.scrollIntoViewIfNeeded();
      await expect(p).toBeVisible({ timeout: 20_000 });
      const notice = p.locator(".model-scenario-banner").first();
      await expect(notice, `${panel} must disclose the edge finding`).toBeVisible();
      await expect(notice).toContainText(/positional scarcity/i);
      await expect(notice).toContainText(/not a market edge/i);
      await expect(notice).toContainText(/holdout-result-3\.md/);
    }
  });

  test("no surface claims arbitrage or mispricing any more", async ({ page }) => {
    // The panels previously said "Find edges. Exploit inefficiencies.",
    // "ARBITRAGE PLAYS" and "Arbitrage Opps". Protocol 3 refuted the claim
    // behind all three.
    const banned = /(arbitrage play|exploit inefficien|mispriced)/i;
    for (const route of ["/analytics", "/waivers", "/draft", "/players"]) {
      await gotoRoute(page, route);
      const body = await page.locator("body").innerText();
      expect(body, `${route} must not claim arbitrage`).not.toMatch(banned);
    }
  });

  test("no surface presents the simulation as calibrated or validated", async ({ page }) => {
    // Wording guard: the audit forbids these claims for this model.
    const banned = /\b(calibrated probabilit|validated forecast|predictive edge|expected true probability)/i;
    for (const route of ["/analytics", "/reports", "/dashboard"]) {
      await gotoRoute(page, route);
      const body = await page.locator("body").innerText();
      expect(body, `${route} must not claim calibration`).not.toMatch(banned);
    }
  });
});

test.describe("protocol 4 — the validated signal is disclosed with its limits", () => {
  // Every other notice in this file guards a RETRACTION. This one guards a
  // signal that passed, which is the harder case: the failure mode is not a
  // hidden warning but an overstated headline. So these tests assert the limits
  // travel with the claim, not merely that the claim appears.

  test("the waiver panel shows the validated-opportunity notice on first paint", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const panel = page.locator("#waiver-wire");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible({ timeout: 20_000 });

    const notice = panel.locator(".model-scenario-banner.is-validated").first();
    await expect(notice, "the validated variant must actually render").toBeVisible();
    await expect(notice).toContainText(/validated in-season signal/i);
    await expect(notice).toContainText(/holdout-result-4\.md/);
    // Not behind a disclosure widget, same rule as every other notice here.
    await expect(notice.locator("xpath=ancestor::details")).toHaveCount(0);
  });

  test("the notice states the real magnitude, not just the verdict", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const notice = page.locator("#waiver-wire .model-scenario-banner.is-validated").first();
    await expect(notice).toBeVisible({ timeout: 20_000 });
    const text = await notice.innerText();
    // 0.734 -> 0.748 out of fold. A reader must be able to see how small it is.
    expect(text, "must quote the baseline it improves on").toMatch(/0\.734/);
    expect(text, "must quote the improved figure").toMatch(/0\.748/);
    expect(text, "must not oversell").toMatch(/small/i);
  });

  test("the scope limit is present, so nobody reads it as a draft claim", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const notice = page.locator("#waiver-wire .model-scenario-banner.is-validated").first();
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(/in-season only/i);
    // Protocols 1-3 tested the pre-season regime and it failed; the notice must
    // say so rather than leaving the reader to assume it generalises.
    await expect(notice).toContainText(/pre-season valuation was tested/i);
  });

  test("the validated notice is a note, not an alert, and is exposed as one", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const notice = page.locator("#waiver-wire .model-scenario-banner.is-validated").first();
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAttribute("role", "note");
  });

  test("the retracted and the validated notice appear together", async ({ page }) => {
    // Showing either alone would misrepresent what drives the waiver ranking.
    await gotoRoute(page, "/waivers");
    const panel = page.locator("#waiver-wire");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator(".model-scenario-banner.is-validated")).toHaveCount(1);
    await expect(panel.locator(".model-scenario-banner:not(.is-validated)")).toHaveCount(1);
  });

  test("the validated notice never claims a draft or market edge", async ({ page }) => {
    await gotoRoute(page, "/waivers");
    const notice = page.locator("#waiver-wire .model-scenario-banner.is-validated").first();
    await expect(notice).toBeVisible({ timeout: 20_000 });
    const text = await notice.innerText();
    expect(text).not.toMatch(/\b(arbitrage|mispriced|guarantee|beat the market)\b/i);
  });
});
