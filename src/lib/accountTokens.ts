import { decrypt, encrypt, getCredentialKey } from "./crypto";

/**
 * OAuth tokens stored in the `accounts` table are encrypted at rest with the
 * same AES-256-GCM key used for league credentials. Format on disk:
 *   "enc:v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>"
 * Plain values without the prefix are returned unchanged (migration tolerance).
 */
const PREFIX = "enc:v1:";

export function sealToken(token: string | null | undefined): string | null {
  if (token == null || token === "") return token ?? null;
  const key = getCredentialKey();
  const sealed = encrypt(token, key);
  return `${PREFIX}${sealed.iv.toString("base64")}:${sealed.authTag.toString("base64")}:${sealed.ciphertext.toString("base64")}`;
}

export function openToken(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [, , ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) return null;
  const key = getCredentialKey();
  return decrypt(
    {
      iv: Buffer.from(ivB64, "base64"),
      authTag: Buffer.from(tagB64, "base64"),
      ciphertext: Buffer.from(ctB64, "base64")
    },
    key
  );
}
