/**
 * Static security headers — the SINGLE source of truth.
 *
 * This file is plain ESM JavaScript on purpose, and that is a correctness
 * requirement rather than a style choice.
 *
 * `next.config.mjs` is loaded by **Node itself**, before and outside Next's
 * TypeScript pipeline. It previously imported these headers from `csp.ts`,
 * which appeared to work locally only because Node >= 22.18 strips TypeScript
 * types natively. CI runs Node 20.20.2, where the identical import dies with:
 *
 *     ERR_UNKNOWN_FILE_EXTENSION ".ts" ... src/lib/security/csp.ts
 *
 * That took down `next build`, and with it every downstream gate — Playwright,
 * axe and Lighthouse were all skipped, so the security headers defined here
 * were not merely unverified, they were unreachable. A config boundary must
 * therefore stay loadable by a bare Node ESM loader with no transpilation.
 *
 * Deliberately NOT done: installing a TypeScript loader for the config. That
 * adds a build dependency purely to sustain an import that has no reason to
 * cross the transpilation boundary in the first place.
 *
 * The runtime CSP — which needs a per-request nonce and therefore cannot be a
 * static value — stays in `csp.ts`, which re-exports this array so TypeScript
 * callers see one identical object and the two can never drift.
 *
 * Guarded by `src/lib/security/securityHeaders.node20.test.ts`, which loads
 * `next.config.mjs` in a child Node process with type-stripping switched OFF,
 * so this regression cannot recur on a machine whose Node happens to tolerate
 * the import.
 *
 * @type {ReadonlyArray<{ key: string, value: string }>}
 */
export const STATIC_SECURITY_HEADERS = Object.freeze([
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS was absent entirely. Two years, subdomains included. No `preload`:
  // that is a one-way submission to a browser-baked list and is the owner's
  // call, not a side effect of a security patch.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Isolate the browsing context so cross-origin windows cannot reach ours.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
]);
