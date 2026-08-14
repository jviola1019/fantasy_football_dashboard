import { describe, expect, it } from "vitest";
import {
  CURRENT_PROFILE,
  MAX_PASSWORD_LENGTH,
  hashPassword,
  hashVersion,
  isPasswordLengthValid,
  needsRehash,
  verifyPassword
} from "./passwords";

// A real scrypt1 hash of "correct horse battery staple", generated with the
// legacy profile (N=16384, r=8, p=1). Legacy users must keep working.
const LEGACY_SCRYPT1 =
  "scrypt1$1tcMEFHCxpwioDvCyDIWSA==$r+LpW9yI6A7TdZOpyQKUe6wvLq1qZzI4iWV32Jpl5fagBlvGQWcy7Z7RvZ21qD/Z/l7USlsrm0XubOrq+0T60A==";

describe("password hashing", () => {
  it("produces a versioned salt$hash string using the CURRENT profile", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith(`${CURRENT_PROFILE.version}$`)).toBe(true);
    expect(hash.split("$")).toHaveLength(3);
  });

  it("writes new hashes as scrypt2 at the benchmarked OWASP-equivalent work factor", async () => {
    // Guards against a silent downgrade of the KDF.
    expect(CURRENT_PROFILE.version).toBe("scrypt2");
    expect(CURRENT_PROFILE.options.N).toBe(65536);
    expect(CURRENT_PROFILE.options.r).toBe(8);
    expect(CURRENT_PROFILE.options.p).toBe(2);
    // Node's default maxmem is 32 MiB; without an explicit value this profile throws.
    expect(CURRENT_PROFILE.options.maxmem).toBeGreaterThanOrEqual(128 * 65536 * 8);
  });

  it("verifies correct passwords", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("rejects short passwords on hash", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("rejects malformed stored hashes safely", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt1$onlyone")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "scrypt9$abc$def")).toBe(false); // unknown version
    expect(await verifyPassword("anything", "scrypt2$$")).toBe(false);
    expect(await verifyPassword("anything", "scrypt2$c2FsdA==$dG9vc2hvcnQ=")).toBe(false); // wrong key length
  });

  it("salts are unique per call", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-here", a)).toBe(true);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });
});

describe("legacy scrypt1 migration", () => {
  it("still verifies a legacy scrypt1 hash", async () => {
    expect(await verifyPassword("rae-timing-equalizer-not-a-secret", LEGACY_SCRYPT1)).toBe(true);
  });

  it("rejects a wrong password against a legacy hash", async () => {
    expect(await verifyPassword("nope", LEGACY_SCRYPT1)).toBe(false);
  });

  it("flags legacy hashes for rehash and current hashes as fine", async () => {
    expect(needsRehash(LEGACY_SCRYPT1)).toBe(true);
    expect(needsRehash(await hashPassword("a-current-password"))).toBe(false);
  });

  it("does not flag unparseable hashes for rehash", async () => {
    expect(needsRehash("garbage")).toBe(false);
  });

  it("reports the stored version", async () => {
    expect(hashVersion(LEGACY_SCRYPT1)).toBe("scrypt1");
    expect(hashVersion(await hashPassword("another-password"))).toBe("scrypt2");
    expect(hashVersion("nope")).toBeNull();
  });
});

describe("oversized input (unauthenticated CPU/memory amplifier)", () => {
  const huge = "x".repeat(MAX_PASSWORD_LENGTH + 1);

  it("rejects an oversize password at hash time instead of truncating", async () => {
    await expect(hashPassword(huge)).rejects.toThrow(/at most/);
  });

  it("rejects an oversize password at verify time WITHOUT deriving", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const started = Date.now();
    expect(await verifyPassword(huge, hash)).toBe(false);
    // A real scrypt2 derivation is ~570ms here; the guard must short-circuit
    // long before that, proving no work was done on the oversize input.
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("accepts a password exactly at the limit", async () => {
    const atLimit = "y".repeat(MAX_PASSWORD_LENGTH);
    expect(await verifyPassword(atLimit, await hashPassword(atLimit))).toBe(true);
  });

  it("isPasswordLengthValid enforces both bounds", () => {
    expect(isPasswordLengthValid("short")).toBe(false);
    expect(isPasswordLengthValid("12345678")).toBe(true);
    expect(isPasswordLengthValid(huge)).toBe(false);
  });
});
