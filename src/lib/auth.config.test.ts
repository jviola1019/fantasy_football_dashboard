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

  it("authorized() requires an authenticated user", () => {
    const authorized = authConfig.callbacks!.authorized! as unknown as (p: {
      auth: { user?: unknown } | null;
    }) => boolean;
    expect(authorized({ auth: null })).toBe(false);
    expect(authorized({ auth: {} })).toBe(false);
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
