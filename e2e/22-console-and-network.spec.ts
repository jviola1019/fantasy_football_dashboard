import { test, expect, type ConsoleMessage, type Request } from "@playwright/test";

/**
 * CLAUDE.md testing rules require "no console errors, no broken network calls"
 * for every major UI change, and nothing in this suite was checking either.
 * Every other spec asserts what the page SAYS; this one asserts the page is not
 * quietly failing underneath.
 *
 * Two things are deliberately NOT treated as failures, because they would make
 * the gate dishonest rather than strict:
 *
 *  - Requests to third-party data hosts. RAE talks to Sleeper, nflverse, ESPN
 *    and others; in a fixture run those are expected to be absent or refused,
 *    and failing on them would test the network rather than the app.
 *  - React's dev-only hydration/act warnings, which do not appear in the
 *    production build these tests run against.
 *
 * Everything from RAE's own origin is in scope, including its API routes.
 */
const ROUTES = [
  "/",
  "/dashboard",
  "/players",
  "/analytics",
  "/draft",
  "/waivers",
  "/trades",
  "/reports",
  "/login",
  "/mock-draft",
  "/settings/leagues",
  "/settings/account"
];

/** Hosts RAE deliberately talks to; their availability is not under test here. */
const THIRD_PARTY = /(sleeper\.app|nflverse|espn\.com|fantasypros|fantasycalc|keeptradecut|dynastyprocess|open-meteo|githubusercontent|github\.com|google|gstatic)/i;

test.describe("no console errors and no broken same-origin requests", () => {
  for (const route of ROUTES) {
    test(`${route} is clean`, async ({ page, baseURL }) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // A blocked third-party fetch surfaces as a console error too.
        if (THIRD_PARTY.test(text)) return;
        consoleErrors.push(text);
      });

      page.on("pageerror", (err: Error) => {
        consoleErrors.push(`uncaught: ${err.message}`);
      });

      page.on("requestfailed", (req: Request) => {
        const url = req.url();
        if (THIRD_PARTY.test(url)) return;
        if (baseURL && !url.startsWith(baseURL)) return;

        // ERR_ABORTED means the CLIENT cancelled the request. It is never
        // evidence that a server call broke, and both sources of it here are
        // normal behaviour:
        //
        //  - Next.js speculatively prefetches every visible <Link> as an RSC
        //    payload (`?_rsc=`) and aborts the ones it no longer needs;
        //  - TradeCenter fires two network-bound server actions on mount
        //    (POST /trades), which are still in flight when the page is torn
        //    down at the end of the test.
        //
        // Counting these reported 19 "broken" calls on pages that are fine,
        // which would have trained everyone to ignore this gate. Genuine
        // breakage still fails: ERR_CONNECTION_REFUSED, ERR_FAILED, DNS errors
        // and every 4xx/5xx are all caught below and by the response handler.
        const errorText = req.failure()?.errorText ?? "failed";
        if (errorText === "net::ERR_ABORTED") return;

        failedRequests.push(`${req.method()} ${url} — ${errorText}`);
      });

      page.on("response", (res) => {
        const url = res.url();
        if (THIRD_PARTY.test(url)) return;
        if (baseURL && !url.startsWith(baseURL)) return;
        // 4xx/5xx from RAE's own origin is a broken call regardless of whether
        // the UI swallowed it. 401/403 on an auth-gated route is expected.
        if (res.status() >= 400 && ![401, 403].includes(res.status())) {
          failedRequests.push(`HTTP ${res.status()} ${url}`);
        }
      });

      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {
        // networkidle can never settle if something polls; the assertions below
        // still hold on whatever was observed.
      });

      expect(consoleErrors, `${route} logged console errors`).toEqual([]);
      expect(failedRequests, `${route} had broken same-origin requests`).toEqual([]);
    });
  }
});
