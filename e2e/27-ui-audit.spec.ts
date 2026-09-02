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

/**
 * Floors on what the scan REACHED, per counter.
 *
 * Audit 2026-08-28. Only `textElements` and `focusables` were floored here, and
 * that is the narrow half of the problem. `spacingBoxes`, `panels` and
 * `sizedTextElements` were computed and never asserted in CI — only in
 * `scripts/audit-ui.ts`, which is not a CI step. The spacing check inspects a
 * hardcoded list of fourteen selectors, so renaming `.panel` in a redesign
 * drops `spacingBoxes` toward zero, the check silently stops measuring, and
 * this gate still passes because text and focusables are unchanged.
 *
 * That is the exact "green check that isn't checking" failure the whole harness
 * exists to prevent, reachable by a CSS class rename. Every counter the scan
 * emits is floored now.
 */
type Minima = {
  textElements: number;
  focusables: number;
  spacingBoxes: number;
  sizedTextElements: number;
  panels: number;
};

const MINIMA: Record<string, Minima> = {
  // Onboarding: a hero and a capability list, no PanelCard shells.
  "/": { textElements: 20, focusables: 3, spacingBoxes: 3, sizedTextElements: 20, panels: 0 },
  // The login form: a heading, two labelled inputs, a submit and a toggle.
  // Measured zero boxes and zero panels — it is a form, not a dashboard.
  "/login": { textElements: 5, focusables: 3, spacingBoxes: 0, sizedTextElements: 5, panels: 0 },
  /*
   * /mock-draft renders TWO different pages, and the floors must describe the
   * smaller one.
   *
   * `page.tsx:19-20` reads a cached FantasyPros snapshot and returns an honest
   * unavailable state when there is none. A development machine has one, so the
   * route renders a full draft board (250 sized elements, 7 boxes, 1 panel). CI
   * starts from an empty database, so it renders the unavailable state: 7 sized
   * elements, 2 boxes, 0 panels.
   *
   * The first version of these floors was calibrated locally and failed CI on
   * every viewport -- measuring in an environment the gate does not run in. The
   * numbers below are the CI state, reproduced locally with
   * `DATABASE_URL=file:.data/ci-repro.sqlite`.
   *
   * `panels: 0` means the governance check is skipped on this route in CI. That
   * is correct rather than a hole: an unavailable state has no model numbers to
   * govern, which is the condition the check keys on.
   */
  "/mock-draft": { textElements: 5, focusables: 1, spacingBoxes: 2, sizedTextElements: 5, panels: 0 }
};
const DEFAULT_MINIMA: Minima = {
  textElements: 20,
  focusables: 3,
  spacingBoxes: 5,
  sizedTextElements: 20,
  panels: 1
};

/**
 * Kinds that must be empty, and kinds that are ratchets.
 *
 * `type-scale` findings come in TWO shapes, and S5 split them because one
 * combined budget let each hide the other:
 *
 *   ELEMENT-LEVEL - a specific run of text rendering below the 9px floor. Now
 *     BANNED outright. It was 76 on /analytics when the redesign began (heatmap
 *     cells at 6.9px, key-driver rows at 7.1px, both SVG user units scaled down
 *     by their viewBox) and S5 drove it to zero on every route by moving those
 *     labels out of SVG and into HTML. Zero graduates a ratchet to a ban - the
 *     policy set in session 1, applied here for the second time after
 *     `tracking` in session 2.
 *
 *   ROUTE-LEVEL - one finding per route saying the type hierarchy has
 *     collapsed: more than 60% of rendered text on the bottom two rungs. Design
 *     work, owned by S6, so it stays a ratchet at 1 per route.
 *
 * A single budget of 76 meant /analytics could regain 75 sub-floor elements and
 * still pass. It had also gone slack on its own: when S5 measured, the real
 * count was 11, not 76 - the 76 was taken on a machine with a populated
 * snapshot cache and never rechecked. A ratchet sitting 65 above reality is not
 * a ratchet. Driving the element half to zero removes the problem rather than
 * re-baselining it, because zero is the same number in both environments.
 *
 * `cta` measured zero on every route, so it blocks from the start.
 */

