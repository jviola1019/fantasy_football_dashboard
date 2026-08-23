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
     * Middleware gate (defense-in-depth alongside the page-level `auth()`
     * checks). The matcher in middleware.ts only routes protected paths here, so
     * a missing session ⇒ Auth.js redirects to `pages.signIn` (/login).
     */
    authorized: ({ auth }) => Boolean(auth?.user)
  }
} satisfies NextAuthConfig;
