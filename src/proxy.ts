import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { buildCsp, CSP_HEADER_NAME, CSP_REPORT_ONLY } from "@/lib/security/csp";

// Next 16 "proxy" (formerly "middleware"), built from the adapter-free config so
// the native DB driver is never imported at the edge.
//
// It now does two jobs, and they have deliberately different scopes:
//
//   1. CSP (audit F-007) — applies to EVERY document request. A per-request
//      nonce has to be minted here because it is the only place that runs
//      before the HTML is generated.
//   2. Route gating — applies ONLY to the protected prefixes below.
//
// Keeping those scopes separate is the whole reason this file is a composed
// handler rather than a bare `export default auth`. Broadening the matcher so
// CSP covers the app, while leaving the `authorized` callback in charge, would
// have made `Boolean(auth?.user)` the answer for `/` too — redirecting every
// anonymous visitor away from the onboarding page. So the gate checks the path
// explicitly instead.
//
// This remains DEFENCE IN DEPTH only. It cannot reach the database, so it
// cannot see a revoked session; `requireUser()` is the authoritative check at
// each Node-runtime call site (audit F-004). Relying on a proxy as the sole
// gate is precisely the mistake GHSA-6gpp-xcg3-4w24 punishes.
const { auth } = NextAuth(authConfig);

/** Prefixes that require a session. Page-level `requireUser()` still applies. */
const PROTECTED_PREFIXES = ["/settings"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((request) => {
  const nonce = crypto.randomUUID();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== "production",
    reportOnly: CSP_REPORT_ONLY
  });

  if (isProtected(request.nextUrl.pathname) && !request.auth?.user) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  // Next reads the CSP from the REQUEST headers to decide where to stamp the
  // nonce into its own bootstrap scripts. That header is always the enforcing
  // name even while we ship report-only on the response — otherwise Next would
  // not nonce anything, and flipping enforcement on later would break the app
  // instantly instead of being a no-op.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER_NAME, csp);
  return response;
});

export const config = {
  // Every document route, so the CSP is actually present where HTML is served.
  // Excludes API routes (JSON, no script context), Next's immutable static
  // assets, the image optimizer, and prefetches — matching Next's own strict-CSP
  // example. Prefetch responses are skipped because they would otherwise burn a
  // nonce that never reaches a rendered document.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
