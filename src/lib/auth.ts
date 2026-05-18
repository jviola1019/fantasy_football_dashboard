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
    adapter: DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens
    }),
    session: { strategy: "database" },
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
      session: ({ session, user }) => {
        if (session.user) session.user.id = user.id;
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
