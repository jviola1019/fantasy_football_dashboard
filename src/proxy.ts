import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next 16 "proxy" (formerly "middleware"), built from the adapter-free config so
// the native DB driver is never imported at the edge. Defense-in-depth: the `authorized` callback
// (auth.config.ts) redirects unauthenticated requests for matched routes to
// /login, alongside the existing page-level `auth()` guards.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Only run on auth-gated routes. Keep page-level checks too.
  matcher: ["/settings/:path*"]
};
