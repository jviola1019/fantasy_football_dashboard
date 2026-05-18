import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface SealedPayload {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

export function getCredentialKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required (base64-encoded 32 bytes)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encrypt(plaintext: string, key: Buffer): SealedPayload {
  if (key.length !== KEY_BYTES) throw new Error("invalid key length");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext };
}

export function decrypt(payload: SealedPayload, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error("invalid key length");
  const decipher = createDecipheriv(ALGO, key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
