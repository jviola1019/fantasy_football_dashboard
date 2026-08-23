import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../db";
import {
  checkThrottle,
  clearAccountThrottle,
  recordFailure,
  THROTTLE_RULES,
  throttleKey
} from "./throttle";

describe("auth throttle (F-005)", () => {
  let db: ReturnType<typeof resetDbForTests>;
  const T0 = new Date("2026-08-14T12:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  const account = "victim@example.com";
  const ip = "203.0.113.9";

  beforeEach(() => {
    db = resetDbForTests();
  });

  async function failNTimes(n: number, ids: { account?: string; ip?: string }, when = T0) {
    for (let i = 0; i < n; i += 1) await recordFailure(ids, when, db);
  }

  it("allows attempts under the limit", async () => {
    await failNTimes(THROTTLE_RULES.account.max - 1, { account }, T0);
    const gate = await checkThrottle({ account }, T0, db);
    expect(gate.allowed).toBe(true);
  });

  it("LOCKS the account once the limit is reached", async () => {
    await failNTimes(THROTTLE_RULES.account.max, { account }, T0);
    const gate = await checkThrottle({ account }, T0, db);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("account");
    expect(gate.retryAfterMs).toBeGreaterThan(0);
  });

  it("the lock EXPIRES — it is never permanent", async () => {
    // A permanent per-account lock would itself be an attack: anyone who knows
    // the victim's email could lock them out forever.
    await failNTimes(THROTTLE_RULES.account.max, { account }, T0);
    expect((await checkThrottle({ account }, T0, db)).allowed).toBe(false);
    const afterLock = at(THROTTLE_RULES.account.lockMs + 1);
    expect((await checkThrottle({ account }, afterLock, db)).allowed).toBe(true);
  });

  it("does not lock a DIFFERENT account", async () => {
    await failNTimes(THROTTLE_RULES.account.max, { account }, T0);
    expect((await checkThrottle({ account: "someone-else@example.com" }, T0, db)).allowed).toBe(true);
  });

  it("locks by IP even when each attempt targets a different account", async () => {
    // Credential stuffing walks many accounts from one host; the per-account
    // dimension alone would never notice.
    for (let i = 0; i < THROTTLE_RULES.ip.max; i += 1) {
      await recordFailure({ account: `user${i}@example.com`, ip }, T0, db);
    }
    const gate = await checkThrottle({ account: "fresh@example.com", ip }, T0, db);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("ip");
  });

  it("a rolling window resets the counter", async () => {
    await failNTimes(THROTTLE_RULES.account.max - 1, { account }, T0);
    const later = at(THROTTLE_RULES.account.windowMs + 1);
    await recordFailure({ account }, later, db);
    // That attempt started a NEW window, so it must not trip the limit.
    expect((await checkThrottle({ account }, later, db)).allowed).toBe(true);
  });

  it("a successful sign-in clears the account counter but NOT the ip counter", async () => {
    await failNTimes(3, { account, ip }, T0);
    await clearAccountThrottle(account, db);
    expect((await checkThrottle({ account }, T0, db)).allowed).toBe(true);

    // One success must not buy an attacker a fresh budget of guesses from the
    // same host, so keep failing on the IP dimension and confirm it still trips.
    for (let i = 0; i < THROTTLE_RULES.ip.max; i += 1) {
      await recordFailure({ ip }, T0, db);
    }
    expect((await checkThrottle({ ip }, T0, db)).blockedBy).toBe("ip");
  });

  it("the global ceiling catches a distributed attempt that no single key sees", async () => {
    for (let i = 0; i < THROTTLE_RULES.global.max; i += 1) {
      await recordFailure({ account: `u${i}@example.com`, ip: `198.51.100.${i % 250}` }, T0, db);
    }
    const gate = await checkThrottle({ account: "brand-new@example.com", ip: "192.0.2.1" }, T0, db);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("global");
  });

  it("stores only HASHED keys — no email or IP in the clear", async () => {
    await recordFailure({ account, ip }, T0, db);
    const rows = await db.select().from((await import("../../db")).schema.authAttempts);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(account);
    expect(serialized).not.toContain(ip);
    expect(throttleKey("account", account)).toMatch(/^account:[0-9a-f]{32}$/);
  });

  it("normalizes the account key so casing cannot bypass the limit", async () => {
    expect(throttleKey("account", "Victim@Example.com ")).toBe(throttleKey("account", account));
  });

  it("returns allowed for a completely fresh key", async () => {
    expect((await checkThrottle({ account: "nobody@example.com" }, T0, db)).allowed).toBe(true);
  });
});
