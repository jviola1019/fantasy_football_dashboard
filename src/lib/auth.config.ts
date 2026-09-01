import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config shared by the app handlers (src/lib/auth.ts) and the
 * proxy (src/proxy.ts — Next 16's rename of middleware). It deliberately contains NO database adapter
 * and NO Credentials provider — both pull in `better-sqlite3`/`postgres` and the
 * `authenticateUser` DB read, which cannot run in the Edge middleware runtime.
 * Middleware only needs to VERIFY the JWT and gate routes; sign-in (which hits
 * the DB) happens in the Node route handler that imports the full config.
 */
export const authConfig = {
  // Auth.js v5 refuses to issue cookies in production unless it can verify the
  // request host. On self-hosted Next.js (Vercel auto-detects) we opt in.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // real providers are added in src/lib/auth.ts (Node runtime)
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        // Session generation, stamped at sign-in (audit F-004). The server
        // compares it against the DB on every protected read, so bumping the
        // stored value revokes this token everywhere. Edge-safe: this is a
        // pure copy, no database access.
        token.sv = (user as { sessionVersion?: number }).sessionVersion;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user && token.id) session.user.id = token.id as string;
      if (session.user) {
        (session.user as { sessionVersion?: number }).sessionVersion = token.sv as number | undefined;
      }
      return session;
    },
    /**
     * Deliberately NOT a gate. It reports whether a session exists; the redirect
     * is `src/proxy.ts`'s job.
     *
     * Audit 2026-08-23. When this returned `Boolean(auth?.user)`, the Auth.js
     * middleware wrapper performed the redirect itself, resolving `/login`
     * against ITS OWN base URL — and `AUTH_URL` overrides `trustHost`. On a
     * Vercel preview with `AUTH_URL` pinned to the production host, an
     * unauthenticated visit to `/settings/leagues` sent the user to
     * PRODUCTION's login page. They would sign in there, come back, and still
     * be anonymous, because the session cookie belongs to a different host.
     * Sign-in was unreachable on every preview deployment, silently.
     *
     * This is half the fix and not sufficient alone — measured, after changing
     * only this, the redirect was STILL cross-origin, because `request.nextUrl`
     * is itself rewritten from AUTH_URL before the proxy handler runs. The other
     * half is in `src/proxy.ts`, which now emits a RELATIVE Location.
     *
     * The proxy already gated `/settings` explicitly with the identical
     * condition, because this callback's scope is the whole matcher and would
     * have redirected anonymous visitors away from the onboarding page. So the
     * gating is unchanged; only the origin the redirect lands on is.
     * `requireUser()` remains the authoritative check.
     */
    authorized: ({ auth }) => {
      void auth;
      return true;
    }
  }
} satisfies NextAuthConfig;
