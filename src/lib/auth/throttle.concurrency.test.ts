import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../db";
import {
  checkThrottle,
  readThrottleState,
  recordFailure,
  THROTTLE_RULES,
  throttleKey
} from "./throttle";

/**
 * Lost-update coverage for the auth throttle (audit P1 §5).
 *
 * The old implementation read the row, incremented in JavaScript, then wrote
 * the precomputed number back. Two concurrent failures both read `attempts = 5`,
 * both computed `6`, and both wrote `6` — two failures counted as one.
 *
 * These tests deliberately assert the FINAL PERSISTED STATE, not the string
 * `checkThrottle` returns. A throttle can report "blocked" while having quietly
 * dropped increments; only the stored counter shows whether counting worked.
 *
 * Concurrency is real here even though better-sqlite3 is a synchronous driver:
 * every `recordFailure` awaits, which yields to the microtask queue, so under
 * `Promise.all` all reads in the old code completed before any write. Verified
 * by reverting the fix — 10 parallel failures then persisted `attempts = 1`
 * instead of 10.
 */
describe("auth throttle is atomic under concurrency (P1 §5)", () => {
  let db: ReturnType<typeof resetDbForTests>;
  const T0 = new Date("2026-08-16T12:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  const account = "victim@example.com";
  const ip = "203.0.113.9";
  const accountKey = throttleKey("account", account);
  const ipKey = throttleKey("ip", ip);

  beforeEach(() => {
    db = resetDbForTests();
  });

  const parallelFailures = (n: number, ids: { account?: string; ip?: string }, when = T0) =>
    Promise.all(Array.from({ length: n }, () => recordFailure(ids, when, db)));

  it("counts 2 simultaneous failures as 2", async () => {
    await parallelFailures(2, { account });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(2);
  });

  it("counts 10 simultaneous failures as 10", async () => {
    await parallelFailures(10, { account });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(10);
  });

  it("counts every dimension independently in the same parallel burst", async () => {
    await parallelFailures(6, { account, ip });
    expect((await readThrottleState(accountKey, db))!.attempts).toBe(6);
    expect((await readThrottleState(ipKey, db))!.attempts).toBe(6);
    expect((await readThrottleState("global", db))!.attempts).toBe(6);
  });

  it("crosses the account threshold exactly at the limit, not one burst later", async () => {
    // The lost update mattered most here: dropped increments meant the limit
    // was reached late, or under enough parallelism never at all.
    await parallelFailures(THROTTLE_RULES.account.max, { account });

    const state = (await readThrottleState(accountKey, db))!;
    expect(state.attempts).toBe(THROTTLE_RULES.account.max);
    expect(state.lockedUntil).toBe(T0.getTime() + THROTTLE_RULES.account.lockMs);

    const gate = await checkThrottle({ account }, T0, db);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("account");
  });

  it("locks the IP dimension under a parallel walk across many accounts", async () => {
    await Promise.all(
      Array.from({ length: THROTTLE_RULES.ip.max }, (_, i) =>
        recordFailure({ account: `user${i}@example.com`, ip }, T0, db)
      )
    );
    expect((await readThrottleState(ipKey, db))!.attempts).toBe(THROTTLE_RULES.ip.max);
    expect((await checkThrottle({ ip }, T0, db)).blockedBy).toBe("ip");
  });

  it("locks the global dimension under a parallel distributed attempt", async () => {
    await Promise.all(
      Array.from({ length: THROTTLE_RULES.global.max }, (_, i) =>
        recordFailure({ account: `u${i}@example.com`, ip: `198.51.100.${i % 250}` }, T0, db)
      )
    );
    expect((await readThrottleState("global", db))!.attempts).toBe(THROTTLE_RULES.global.max);
    expect((await checkThrottle({ account: "fresh@example.com" }, T0, db)).blockedBy).toBe("global");
  });

  describe("window expiry race", () => {
    it("restarts the window exactly once when a burst straddles the boundary", async () => {
      await parallelFailures(3, { account }, T0);
      const afterWindow = at(THROTTLE_RULES.account.windowMs + 1);

      // Every one of these sees an expired window. The first restarts it; the
      // rest must increment the RESTARTED window, not each restart it to 1.
      await parallelFailures(4, { account }, afterWindow);

      const state = (await readThrottleState(accountKey, db))!;
      expect(state.attempts).toBe(4);
      expect(state.windowStart).toBe(afterWindow.getTime());
    });
  });

  describe("lock expiry race", () => {
    it("restarts counting once after the lock lapses", async () => {
      await parallelFailures(THROTTLE_RULES.account.max, { account }, T0);
      const afterLock = at(THROTTLE_RULES.account.lockMs + 1);
      expect((await checkThrottle({ account }, afterLock, db)).allowed).toBe(true);

      await parallelFailures(3, { account }, afterLock);

      const state = (await readThrottleState(accountKey, db))!;
      expect(state.attempts).toBe(3);
      expect(state.lockedUntil).toBeNull();
      expect((await checkThrottle({ account }, afterLock, db)).allowed).toBe(true);
    });

    it("does NOT slide an active lock forward on further failures", async () => {
      // A lockout that extends on every attempt is a weapon: anyone who knows a
      // victim's email could hold them out indefinitely, which is exactly what
      // the short-lockout design exists to prevent.
      await parallelFailures(THROTTLE_RULES.account.max, { account }, T0);
      const lockedUntil = (await readThrottleState(accountKey, db))!.lockedUntil;

      const later = at(60_000);
      await parallelFailures(5, { account }, later);

      expect((await readThrottleState(accountKey, db))!.lockedUntil).toBe(lockedUntil);
      // And it still expires on the ORIGINAL schedule.
      const afterOriginalLock = at(THROTTLE_RULES.account.lockMs + 1);
      expect((await checkThrottle({ account }, afterOriginalLock, db)).allowed).toBe(true);
    });
  });

  it("locks immediately when a rule's max is 1", async () => {
    // Guards the INSERT branch, which is the only path that never evaluates the
    // ON CONFLICT threshold expression.
    const strict = { windowMs: 60_000, max: 1, lockMs: 60_000 };
    const original = THROTTLE_RULES.account;
    Object.assign(THROTTLE_RULES, { account: strict });
    try {
      await recordFailure({ account }, T0, db);
      expect((await readThrottleState(accountKey, db))!.lockedUntil).toBe(T0.getTime() + 60_000);
      expect((await checkThrottle({ account }, T0, db)).allowed).toBe(false);
    } finally {
      Object.assign(THROTTLE_RULES, { account: original });
    }
  });
});
