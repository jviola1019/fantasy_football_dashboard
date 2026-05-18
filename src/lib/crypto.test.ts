import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateKey, getCredentialKey } from "./crypto";

describe("credential crypto", () => {
  const key = Buffer.from(generateKey(), "base64");

  it("round-trips utf-8 text", () => {
    const sealed = encrypt("hello world", key);
    expect(decrypt(sealed, key)).toBe("hello world");
  });

  it("round-trips a realistic ESPN cookie payload", () => {
    const payload = JSON.stringify({ espnS2: "A".repeat(420), swid: "{ABCDEF12-3456-7890-ABCD-EF1234567890}" });
    const sealed = encrypt(payload, key);
    expect(decrypt(sealed, key)).toBe(payload);
  });

  it("throws when ciphertext is tampered", () => {
    const sealed = encrypt("secret", key);
    sealed.ciphertext[0] = sealed.ciphertext[0] ^ 1;
    expect(() => decrypt(sealed, key)).toThrow();
  });

  it("throws when auth tag is tampered", () => {
    const sealed = encrypt("secret", key);
    sealed.authTag[0] = sealed.authTag[0] ^ 1;
    expect(() => decrypt(sealed, key)).toThrow();
  });

  it("throws when key is wrong", () => {
    const sealed = encrypt("secret", key);
    const other = Buffer.from(generateKey(), "base64");
    expect(() => decrypt(sealed, other)).toThrow();
  });

  it("getCredentialKey validates length and presence", () => {
    expect(() => getCredentialKey({})).toThrow();
    expect(() => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: "too-short" })).toThrow();
    expect(() => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: generateKey() })).not.toThrow();
  });
});
