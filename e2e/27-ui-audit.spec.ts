import { test, expect, type Page } from "@playwright/test";
import { IN_PAGE_AUDIT, WAIT_FOR_ANIMATIONS, type UiFinding } from "../src/lib/ops/uiAudit";

/**
 * Spacing, tabbing, opacity and model-output governance, as a standing gate.
 *
 * `npm run audit:ui` runs the same scan with richer reporting and can be pointed
 * at a deployment. This spec exists so the four checks cannot quietly rot: it
 * uses the SAME module, so there is one implementation of the measurement.
 *
 * Each check exists because the tooling already in place cannot see it:
 *
 *   OPACITY   axe reads `color`; the compositor applies `opacity` afterwards.
 *             `--blue` at .75 measured 4.13:1 with every scan green.
 *   TABBING   axe treats `aria-controls` as advisory, so 42 dangling IDREFs
 *             across five routes passed every scan for two days.
 *   SPACING   nothing reads padding. A 14px panel header beside a 16px one is
 *             invisible in review and visible on screen.
 *   MODEL     the six governance fields are a claim about each route, so they
 *   OUTPUTS   can be checked as one.
 *
 * The self-test is not ceremony. The first working version of this scan reported
 * "opacity: 0" on every route because the serialised contrast function threw
 * before comparing anything — zero findings, zero comparisons. A check that has
 * stopped firing looks exactly like a page that has stopped offending.
 */
type Scan = { scanned: Record<string, number>; findings: UiFinding[] };

const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/players",
  "/analytics",
  "/draft",
  "/waivers",
  "/trades",
  "/reports",
  "/mock-draft"
] as const;

/** Routes that are legitimately sparse, with the reason. */
const MINIMA: Record<string, { textElements: number; focusables: number }> = {
  "/login": { textElements: 5, focusables: 3 },
  // Renders an honest unavailable state without a cached FantasyPros snapshot.
  "/mock-draft": { textElements: 5, focusables: 1 }
};
const DEFAULT_MINIMA = { textElements: 20, focusables: 3 };

/** Scan only once the reveal animations have settled — see WAIT_FOR_ANIMATIONS. */
async function scan(page: Page): Promise<Scan> {
  await page.evaluate(WAIT_FOR_ANIMATIONS);
  return (await page.evaluate(IN_PAGE_AUDIT)) as Scan;
}

async function scanEveryTabState(page: Page): Promise<Scan> {
  const passes: Scan[] = [await scan(page)];

  // Charts and tables behind inactive tabs are unmounted, so one pass measures
  // one tab's content and silently ignores the rest.
  const tabIds = (await page.evaluate(
    `[...document.querySelectorAll("[role='tab']")].map((t) => t.id).filter(Boolean)`
  )) as string[];
  for (const id of tabIds) {
    try {
      await page.click(`#${id}`, { timeout: 5_000 });
      passes.push(await scan(page));
    } catch {
      // Unclickable tabs surface through the wiring and target-size checks.
    }
  }

  const scanned: Record<string, number> = {};
  const seen = new Set<string>();
  const findings: UiFinding[] = [];
  for (const pass of passes) {
    for (const [k, v] of Object.entries(pass.scanned)) scanned[k] = Math.max(scanned[k] ?? 0, v);
    for (const f of pass.findings) {
      const key = `${f.kind}|${f.selector}|${f.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  return { scanned, findings };
}

test.describe("UI audit", () => {
  test("the scan can see defects it is shown", async ({ page }) => {
    await page.goto("/dashboard");
    const before = (await scan(page)).findings;

    await page.evaluate(() => {
      const faint = document.createElement("div");
      faint.textContent = "self-test: deliberately illegible";
      faint.style.cssText = "color:#8aa4b8;opacity:0.55;font-size:13px;padding:8px";
      document.body.appendChild(faint);

      // Two 12x12 buttons 4px apart: undersized, hit area not extended, and too
      // close for the WCAG 2.5.8 spacing exception to apply.
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;top:200px;left:200px;z-index:99999";
      for (let i = 0; i < 2; i += 1) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "x";
        b.style.cssText = `position:absolute;left:${i * 16}px;top:0;width:12px;height:12px;padding:0`;
        wrap.appendChild(b);
      }
      document.body.appendChild(wrap);
    });

    const after = (await scan(page)).findings;
    const added = (kind: string) =>
      after.filter((f) => f.kind === kind).length - before.filter((f) => f.kind === kind).length;

    expect(added("opacity"), "the opacity check must flag illegible text").toBeGreaterThan(0);
    expect(added("tabbing"), "the target-size check must flag crowded 12x12 buttons").toBeGreaterThan(0);
  });

  for (const route of ROUTES) {
    test(`${route} has no spacing, tabbing, opacity or governance findings`, async ({ page }) => {
      await page.goto(route);
      const { scanned, findings } = await scanEveryTabState(page);

      // A route the scan never reached would report zero findings and look clean.
      const minima = MINIMA[route] ?? DEFAULT_MINIMA;
      expect(scanned.textElements ?? 0, `${route}: text elements scanned`).toBeGreaterThanOrEqual(
        minima.textElements
      );
      expect(scanned.focusables ?? 0, `${route}: focusable elements scanned`).toBeGreaterThanOrEqual(
        minima.focusables
      );

      expect(
        findings.map((f) => `${f.kind}: ${f.selector} — ${f.detail}`),
        `${route} UI audit findings`
      ).toEqual([]);
    });
  }
});
