import { describe, expect, it } from "vitest";
import { errorTag, mapAuthError } from "./errors";

describe("mapAuthError", () => {
  it("returns the documented copy for CredentialsSignin", () => {
    expect(mapAuthError({ type: "CredentialsSignin", message: "denied" })).toBe(
      "Email or password is incorrect."
    );
  });

  it("treats the Drizzle UNIQUE-constraint surface as DuplicateEmail", () => {
    expect(mapAuthError(new Error("UNIQUE constraint failed: users.email"))).toBe(
      "Could not create that account. If you already have one, sign in instead."
    );
    expect(mapAuthError(new Error("user already exists"))).toBe(
      "Could not create that account. If you already have one, sign in instead."
    );
  });

  it("maps the application-layer password-length error", () => {
    expect(mapAuthError(new Error("password must be a string of at least 8 characters"))).toBe(
      "Password must be at least 8 characters."
    );
  });

  it("maps Verification / EmailSignin into one expired-link message", () => {
    expect(mapAuthError({ type: "Verification" })).toBe(
      "That sign-in link expired. Request a new one."
    );
    expect(mapAuthError({ type: "EmailSignin" })).toBe(
      "That sign-in link expired. Request a new one."
    );
  });

  it("maps CallbackRouteError to the retry-soon message", () => {
    expect(mapAuthError({ type: "CallbackRouteError" })).toBe(
      "Sign-in failed. Try again in a moment."
    );
  });

  it("maps fetch / network failures into the connection error", () => {
    expect(mapAuthError(new Error("fetch failed"))).toBe("Connection error. Check your internet.");
    expect(mapAuthError(new Error("ECONNREFUSED 127.0.0.1:5432"))).toBe(
      "Connection error. Check your internet."
    );
  });

  it("maps server-configuration failures cleanly", () => {
    expect(mapAuthError(new Error("There was a problem with the server configuration"))).toBe(
      "We're having trouble signing you in. Try again."
    );
  });

  it("maps a missing database table (Postgres) to the operator init message", () => {
    expect(
      mapAuthError(new Error('relation "users" does not exist'))
    ).toBe(
      "The service is temporarily unavailable. Please try again shortly."
    );
  });

  it("maps a missing database table (SQLite) to the operator init message", () => {
    expect(mapAuthError(new Error("no such table: users"))).toBe(
      "The service is temporarily unavailable. Please try again shortly."
    );
  });

  it("maps the generic SQLite no-such-table variant to the operator init message", () => {
    expect(mapAuthError(new Error("no such table"))).toBe(
      "The service is temporarily unavailable. Please try again shortly."
    );
  });

  it("falls back to a generic message rather than leaking the original error text", () => {
    const leaky = new Error("Drizzle: SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed");
    const out = mapAuthError(leaky);
    expect(out).toBe("Something went wrong. Try again.");
    expect(out).not.toContain("Drizzle");
    expect(out).not.toContain("SQLITE");
  });

  it("never echoes raw error.message in any returned string", () => {
    const cases: unknown[] = [
      null,
      undefined,
      "",
      new Error("internal: redacted-but-leaky"),
      { foo: "bar" },
      42
    ];
    for (const c of cases) {
      const out = mapAuthError(c);
      expect(out).toMatch(/\.$/);
      if (c instanceof Error && c.message) {
        expect(out).not.toContain(c.message);
      }
    }
  });
});

describe("does not disclose account existence or operational detail (F-005/F-009)", () => {
  it("the duplicate-email response never confirms that the account exists", () => {
    const msg = mapAuthError(new Error("user already exists"));
    expect(msg).not.toMatch(/already exists/i);
    expect(msg).not.toMatch(/registered|taken|in use/i);
  });

  it("the database-not-initialised response never names the admin endpoint", () => {
    const msg = mapAuthError(new Error('relation "users" does not exist'));
    expect(msg).not.toMatch(/init-db|operator|admin/i);
  });
});

describe("errorTag", () => {
  it("returns the same tag for both `type` and `message` shapes", () => {
    expect(errorTag({ type: "CredentialsSignin" })).toBe("CredentialsSignin");
    expect(errorTag(new Error("CredentialsSignin error in authorize()"))).toBe("CredentialsSignin");
  });

  it("returns Unknown when nothing matches", () => {
    expect(errorTag({})).toBe("Unknown");
    expect(errorTag(null)).toBe("Unknown");
    expect(errorTag(new Error("totally unrelated"))).toBe("Unknown");
  });

  it("returns DatabaseNotInitialized for Postgres missing-relation error", () => {
    expect(errorTag(new Error('relation "users" does not exist'))).toBe("DatabaseNotInitialized");
  });

  it("returns DatabaseNotInitialized for SQLite no-such-table error", () => {
    expect(errorTag(new Error("no such table: users"))).toBe("DatabaseNotInitialized");
    expect(errorTag(new Error("no such table"))).toBe("DatabaseNotInitialized");
  });
});
