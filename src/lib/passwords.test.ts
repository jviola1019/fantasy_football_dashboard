import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("password hashing", () => {
  it("produces a versioned salt$hash string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(3);
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

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt1$onlyone")).toBe(false);
  });

  it("salts are unique per call", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-here", a)).toBe(true);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });
});
