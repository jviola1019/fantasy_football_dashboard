import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, generateKey } from "./crypto";

/**
 * The invariant `scripts/reencrypt-credentials.ts` depends on.
 *
 * That script is the only thing standing between "CREDENTIAL_ENCRYPTION_KEY can
 * be rotated" and "rotating it destroys every stored ESPN credential", so the
 * property it relies on is pinned here rather than assumed. These tests use the
 * same crypto primitives the script does; they do not need a database.
 */
describe("credential re-encryption invariant", () => {
  const key = () => Buffer.from(generateKey(), "base64");

  it("re-seals under a new key and round-trips to the identical plaintext", () => {
    const oldKey = key();
    const newKey = key();
    const plaintext = JSON.stringify({ espnS2: "s2-value", swid: "{SWID-VALUE}" });

    const sealedOld = encrypt(plaintext, oldKey);
    const recovered = decrypt(sealedOld, oldKey);
    const sealedNew = encrypt(recovered, newKey);

    expect(decrypt(sealedNew, newKey)).toBe(plaintext);
  });

  it("makes the OLD key unable to read the re-sealed value — the point of rotating", () => {
    const oldKey = key();
    const newKey = key();
    const sealedNew = encrypt("secret-payload", newKey);

    // AES-GCM authenticates, so a wrong key fails loudly rather than returning
    // garbage. If this ever stopped throwing, rotation would be silently
    // meaningless.
    expect(() => decrypt(sealedNew, oldKey)).toThrow();
  });

  it("produces a different ciphertext each time, so re-encryption is not detectable as a no-op", () => {
    const k = key();
    const a = encrypt("same-plaintext", k);
    const b = encrypt("same-plaintext", k);
    // Random IV per seal.
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(decrypt(a, k)).toBe(decrypt(b, k));
  });

  it("rejects a tampered authTag rather than returning altered plaintext", () => {
    const k = key();
    const sealed = encrypt("integrity-matters", k);
    const tampered = { ...sealed, authTag: randomBytes(sealed.authTag.length) };
    expect(() => decrypt(tampered, k)).toThrow();
  });

  it("rejects a key of the wrong length instead of silently truncating", () => {
    // A short key that was quietly padded would produce ciphertext nobody could
    // ever read back with the real key.
    expect(() => encrypt("x", Buffer.alloc(16))).toThrow(/invalid key length/i);
    expect(() => decrypt(encrypt("x", Buffer.alloc(32, 1)), Buffer.alloc(16))).toThrow(/invalid key length/i);
  });
});
