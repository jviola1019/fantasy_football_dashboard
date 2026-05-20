import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { z } from "zod";
import { getDb, schema } from "../db";
import { authenticateUser } from "./users";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function buildConfig(): NextAuthConfig {
  return {
    // Auth.js v5 refuses to issue cookies in production unless it can verify
    // the request host. On self-hosted Next.js (Vercel auto-detects), we need
    // to opt-in explicitly. Local dev + Playwright both run against localhost,
    // which is not on Auth.js's default trust list.
    trustHost: true,
    // Adapter still needed so OAuth providers and verificationTokens have a
    // place to live; Credentials provider itself just uses JWT sessions.
    adapter: DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens
    }),
    // Auth.js v5 explicitly requires JWT sessions for the Credentials provider.
    // The user id is carried in the token via the `jwt` callback and re-exposed
    // on `session.user.id` via the `session` callback.
    session: { strategy: "jwt" },
    providers: [
      Credentials({
        name: "Email",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" }
        },
        authorize: async (raw) => {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const user = await authenticateUser(getDb(), parsed.data.email, parsed.data.password);
          if (!user) return null;
          return { id: user.id, email: user.email, name: user.name ?? undefined };
        }
      })
    ],
    pages: {
      signIn: "/login"
    },
    callbacks: {
      jwt: ({ token, user }) => {
        if (user) token.id = user.id;
        return token;
      },
      session: ({ session, token }) => {
        if (session.user && token.id) session.user.id = token.id as string;
        return session;
      }
    }
  };
}

// Auth.js v5 requires module-level handlers, but DrizzleAdapter eagerly opens
// the SQLite file. During `next build`'s page-data collection there is no DB
// directory yet on a fresh checkout, so we lazily build the config the first
// time any handler runs and let getDb() create the directory.
const lazy = NextAuth(buildConfig);

export const handlers = lazy.handlers;
export const auth = lazy.auth;
export const signIn = lazy.signIn;
export const signOut = lazy.signOut;
