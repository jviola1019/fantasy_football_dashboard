import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getDb, schema } from "../db";
import { authenticateUser } from "./users";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function buildConfig(): NextAuthConfig {
  return {
    // Shared edge-safe base (trustHost, jwt session, pages, callbacks) — see
    // auth.config.ts. Here in the Node runtime we add the DB adapter and the
    // Credentials provider (both of which touch the database).
    ...authConfig,
    // Adapter still needed so OAuth providers and verificationTokens have a
    // place to live; Credentials provider itself just uses JWT sessions.
    adapter: DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens
    }),
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
    ]
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
