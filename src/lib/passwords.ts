import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/**
 * Versioned scrypt password storage.
 *
 * Audit 2026-08-06 F-005. The previous single profile was N=16384, r=8, p=1.
 * OWASP's scrypt guidance lists a set of equivalent-strength minimums
 * (2^17/8/1, 2^16/8/2, 2^15/8/3, 2^14/8/5); N=16384 with p=1 is below all of
 * them, so the old parameters did not meet the floor.
 *
 * Benchmarked on this codebase (Node 25.8.2, 16 cores), median of 5:
 *   N=16384  r=8 p=1    16 MiB    124 ms   <- old, below OWASP floor
 *   N=32768  r=8 p=1    32 MiB    227 ms
 *   N=65536  r=8 p=1    64 MiB    343 ms
 *   N=65536  r=8 p=2    64 MiB    574 ms   <- chosen (scrypt2)
 *   N=131072 r=8 p=1   128 MiB    583 ms
 *
 * scrypt2 = N=65536, r=8, p=2. It is an OWASP-listed equivalent profile at HALF
 * the memory of 2^17/8/1 (memory is 128*N*r and is independent of p). Memory is
 * the binding constraint here, not CPU: the login path runs a full derivation on
 * EVERY attempt including unknown accounts (the timing equalizer in lib/users),
 * so peak memory scales with concurrent attempts. 2^17 would put 128 MiB behind
 * every unauthenticated request. Durable rate limiting (lib/auth/throttle)
 * bounds that concurrency; the two controls are designed together.
 *
 * `maxmem` must be set explicitly: Node defaults to 32 MiB and any N above
 * 16384 (at r=8) throws "memory limit exceeded" without it.
 */
interface ScryptProfile {
  readonly version: string;
  readonly options: ScryptOptions;
}

const SCRYPT1: ScryptProfile = {
  version: "scrypt1",
  // Legacy. Verify-only — never used to create a new hash.
  options: { N: 16384, r: 8, p: 1, maxmem: 2 * 128 * 16384 * 8 }
};

const SCRYPT2: ScryptProfile = {
  version: "scrypt2",
  options: { N: 65536, r: 8, p: 2, maxmem: 2 * 128 * 65536 * 8 }
};

const PROFILES: Record<string, ScryptProfile> = {
  [SCRYPT1.version]: SCRYPT1,
  [SCRYPT2.version]: SCRYPT2
};

/** The profile new hashes are written with. */
export const CURRENT_PROFILE = SCRYPT2;

const KEY_LEN = 64;
const SALT_LEN = 16;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Upper bound on accepted password length.
 *
 * F-005: there was no maximum anywhere, and scrypt hashes the full input, so a
 * multi-megabyte "password" was an unauthenticated CPU/memory amplifier. 1024
 * is far above any real passphrase and is rejected BEFORE any derivation runs.
 * Nothing is silently truncated — oversize input is an error.
 */
export const MAX_PASSWORD_LENGTH = 1024;

export class PasswordTooLongError extends Error {
  constructor() {
    super(`password must be at most ${MAX_PASSWORD_LENGTH} characters`);
    this.name = "PasswordTooLongError";
  }
}

function derive(password: string | Buffer, salt: Buffer, profile: ScryptProfile): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LEN, profile.options);
}

/** True when the plaintext is outside the accepted size band. */
export function isPasswordLengthValid(plaintext: string): boolean {
  return plaintext.length >= MIN_PASSWORD_LENGTH && plaintext.length <= MAX_PASSWORD_LENGTH;
}

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be a string of at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (plaintext.length > MAX_PASSWORD_LENGTH) throw new PasswordTooLongError();
  const salt = randomBytes(SALT_LEN);
  const derived = await derive(plaintext, salt, CURRENT_PROFILE);
  return `${CURRENT_PROFILE.version}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Parse a stored hash without throwing on malformed input. */
function parseStored(
  stored: string
): { profile: ScryptProfile; salt: Buffer; expected: Buffer } | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 3) return null;
  const [version, saltB64, hashB64] = parts;
  if (!version || !saltB64 || !hashB64) return null;
  const profile = PROFILES[version];
  if (!profile) return null;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return null;
  }
  if (expected.length !== KEY_LEN || salt.length === 0) return null;
  return { profile, salt, expected };
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  // Reject oversize input before doing any work — this is the amplification guard.
  if (typeof plaintext !== "string" || plaintext.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const derived = await derive(plaintext, parsed.salt, parsed.profile);
  return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
}

/**
 * True when `stored` was written with an older profile and should be re-hashed
 * after a SUCCESSFUL authentication. Callers must never rehash on failure — that
 * would let an attacker drive work with wrong passwords.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  return parsed.profile.version !== CURRENT_PROFILE.version;
}

/** The profile version a stored hash uses, or null if unparseable. */
export function hashVersion(stored: string): string | null {
  return parseStored(stored)?.profile.version ?? null;
}
