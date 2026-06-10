import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config shared by the app handlers (src/lib/auth.ts) and the
 * middleware (src/middleware.ts). It deliberately contains NO database adapter
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
      if (user) token.id = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (session.user && token.id) session.user.id = token.id as string;
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
