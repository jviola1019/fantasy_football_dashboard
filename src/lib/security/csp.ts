/**
 * Content Security Policy (audit 2026-08-06 F-007).
 *
 * Before this the entire CSP was one directive — `frame-ancestors 'none'` — and
 * it lived only in `vercel.ts`. That location matters: `next start`, Playwright
 * and Lighthouse never see Vercel's header rules, so **no gate could observe the
 * policy at all**. A CSP nobody can test is a CSP that silently rots. The policy
 * is now emitted by the app itself (proxy + next.config) and asserted in e2e.
 *
 * Scoping this app is unusually favourable, and each allowance below is earned
 * rather than copied from a template:
 *   - `connect-src 'self'` — there are ZERO client-side external fetches. Every
 *     Sleeper/ESPN/FantasyPros/nflverse/KTC call runs server-side or in a cron.
 *   - `font-src 'self'` — fonts are self-hosted by `next/font/google` at build
 *     time; no fonts.googleapis.com, no fonts.gstatic.com.
 *   - `img-src 'self' data: blob:` — remote headshots are proxied through
 *     `/_next/image`, so the CDN hosts never appear as browser origins.
 *   - `object-src 'none'`, `frame-src 'none'` — no plugins, no iframes.
 *
 * The one genuine compromise is `style-src-attr 'unsafe-inline'`: the app has 77
 * `style={{…}}` attributes across ~12 files, and a nonce cannot cover
 * attribute-level styles. Refactoring all of them is a broad aesthetic rewrite,
 * so it is retained as a DOCUMENTED residual. Note it is scoped to `-attr`, so
 * inline `<style>` blocks still require the nonce — the weakening is as narrow
 * as the spec allows.
 */

export interface CspOptions {
  nonce: string;
  /** Dev needs 'unsafe-eval' for React Refresh; production must never have it. */
  isDev?: boolean;
  /**
   * Whether the policy will be delivered as report-only. Browsers IGNORE
   * `upgrade-insecure-requests` in a report-only policy and log a console
   * notice saying so, which is pure noise in the violation report we use as
   * rollout evidence — so the directive is omitted until enforcement.
   */
  reportOnly?: boolean;
}

/**
 * Build the policy. `strict-dynamic` lets Next's nonced bootstrap script load
 * the chunks it needs without us enumerating hashes, and it makes host-based
 * allowlists in `script-src` inert — which is the point: an injected
 * `<script src>` cannot execute even if an attacker controls a permitted host.
 */
export function buildCsp({ nonce, isDev = false, reportOnly = false }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React Refresh evaluates transformed modules in development only.
    isDev ? "'unsafe-eval'" : null
  ].filter(Boolean);

  const directives: Array<[string, string]> = [
    ["default-src", "'self'"],
    ["script-src", scriptSrc.join(" ")],
    // next/font injects a <style> element; the nonce covers it.
    ["style-src", `'self' 'nonce-${nonce}'`],
    // The documented residual — see the module comment.
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["object-src", "'none'"],
    ["frame-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"]
  ];

  // Never upgrade in dev (it would rewrite http://localhost to https and break
  // the local server), and never in report-only (browsers ignore it there and
  // emit a console notice that pollutes the violation evidence).
  const tail = isDev || reportOnly ? [] : ["upgrade-insecure-requests"];

  return [...directives.map(([k, v]) => `${k} ${v}`), ...tail].join("; ");
}

/**
 * Security headers that do NOT vary per request.
 *
 * Re-exported, not defined here. The values live in `securityHeaders.mjs`
 * because `next.config.mjs` — which applies them — is loaded by a bare Node
 * ESM loader that cannot read TypeScript. Importing them from this file built
 * fine on Node >= 22.18 (native type stripping) and failed CI's Node 20 with
 * `ERR_UNKNOWN_FILE_EXTENSION`, taking down `next build` and every gate behind
 * it. Re-exporting keeps exactly one definition while letting each consumer
 * load it through a loader that can actually parse it.
 */
export { STATIC_SECURITY_HEADERS } from "./securityHeaders.mjs";

/**
 * Report-only during rollout.
 *
 * The audit is explicit: start in report-only, prove the app renders, and only
 * then enforce. Flipping this to `false` is the single switch that turns the
 * policy on. It is a constant rather than an env var deliberately — enforcement
 * should be a reviewed code change with a test run behind it, not a
 * configuration value someone can toggle blind in a dashboard.
 */
export const CSP_REPORT_ONLY = true;

export const CSP_HEADER_NAME = CSP_REPORT_ONLY
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";
