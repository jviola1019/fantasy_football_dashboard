import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality for comparing secrets (cron Bearer tokens, the
 * admin bootstrap token). A plain `a === b` short-circuits on the first
 * differing byte, leaking timing that can be used to recover the secret
 * byte-by-byte. `timingSafeEqual` compares the whole buffer in constant time.
 *
 * Lengths are compared first (a mismatch returns false immediately) because
 * `timingSafeEqual` throws on unequal-length buffers; this mirrors the existing
 * password-verify path in src/lib/passwords.ts and only reveals length, not
 * content. Server-only (Node crypto).
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
