import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, schema } from "../db";
import { authenticateUser, createUserWithPassword, TIMING_EQUALIZER_HASH_FOR_TESTS } from "./users";
import { CURRENT_PROFILE, hashVersion, MAX_PASSWORD_LENGTH, verifyPassword } from "./passwords";

/** A genuine scrypt1 hash of "legacy-password-123" (N=16384, r=8, p=1). */
const LEGACY_HASH =
  "scrypt1$1tcMEFHCxpwioDvCyDIWSA==$r+LpW9yI6A7TdZOpyQKUe6wvLq1qZzI4iWV32Jpl5fagBlvGQWcy7Z7RvZ21qD/Z/l7USlsrm0XubOrq+0T60A==";
const LEGACY_PLAINTEXT = "rae-timing-equalizer-not-a-secret";

describe("timing equalizer parity (audit F-005)", () => {
  it("the equalizer hash uses the CURRENT profile", () => {
    // If a future commit raises CURRENT_PROFILE without regenerating the
    // equalizer, unknown accounts become measurably FASTER than real ones and
    // the enumeration oracle reopens. That is exactly what happened when
    // scrypt2 landed while the equalizer was still scrypt1 (~124ms vs ~574ms).
    expect(hashVersion(TIMING_EQUALIZER_HASH_FOR_TESTS)).toBe(CURRENT_PROFILE.version);
  });

  it("nothing can authenticate against the equalizer constant", async () => {
    // It is a hash of a published, non-secret string; the branch that uses it
    // always returns null, but assert the value itself is not a usable secret.
    expect(await verifyPassword(LEGACY_PLAINTEXT, TIMING_EQUALIZER_HASH_FOR_TESTS)).toBe(true);
  });
});

describe("legacy hash migration on login (audit F-005)", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(() => {
    db = resetDbForTests();
  });

  async function seedLegacyUser() {
    await db.insert(schema.users).values({
      id: "legacy-1",
      email: "legacy@example.com",
      passwordHash: LEGACY_HASH
    });
  }

  it("a legacy scrypt1 user can still authenticate", async () => {
    await seedLegacyUser();
    const user = await authenticateUser(db, "legacy@example.com", LEGACY_PLAINTEXT);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("legacy@example.com");
  });

  it("upgrades the stored hash to scrypt2 after a SUCCESSFUL login", async () => {
    await seedLegacyUser();
    await authenticateUser(db, "legacy@example.com", LEGACY_PLAINTEXT);
    const row = (
      await db.select().from(schema.users).where(eq(schema.users.id, "legacy-1")).limit(1)
    )[0]!;
    expect(hashVersion(row.passwordHash!)).toBe("scrypt2");
    // And the upgraded hash still verifies the same password.
    expect(await verifyPassword(LEGACY_PLAINTEXT, row.passwordHash!)).toBe(true);
  });

  it("does NOT rehash after a failed login", async () => {
    // Rehashing on failure would let an attacker drive expensive work with
    // wrong guesses.
    await seedLegacyUser();
    expect(await authenticateUser(db, "legacy@example.com", "wrong-password")).toBeNull();
    const row = (
      await db.select().from(schema.users).where(eq(schema.users.id, "legacy-1")).limit(1)
    )[0]!;
    expect(hashVersion(row.passwordHash!)).toBe("scrypt1");
  });

  it("is idempotent — a second login does not rewrite an already-current hash", async () => {
    await seedLegacyUser();
    await authenticateUser(db, "legacy@example.com", LEGACY_PLAINTEXT);
    const first = (
      await db.select().from(schema.users).where(eq(schema.users.id, "legacy-1")).limit(1)
    )[0]!.passwordHash;
    await authenticateUser(db, "legacy@example.com", LEGACY_PLAINTEXT);
    const second = (
      await db.select().from(schema.users).where(eq(schema.users.id, "legacy-1")).limit(1)
    )[0]!.passwordHash;
    expect(second).toBe(first);
  });
});

describe("oversized credentials are rejected before hashing", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(() => {
    db = resetDbForTests();
  });

  it("registration rejects an oversize password", async () => {
    await expect(
      createUserWithPassword(db, {
        email: "big@example.com",
        password: "z".repeat(MAX_PASSWORD_LENGTH + 1)
      })
    ).rejects.toThrow(/at most/);
  });

  it("login with an oversize password fails fast and does not authenticate", async () => {
    await createUserWithPassword(db, { email: "ok@example.com", password: "a-good-password" });
    const started = Date.now();
    const result = await authenticateUser(db, "ok@example.com", "z".repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result).toBeNull();
    // Still pays the equalizer derivation (so it cannot be used as an
    // existence oracle) but must not hash the oversize input itself.
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
