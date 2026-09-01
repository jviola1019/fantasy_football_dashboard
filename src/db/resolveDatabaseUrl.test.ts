import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./index";

/**
 * The database the app opens, and the one case where it must refuse to open
 * anything at all.
 *
 * Audit 2026-08-23. The fallback to a local SQLite file used to be
 * unconditional. On Vercel that is a silent downgrade with a user-visible cost:
 * the filesystem is ephemeral and per-invocation, so a sign-up is accepted,
 * written, and gone by the next request. The person is then told their password
 * is wrong for an account they just created.
 *
 * These pin BOTH directions, because a guard that also fires locally would be
 * its own outage — every developer and every Playwright run depends on the
 * fallback working when there is no DATABASE_URL.
 */
const base = {} as NodeJS.ProcessEnv;

describe("an explicit DATABASE_URL always wins", () => {
  it("returns it unchanged, on Vercel or not", () => {
    const url = "postgres://user:pw@host/db";
    expect(resolveDatabaseUrl({ ...base, DATABASE_URL: url })).toBe(url);
    expect(resolveDatabaseUrl({ ...base, DATABASE_URL: url, VERCEL: "1" })).toBe(url);
  });

  it("treats a whitespace-only value as absent", () => {
    // A variable set to "" or " " in a dashboard is the same mistake as not
    // setting it, and it must not read as "configured".
    expect(resolveDatabaseUrl({ ...base, DATABASE_URL: "   " })).toBe("file:.data/rae.sqlite");
    expect(() => resolveDatabaseUrl({ ...base, DATABASE_URL: " ", VERCEL: "1" })).toThrow(/DATABASE_URL/);
  });

  it("trims, so a copy-pasted trailing newline still connects", () => {
    expect(resolveDatabaseUrl({ ...base, DATABASE_URL: " postgres://h/db\n" })).toBe("postgres://h/db");
  });
});

describe("off Vercel, the SQLite fallback is intact", () => {
  it("falls back with no DATABASE_URL", () => {
    // Local dev, CI and Playwright all rely on this. A guard that fired here
    // would be a bigger outage than the one it prevents.
    expect(resolveDatabaseUrl(base)).toBe("file:.data/rae.sqlite");
  });

  it("falls back even in production mode, because self-hosting has a real disk", () => {
    expect(resolveDatabaseUrl({ ...base, NODE_ENV: "production" })).toBe("file:.data/rae.sqlite");
  });
});

describe("on Vercel, an absent DATABASE_URL is an error, not a default", () => {
  it("throws rather than returning an ephemeral file", () => {
    expect(() => resolveDatabaseUrl({ ...base, VERCEL: "1" })).toThrow();
  });

  it("says what would be lost and how to fix it, not just that something is unset", () => {
    // An operator reading only "DATABASE_URL is not set" would reasonably
    // assume the fallback covers them. It is the CONSEQUENCE that has to be in
    // the message.
    let message = "";
    try {
      resolveDatabaseUrl({ ...base, VERCEL: "1" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/ephemeral/i);
    expect(message).toMatch(/sign-in would fail/i);
    expect(message).toMatch(/DEPLOY_TO_VERCEL\.md/);
    expect(message).toMatch(/RAE_ALLOW_EPHEMERAL_DB/);
  });

  it("allows a deliberately database-less deployment when that is stated", () => {
    expect(resolveDatabaseUrl({ ...base, VERCEL: "1", RAE_ALLOW_EPHEMERAL_DB: "1" })).toBe(
      "file:.data/rae.sqlite"
    );
  });

  it("does not accept a vague truthy value as consent", () => {
    // "true", "yes" and "0" are all things people type. Only the documented
    // value opts in, so nobody disables the guard by accident.
    for (const value of ["true", "yes", "0", "", "on"]) {
      expect(() => resolveDatabaseUrl({ ...base, VERCEL: "1", RAE_ALLOW_EPHEMERAL_DB: value })).toThrow();
    }
  });
});
