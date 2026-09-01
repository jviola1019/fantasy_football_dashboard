import { beforeAll, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../db";
import { authorizeCredentials, credentialsSchema } from "./credentials";
import { createUserWithPassword } from "../users";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../passwords";

/**
 * The credentials login path had NO coverage (audit 2026-08-22, P3).
 *
 * `auth.config.test.ts` looks like it covers this and does not: it tests
 * `auth.config.ts`, the edge-safe base config, which carries no providers at
 * all. The function that actually exchanges a password for a session was
 * untested — and it is reachable directly over HTTP through the Auth.js route,
 * so it cannot rely on the server action having validated anything first.
 *
 * The invariant under test is uniform rejection: every failure returns null and
 * looks identical from outside. A caller must not be able to distinguish a
 * malformed email from an unknown account from a wrong password, because that
 * distinction is an account-enumeration oracle (F-005 / F-009).
 */
const EMAIL = "player@example.com";
const PASSWORD = "correct-horse-battery";

describe("authorizeCredentials", () => {
  let db: ReturnType<typeof resetDbForTests>;

  /**
   * ONE fixture user for the whole file, not one per test.
   *
   * `beforeEach` created a user before each of the eight tests, and the hash is
   * scrypt at N=65536, r=8, p=2 — the OWASP-listed profile chosen in
   * `passwords.ts`, deliberately ~574ms and 64 MiB. Eight setups plus the
   * verification each test performs (plus the timing-equalizer hash `users.ts`
   * burns on every miss) put the hook at ~6.7s of its 10s budget on an idle
   * machine, and it TIMED OUT on 2026-09-01 when the suite ran alongside a
   * Playwright run. A hook spending two thirds of its budget when nothing else
   * is happening is not a flake waiting to happen, it is one that already has.
   *
   * The cost factor is a security parameter and is NOT lowered for tests: that
   * would test a hash the product does not use. What changes is how many times
   * it is paid. Every test here is read-only — they authenticate and assert on
   * the result; none writes — so a single shared account exercises exactly the
   * same code path eight times fewer.
   *
   * If a test that MUTATES the user is ever added, it needs its own `describe`
   * with its own reset; sharing this one would let it leak into the others.
   */
  beforeAll(async () => {
    db = resetDbForTests();
    await createUserWithPassword(db, { email: EMAIL, password: PASSWORD });
  });

  it("returns the user for correct credentials", async () => {
    const user = await authorizeCredentials({ email: EMAIL, password: PASSWORD }, db);
    expect(user?.email).toBe(EMAIL);
    expect(typeof user?.id).toBe("string");
  });

  it("carries sessionVersion so the jwt callback needs no second query", async () => {
    // F-004: the token stamps the generation it was minted under. If this stops
    // riding along, revocation silently stops working — the token would carry
    // no version to compare against.
    const user = await authorizeCredentials({ email: EMAIL, password: PASSWORD }, db);
    expect(typeof user?.sessionVersion).toBe("number");
  });

  it("rejects a wrong password", async () => {
    expect(await authorizeCredentials({ email: EMAIL, password: "wrong-password-here" }, db)).toBeNull();
  });

  it("rejects an unknown account the SAME way as a wrong password", async () => {
    // Both null. Any asymmetry here — a different return, a thrown error, even
    // a different shape — is an account-enumeration oracle.
    const unknown = await authorizeCredentials({ email: "nobody@example.com", password: PASSWORD }, db);
    const wrongPass = await authorizeCredentials({ email: EMAIL, password: "wrong-password-here" }, db);
    expect(unknown).toBeNull();
    expect(wrongPass).toBeNull();
    expect(unknown).toEqual(wrongPass);
  });

  it("enforces the password bounds itself, without trusting the caller", async () => {
    // The provider is reachable directly via the Auth.js route, so the server
    // action's validation is not in the path.
    const tooShort = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    const tooLong = "x".repeat(MAX_PASSWORD_LENGTH + 1);
    expect(await authorizeCredentials({ email: EMAIL, password: tooShort }, db)).toBeNull();
    expect(await authorizeCredentials({ email: EMAIL, password: tooLong }, db)).toBeNull();
  });

  it("rejects a malformed email before touching the database", async () => {
    expect(await authorizeCredentials({ email: "not-an-email", password: PASSWORD }, db)).toBeNull();
    expect(await authorizeCredentials({ email: "", password: PASSWORD }, db)).toBeNull();
  });

  it("rejects non-string and missing fields rather than throwing", async () => {
    // `raw` is whatever arrived on the wire. A throw here is a 500 on an
    // unauthenticated endpoint.
    const hostile: unknown[] = [
      undefined,
      null,
      {},
      { email: EMAIL },
      { password: PASSWORD },
      { email: 123, password: PASSWORD },
      { email: EMAIL, password: { toString: () => PASSWORD } },
      { email: [EMAIL], password: [PASSWORD] },
      "a string",
      42
    ];
    for (const raw of hostile) {
      await expect(authorizeCredentials(raw, db)).resolves.toBeNull();
    }
  });

  it("caps the email length so an oversized field cannot reach the query", async () => {
    const huge = `${"a".repeat(400)}@example.com`;
    expect(credentialsSchema.safeParse({ email: huge, password: PASSWORD }).success).toBe(false);
    expect(await authorizeCredentials({ email: huge, password: PASSWORD }, db)).toBeNull();
  });
});
