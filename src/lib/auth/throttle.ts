import { createHash } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "../../db";

/**
 * Durable authentication throttle (audit 2026-08-06 F-005).
 *
 * Login and registration had no rate limiting at all. That matters more here
 * than in a typical app: the timing equalizer makes EVERY attempt — including
 * for accounts that do not exist — pay a full scrypt derivation (now ~574ms and
 * 64 MiB at scrypt2). Unthrottled, the public login form is an unauthenticated
 * CPU and memory amplifier, and raising the work factor without adding this
 * would have made that worse rather than better. The two controls are designed
 * together.
 *
 * Durability is not optional: Vercel isolates invocations, so a module-level Map
 * would reset constantly and share nothing between instances. The SQL database
 * is the only durable store this app has.
 *
 * Three independent dimensions, because each fails differently:
 *   - per-account  stops credential stuffing against one victim
 *   - per-IP       stops one host walking many accounts
 *   - global       a last-resort ceiling for a distributed attempt, which
 *                  neither of the first two can see
 *
 * Lockouts are DELIBERATELY SHORT and never permanent. A long per-account
 * lockout is itself an attack: anyone who knows a victim's email could lock them
 * out indefinitely. Fifteen minutes destroys the economics of guessing while
 * costing a legitimate user one coffee break, and the per-IP dimension carries
 * the weight against a determined attacker.
 */

const MINUTE = 60_000;

export interface ThrottleRule {
  /** Rolling window length. */
  windowMs: number;
  /** Failures allowed inside the window before the key locks. */
  max: number;
  /** How long the key stays locked once tripped. */
  lockMs: number;
}

export const THROTTLE_RULES: Record<"account" | "ip" | "global", ThrottleRule> = {
  account: { windowMs: 15 * MINUTE, max: 8, lockMs: 15 * MINUTE },
  ip: { windowMs: 15 * MINUTE, max: 30, lockMs: 15 * MINUTE },
  // Wide enough that normal traffic never reaches it; narrow enough to cap the
  // total scrypt work an attacker can force across the whole deployment.
  global: { windowMs: 5 * MINUTE, max: 300, lockMs: 5 * MINUTE }
};

export type ThrottleDimension = keyof typeof THROTTLE_RULES;

/**
 * Keys are hashed so the table never holds an email address or an IP in the
 * clear — it would otherwise become a list of who uses the product and from
 * where, which is exactly the sort of thing that should not accumulate.
 */
export function throttleKey(dimension: ThrottleDimension, identifier: string): string {
  if (dimension === "global") return "global";
  const digest = createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
  return `${dimension}:${digest.slice(0, 32)}`;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Which dimension blocked the request, when blocked. */
  blockedBy: ThrottleDimension | null;
  /** Milliseconds until the caller may retry. 0 when allowed. */
  retryAfterMs: number;
}

const ALLOWED: ThrottleDecision = { allowed: false, blockedBy: null, retryAfterMs: 0 };

/**
 * Is this key currently locked? Read-only — call before doing expensive work.
 */
async function readState(
  key: string,
  db: Db
): Promise<{ attempts: number; windowStart: number; lockedUntil: number | null } | null> {
  const rows = await db
    .select({
      attempts: schema.authAttempts.attempts,
      windowStart: schema.authAttempts.windowStart,
      lockedUntil: schema.authAttempts.lockedUntil
    })
    .from(schema.authAttempts)
    .where(eq(schema.authAttempts.key, key))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    attempts: Number(row.attempts),
    windowStart: Number(row.windowStart),
    lockedUntil: row.lockedUntil == null ? null : Number(row.lockedUntil)
  };
}

/**
 * Check every dimension BEFORE attempting authentication. Returns the first
 * block found so the caller can reject without burning a derivation.
 */
export async function checkThrottle(
  identifiers: { account?: string | null; ip?: string | null },
  now: Date = new Date(),
  db: Db = getDb()
): Promise<ThrottleDecision> {
  const checks: Array<[ThrottleDimension, string]> = [["global", "global"]];
  if (identifiers.account) checks.push(["account", throttleKey("account", identifiers.account)]);
  if (identifiers.ip) checks.push(["ip", throttleKey("ip", identifiers.ip)]);

  for (const [dimension, key] of checks) {
    const state = await readState(key, db);
    if (!state?.lockedUntil) continue;
    if (state.lockedUntil > now.getTime()) {
      return {
        allowed: false,
        blockedBy: dimension,
        retryAfterMs: state.lockedUntil - now.getTime()
      };
    }
  }
  return { ...ALLOWED, allowed: true };
}

/**
 * Record ONE failed attempt against every dimension, rolling the window and
 * locking any dimension that trips its limit.
 *
 * Only failures are recorded. Counting successes would let ordinary use lock a
 * busy household out, and provides no security benefit.
 */
export async function recordFailure(
  identifiers: { account?: string | null; ip?: string | null },
  now: Date = new Date(),
  db: Db = getDb()
): Promise<void> {
  const targets: Array<[ThrottleDimension, string]> = [["global", "global"]];
  if (identifiers.account) targets.push(["account", throttleKey("account", identifiers.account)]);
  if (identifiers.ip) targets.push(["ip", throttleKey("ip", identifiers.ip)]);

  for (const [dimension, key] of targets) {
    const rule = THROTTLE_RULES[dimension];
    const state = await readState(key, db);
    const nowMs = now.getTime();

    // A fresh row, an expired window, or an expired lock all restart counting.
    const windowExpired = !state || nowMs - state.windowStart >= rule.windowMs;
    const lockExpired = state?.lockedUntil != null && state.lockedUntil <= nowMs;
    const attempts = windowExpired || lockExpired ? 1 : state.attempts + 1;
    const windowStart = windowExpired || lockExpired ? nowMs : state.windowStart;
    const lockedUntil = attempts >= rule.max ? nowMs + rule.lockMs : null;

    await db
      .insert(schema.authAttempts)
      .values({ key, attempts, windowStart, lockedUntil })
      .onConflictDoUpdate({
        target: schema.authAttempts.key,
        set: {
          attempts: sql`excluded.attempts`,
          windowStart: sql`excluded."windowStart"`,
          lockedUntil: sql`excluded."lockedUntil"`
        }
      });
  }
}

/**
 * Clear an account's counter after a successful sign-in, so a user who
 * eventually remembers their password is not left near a lockout. The IP and
 * global counters are intentionally NOT cleared: one success must not buy an
 * attacker a fresh budget of guesses.
 */
export async function clearAccountThrottle(
  account: string,
  db: Db = getDb()
): Promise<void> {
  await db.delete(schema.authAttempts).where(eq(schema.authAttempts.key, throttleKey("account", account)));
}

/** Housekeeping: drop rows whose window and lock have both long expired. */
export async function pruneThrottle(olderThan: Date, db: Db = getDb()): Promise<void> {
  await db.delete(schema.authAttempts).where(lt(schema.authAttempts.windowStart, olderThan.getTime()));
}
