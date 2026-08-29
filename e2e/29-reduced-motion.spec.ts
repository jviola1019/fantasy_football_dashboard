import { expect, test } from "@playwright/test";

/**
 * `prefers-reduced-motion: reduce` is honoured — and stays honoured.
 *
 * Nothing tested this before. `globals.css:203-205` neutralises CSS animation
 * globally with an `!important` block, and `useReducedMotion` is consulted in
 * exactly ONE component (`NexusSimulator.tsx:176`), and no Playwright project
 * ever set the preference. So the guarantee rested entirely on a stylesheet rule
 * nobody exercised.
 *
 * That gap matters now specifically. The redesign adopts React Bits components,
 * every one of which is JS-driven — and the Web Animations API is exactly what
 * a CSS media query CANNOT stop. `NexusSimulator` already hit this and gates its
 * path-draw in JS for that reason; the comment there says so. Each new animated
 * component has to do the same, and this spec is what makes "has to" mean
 * something.
 *
 * The canary is therefore a JS animation, not a CSS one: a CSS canary would be
 * neutralised by the very rule under test and would prove nothing.
 */

const ROUTES = ["/", "/dashboard", "/players", "/analytics", "/draft", "/waivers", "/trades", "/reports"] as const;

/** Anything longer than this is motion a reduced-motion user asked not to see. */
const MAX_MS = 50;

/**
 * Durations of every animation still running, in ms.
 *
 * `Infinity` is reported as-is rather than filtered. The UI audit deliberately
 * ignores infinite animations because it would hang waiting for them; here they
 * are the single most important case, since a loop is motion that never stops.
 */
const RUNNING_DURATIONS = `(() => document.getAnimations()
  .filter((a) => a.playState === "running" || a.playState === "paused")
  .map((a) => {
    const t = a.effect && a.effect.getComputedTiming();
    if (!t) return 0;
    const iterations = t.iterations === Infinity ? Infinity : (t.iterations || 1);
    const duration = typeof t.duration === "number" ? t.duration : 0;
    return duration * iterations;
  }))()`;

test.describe("prefers-reduced-motion is honoured", () => {
  // Via contextOptions, which is the typed surface in this Playwright version —
  // a bare `reducedMotion` key type-errors even though it takes effect, and a
  // spec that only works because a type error was ignored is a spec waiting to
  // stop working.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the preference actually reaches the page", async ({ page }) => {
    // Asserted before anything else, because every test below is vacuous if the
    // browser never received the preference: with motion NOT reduced, the CSS
    // that suppresses it does not apply, and a passing run would mean the
    // opposite of what it claims.
    await page.goto("/dashboard");
    const reduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    expect(reduced, "the emulated media preference did not reach the page").toBe(true);
  });

  test("the check can see motion that CSS cannot stop", async ({ page }) => {
    await page.goto("/dashboard");

    // A Web Animations API animation. The global CSS rule cannot touch it —
    // which is the entire point, and the reason this canary is not a CSS one.
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.textContent = "self-test";
      el.style.cssText = "position:fixed;top:400px;left:400px;width:20px;height:20px";
      document.body.appendChild(el);
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, iterations: Infinity });
    });

    const durations = (await page.evaluate(RUNNING_DURATIONS)) as number[];
    expect(
      durations.some((d) => d > MAX_MS),
      "the reduced-motion check must detect a JS-driven animation — if this fails, " +
        "every assertion below is vacuous"
    ).toBe(true);
  });

  for (const route of ROUTES) {
    test(`${route} runs no motion under reduced-motion`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      // A beat for anything that starts on mount. Entrance animations are the
      // case this is aimed at, so waiting for them is the point, not a race.
      await page.waitForTimeout(600);

      const durations = (await page.evaluate(RUNNING_DURATIONS)) as number[];
      const offending = durations.filter((d) => d > MAX_MS);
      expect(
        offending,
        `${route}: ${offending.length} animation(s) still running under ` +
          `prefers-reduced-motion, longest ${Math.max(0, ...offending)}ms. CSS animation is ` +
          `neutralised globally by globals.css; anything surviving here is JS-driven and needs ` +
          `an explicit useReducedMotion gate, the way NexusSimulator.tsx:176 does it.`
      ).toEqual([]);
    });
  }
});