/**
 * Route-level hierarchy findings permitted per route. S6 drives these to zero.
 * Measured 2026-08-28 across BOTH viewport projects: 63%, 70%, 84%, 87%, 70%
 * and 94% of rendered text on the bottom two rungs against a 60% limit.
 *
 * /mock-draft is 1 locally, where a cached snapshot makes it a full draft board,
 * and 0 in CI, where it degrades to the unavailable state - held at the LOCAL
 * maximum so a development run cannot false-fail. /trades passes at desktop on
 * its default tab (48%) and fails on mobile once the second tab is opened; only
 * the tab-state sweep sees that, which is why the sweep exists.
 */
const HIERARCHY_BASELINE: Record<string, number> = {
  "/dashboard": 1,
  "/players": 1,
  "/analytics": 1,
  "/draft": 1,
  "/waivers": 1,
  "/reports": 1,
  "/mock-draft": 1,
  "/trades": 1
};

/**
 * The scanner emits route-level findings with the literal selector "route" and
 * element-level ones with a real selector. Splitting on that is what lets each
 * half be judged on its own terms.
 */
const isRouteLevel = (f: { selector?: string }) => f.selector === "route";

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

      // Sub-floor SVG text: font-size is in USER UNITS, so a viewBox scales it.
      // 8 units in a 560-unit box laid out at 140 CSS px renders at 2px. This is
      // the case getComputedStyle cannot see on its own — it reports 8.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 560 100");
      svg.setAttribute("width", "140");
      svg.style.cssText = "position:fixed;top:300px;left:200px;z-index:99999";
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "10");
      text.setAttribute("y", "50");
      text.setAttribute("font-size", "8");
      text.textContent = "self-test: unreadably small";
      svg.appendChild(text);
      document.body.appendChild(svg);

      // A second solid-amber CTA, to prove the "at most one" rule is live.
      const rival = document.createElement("button");
      rival.type = "button";
      rival.textContent = "self-test: rival CTA";
      rival.style.cssText =
        "position:fixed;top:340px;left:200px;z-index:99999;background:rgb(215,168,87);padding:8px";
      document.body.appendChild(rival);
    });

    const after = (await scan(page)).findings;
    const added = (kind: string) =>
      after.filter((f) => f.kind === kind).length - before.filter((f) => f.kind === kind).length;

    expect(added("opacity"), "the opacity check must flag illegible text").toBeGreaterThan(0);
    expect(added("tabbing"), "the target-size check must flag crowded 12x12 buttons").toBeGreaterThan(0);
    // Every check gets its own canary. A shared one only proves the first
    // branch runs, which is how a partly-dead scan looks exactly like a clean
    // page — the failure this whole harness exists to prevent.
    // Asserted against the ELEMENT-level half specifically. `added("type-scale")`
    // alone would also be satisfied by a route-level hierarchy finding, and the
    // element half is the one that is now a ban at zero — a ban whose detector
    // has quietly stopped firing is indistinguishable from a clean page, which
    // is the failure this whole harness exists to prevent.
    const addedSubFloor =
      after.filter((f) => f.kind === "type-scale" && !isRouteLevel(f)).length -
      before.filter((f) => f.kind === "type-scale" && !isRouteLevel(f)).length;
    expect(
      addedSubFloor,
      "the type-scale check must flag SVG text scaled below the 9px floor"
    ).toBeGreaterThan(0);
    expect(added("cta"), "the CTA check must flag a second competing amber button").toBeGreaterThan(0);
  });

  for (const route of ROUTES) {
    test(`${route} has no spacing, tabbing, opacity or governance findings`, async ({ page }) => {
      await page.goto(route);
      const { scanned, findings } = await scanEveryTabState(page);

      // A route the scan never reached would report zero findings and look
      // clean. Every counter is floored, not just the two easy ones — a check
      // whose element set has gone empty is indistinguishable from a page with
      // nothing wrong.
      const minima = MINIMA[route] ?? DEFAULT_MINIMA;
      for (const [counter, floor] of Object.entries(minima) as [keyof Minima, number][]) {
        expect(
          scanned[counter] ?? 0,
          `${route}: the ${counter} check measured ${scanned[counter] ?? 0}, below its floor of ` +
            `${floor}. Either the page genuinely lost content, or the selectors that feed this ` +
            `check no longer match anything — which would make its zero findings meaningless.`
        ).toBeGreaterThanOrEqual(floor);
      }

      // Blocking kinds: zero tolerance, unchanged.
      const blocking = findings.filter((f) => f.kind !== "type-scale");
      expect(
        blocking.map((f) => `${f.kind}: ${f.selector} — ${f.detail}`),
        `${route} UI audit findings`
      ).toEqual([]);

      const typeFindings = findings.filter((f) => f.kind === "type-scale");

      // BAN. Element-level sub-floor text reached zero in S5 and stays there.
      const subFloor = typeFindings.filter((f) => !isRouteLevel(f));
      expect(
        subFloor.length,
        `${route}: ${subFloor.length} run(s) of text render below the 9px floor. ` +
          `This is a ban, not a ratchet - text whose size is data belongs in HTML, ` +
          `where it can use the type scale, not in SVG user units that a viewBox ` +
          `shrinks.` +
          subFloor.map((f) => ` [${f.selector}: ${f.detail}]`).join("")
      ).toBe(0);

      // RATCHET. Route-level hierarchy is S6's work; it may shrink, never grow.
      const hierarchy = typeFindings.filter(isRouteLevel);
      const allowed = HIERARCHY_BASELINE[route] ?? 0;
      expect(
        hierarchy.length,
        `${route}: hierarchy findings went from ${allowed} to ${hierarchy.length}. ` +
          `Lower the baseline when you fix some; never raise it.` +
          hierarchy.map((f) => ` [${f.detail}]`).join("")
      ).toBeLessThanOrEqual(allowed);
    });
  }

  /**
   * The SHIPPED stylesheet, not the source.
   *
   * `slopScan.test.ts` proves no component uses a banned utility, and that is
   * not the same claim as "the banned utility is not in the build". Tailwind v4
   * detects sources across the whole repository and reads markdown as readily as
   * TSX, so prose that NAMES a class compiles it. Measured 2026-09-02: the
   * production CSS carried the indigo/purple gradient pair and their theme
   * variables, and every occurrence traced back to the gate that bans them, to
   * CLAUDE.md, or to the report arguing against them. `className` with one of
   * those would then have RENDERED — the only thing between it and production
   * being a unit test.
   *
   * `globals.css` carries `@source not` for tests, e2e, markdown, reports, docs
   * and playwright artifacts. That is the fix; this is the check that it worked,
   * and it is here rather than in vitest because only a post-build run can see a
   * compiled stylesheet.
   */
  test("the compiled stylesheet defines no banned utility", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => (l as HTMLLinkElement).href)
    );
    expect(hrefs.length, "no stylesheet on the page — this check would pass vacuously").toBeGreaterThan(0);

    let css = "";
    for (const href of hrefs) {
      const res = await page.request.get(href);
      expect(res.ok(), `stylesheet ${href} did not load`).toBe(true);
      css += await res.text();
    }
    // A page's CSS is tens of kilobytes; anything less means the fetch failed
    // quietly and every assertion below would be trivially true.
    expect(css.length, "stylesheet fetch returned almost nothing").toBeGreaterThan(10_000);

    const banned = [
      "indigo-500",
      "indigo-600",
      "violet-500",
      "purple-500",
      "purple-600",
      "fuchsia-500",
      "rounded-2xl",
      "rounded-3xl",
      "shadow-2xl",
      "--color-indigo",
      "--color-purple",
      "--color-violet"
    ];
    const present = banned.filter((b) => css.includes(b));
    expect(
      present,
      `these are compiled into the shipped stylesheet: ${present.join(", ")}. ` +
        `Nothing in the product uses them, so they came from a file Tailwind ` +
        `should not be scanning — a test, a report, or a document that names the ` +
        `class while arguing against it. Add an \`@source not\` for it in globals.css.`
    ).toEqual([]);

    // Canary: the utilities the product DOES use must be here, or this check is
    // reading the wrong file and its silence means nothing.
    for (const used of ["bg-card", "text-muted-foreground", "rounded-md"]) {
      expect(css.includes(used), `expected the real utility ${used} in the stylesheet`).toBe(true);
    }
  });
});
