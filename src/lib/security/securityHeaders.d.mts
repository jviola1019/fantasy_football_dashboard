/**
 * Types for `securityHeaders.mjs`.
 *
 * The implementation is plain JS so `next.config.mjs` can import it under a
 * bare Node ESM loader (see the module comment there for why). `allowJs` is
 * false in tsconfig, so this declaration is what gives TypeScript callers —
 * `csp.ts` and its dependents — full type safety over that JS module.
 */
export declare const STATIC_SECURITY_HEADERS: ReadonlyArray<{
  key: string;
  value: string;
}>;
