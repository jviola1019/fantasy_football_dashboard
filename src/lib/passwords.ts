import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string | Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEY_LEN = 64;
const SALT_LEN = 16;
const VERSION = "scrypt1";

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length < 8) {
    throw new Error("password must be a string of at least 8 characters");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(plaintext, salt, KEY_LEN);
  return `${VERSION}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string" || !stored.startsWith(`${VERSION}$`)) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, saltB64, hashB64] = parts;
  if (!saltB64 || !hashB64) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;
  const derived = await scrypt(plaintext, salt, KEY_LEN);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
