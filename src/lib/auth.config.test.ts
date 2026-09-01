import { describe, it, expect } from "vitest";
import { authConfig } from "./auth.config";

describe("authConfig (edge-safe shared config)", () => {
  it("carries no DB adapter and no providers (so the edge proxy stays native-free)", () => {
    expect("adapter" in authConfig).toBe(false);
    expect(authConfig.providers).toEqual([]);
  });

  it("uses JWT sessions and routes sign-in to /login", () => {
    expect(authConfig.session?.strategy).toBe("jwt");
    expect(authConfig.pages?.signIn).toBe("/login");
  });

  it("authorized() never gates, because the redirect must be same-origin", () => {
    // This used to return Boolean(auth?.user), which made the AUTH.JS wrapper
    // perform the redirect and resolve /login against ITS OWN base URL. AUTH_URL
    // overrides trustHost, so on a Vercel preview with AUTH_URL pinned to the
    // production host, an anonymous visit to /settings/leagues landed on
    // PRODUCTION's login page — sign in there, come back, still anonymous,
    // because the cookie belongs to a different host. Sign-in was unreachable on
    // every preview, silently.
    //
    // This is NOT a loosened gate. src/proxy.ts applies the identical condition
    // to the identical prefixes, against request.nextUrl.origin, and
    // requireUser() is still authoritative at every Node-runtime call site.
    // If this ever returns false again, that bug returns with it.
    const authorized = authConfig.callbacks!.authorized! as unknown as (p: {
      auth: { user?: unknown } | null;
    }) => boolean;
    expect(authorized({ auth: null })).toBe(true);
    expect(authorized({ auth: {} })).toBe(true);
    expect(authorized({ auth: { user: { id: "u1" } } })).toBe(true);
  });

  it("jwt() copies the user id onto the token; session() re-exposes it", () => {
    const jwt = authConfig.callbacks!.jwt! as unknown as (p: {
      token: Record<string, unknown>;
      user?: { id: string };
    }) => Record<string, unknown>;
    expect(jwt({ token: {}, user: { id: "u1" } }).id).toBe("u1");
    expect(jwt({ token: { id: "keep" } }).id).toBe("keep"); // no user ⇒ unchanged

    const session = authConfig.callbacks!.session! as unknown as (p: {
      session: { user?: Record<string, unknown> };
      token: Record<string, unknown>;
    }) => { user?: { id?: string } };
    const s = session({ session: { user: {} }, token: { id: "u1" } });
    expect(s.user?.id).toBe("u1");
  });
});
