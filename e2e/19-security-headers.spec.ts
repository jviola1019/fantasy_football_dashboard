import { test, expect } from "@playwright/test";

/**
 * Security headers + CSP (audit 2026-08-06 F-007).
 *
 * These assertions exist because the previous policy was unobservable: headers
 * lived only in `vercel.ts`, so `next start`, Playwright and Lighthouse never
 * saw them and nothing could catch a regression. They are now emitted by the
 * app, which means this spec is the gate that keeps them honest.
 *
 * The CSP ships REPORT-ONLY. The violation test below is the evidence that must
 * be clean before `CSP_REPORT_ONLY` is flipped in src/lib/security/csp.ts.
 */

const DOC_ROUTES = ["/", "/login", "/dashboard", "/players", "/analytics", "/draft", "/waivers", "/trades", "/reports", "/mock-draft"];

test.describe("static security headers", () => {
  test("every document route carries the full header set", async ({ request }) => {
    for (const route of DOC_ROUTES) {
      const res = await request.get(route);
      const h = res.headers();
      expect(h["x-frame-options"], route).toBe("DENY");
      expect(h["x-content-type-options"], route).toBe("nosniff");
      expect(h["referrer-policy"], route).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], route).toContain("camera=()");
      expect(h["strict-transport-security"], route).toContain("max-age=");
      expect(h["cross-origin-opener-policy"], route).toBe("same-origin");
    }
  });

  test("does not advertise the framework", async ({ request }) => {
    const h = (await request.get("/")).headers();
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("API responses are never cached", async ({ request }) => {
    const h = (await request.get("/api/health")).headers();
    expect(h["cache-control"]).toContain("no-store");
  });
});

test.describe("content security policy", () => {
  const cspOf = (headers: Record<string, string>) =>
    headers["content-security-policy"] ?? headers["content-security-policy-report-only"] ?? "";

  test("declares every directive the audit requires", async ({ request }) => {
    const csp = cspOf((await request.get("/")).headers());
    for (const directive of [
      "default-src",
      "script-src",
      "style-src",
      "connect-src",
      "img-src",
      "font-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors"
    ]) {
      expect(csp, `missing ${directive}`).toContain(`${directive} `);
    }
  });

  test("contains no wildcard or unsafe-eval, and locks down the dangerous sinks", async ({ request }) => {
    const csp = cspOf((await request.get("/")).headers());
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    // The one documented residual is scoped to ATTRIBUTES only; inline <style>
    // blocks must still require the nonce.
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toMatch(/style-src [^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  test("issues a FRESH nonce per request", async ({ request }) => {
    const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];
    const a = nonceOf(cspOf((await request.get("/")).headers()));
    const b = nonceOf(cspOf((await request.get("/")).headers()));
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // A reused nonce is worth no more than 'unsafe-inline'.
    expect(a).not.toBe(b);
  });

  test("connect-src stays 'self' — the app makes no client-side external calls", async ({ request }) => {
    const csp = cspOf((await request.get("/")).headers());
    expect(csp).toMatch(/connect-src 'self'\s*(;|$)/);
  });
});

test.describe("CSP violations in a real browser (rollout evidence)", () => {
  for (const route of DOC_ROUTES) {
    test(`route ${route} reports no CSP violations`, async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (/Content Security Policy|Refused to (load|execute|apply)/i.test(text)) {
          violations.push(text);
        }
      });
      // securitypolicyviolation fires for report-only too, and is the
      // authoritative signal rather than console-text matching.
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          (window as unknown as { __csp: string[] }).__csp ??= [];
          (window as unknown as { __csp: string[] }).__csp.push(
            `${e.effectiveDirective} blocked ${e.blockedURI}` +
              (e.sourceFile ? ` @ ${e.sourceFile}:${e.lineNumber}` : "")
          );
        });
      });

      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const reported = await page.evaluate(
        () => (window as unknown as { __csp?: string[] }).__csp ?? []
      );

      const all = [...new Set([...violations, ...reported])];
      expect(all, `CSP violations on ${route}:\n${all.join("\n")}`).toEqual([]);
    });
  }
});
