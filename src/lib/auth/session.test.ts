import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../db";
import {
  getSessionVersion,
  revokeAllSessions,
  verifySessionUser
} from "./session";
import { authenticateUser, changeUserPassword, createUserWithPassword, deleteUserWithPassword } from "../users";

/**
 * F-004 — server-enforced session revocation.
 *
 * These tests model what an attacker actually holds: a token captured at some
 * earlier moment, i.e. a (userId, sessionVersion) pair. "Old token still works"
 * is expressed as verifySessionUser() accepting a stale version, which is
 * exactly the bug this feature closes.
 */
describe("session revocation (F-004)", () => {
  let db: ReturnType<typeof resetDbForTests>;

  const sessionFor = (id: string) => ({ user: { id } });

  beforeEach(() => {
    db = resetDbForTests();
  });

  async function makeUser(email = "a@example.com", password = "correct-horse-1") {
    return createUserWithPassword(db, { email, password });
  }

  it("new users start at generation 1 and their token verifies", async () => {
    const user = await makeUser();
    expect(user.sessionVersion).toBe(1);
    const verified = await verifySessionUser(sessionFor(user.id), user.sessionVersion, db);
    expect(verified?.id).toBe(user.id);
  });

  it("A STALE TOKEN IS REJECTED AFTER A PASSWORD CHANGE", async () => {
    // The headline defect: before this, the captured token kept working.
    const user = await makeUser();
    const capturedToken = user.sessionVersion;

    const result = await changeUserPassword(db, user.id, "correct-horse-1", "brand-new-password-2");
    expect(result.ok).toBe(true);

    expect(await verifySessionUser(sessionFor(user.id), capturedToken, db)).toBeNull();
  });

  it("the newly issued session works after that password change", async () => {
    const user = await makeUser();
    await changeUserPassword(db, user.id, "correct-horse-1", "brand-new-password-2");

    const reAuthed = await authenticateUser(db, "a@example.com", "brand-new-password-2");
    expect(reAuthed).not.toBeNull();
    const verified = await verifySessionUser(sessionFor(user.id), reAuthed!.sessionVersion, db);
    expect(verified?.id).toBe(user.id);
  });

  it("ANOTHER BROWSER'S token dies too — revocation is global, not per-cookie", async () => {
    const user = await makeUser();
    // Two devices signed in at the same generation.
    const deviceA = (await authenticateUser(db, "a@example.com", "correct-horse-1"))!.sessionVersion;
    const deviceB = (await authenticateUser(db, "a@example.com", "correct-horse-1"))!.sessionVersion;
    expect(deviceA).toBe(deviceB);

    await changeUserPassword(db, user.id, "correct-horse-1", "brand-new-password-2");

    expect(await verifySessionUser(sessionFor(user.id), deviceA, db)).toBeNull();
    expect(await verifySessionUser(sessionFor(user.id), deviceB, db)).toBeNull();
  });

  it("a DELETED user's token stops working, even though the JWT is still well-formed", async () => {
    const user = await makeUser();
    const captured = user.sessionVersion;
    expect(await deleteUserWithPassword(db, user.id, "correct-horse-1")).toEqual({ ok: true });
    expect(await verifySessionUser(sessionFor(user.id), captured, db)).toBeNull();
  });

  it("rejects a token with NO version claim (pre-feature tokens are not grandfathered)", async () => {
    const user = await makeUser();
    expect(await verifySessionUser(sessionFor(user.id), undefined, db)).toBeNull();
    expect(await verifySessionUser(sessionFor(user.id), null, db)).toBeNull();
  });

  it("rejects an unauthenticated or malformed session", async () => {
    expect(await verifySessionUser(null, 1, db)).toBeNull();
    expect(await verifySessionUser({ user: null }, 1, db)).toBeNull();
    expect(await verifySessionUser({ user: { id: null } }, 1, db)).toBeNull();
  });

  it("rejects a token for a DIFFERENT user id", async () => {
    const a = await makeUser("a@example.com");
    await makeUser("b@example.com");
    expect(await verifySessionUser(sessionFor("does-not-exist"), a.sessionVersion, db)).toBeNull();
  });

  it("does not revoke OTHER users' sessions", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await changeUserPassword(db, a.id, "correct-horse-1", "brand-new-password-2");
    // b is untouched
    expect((await verifySessionUser(sessionFor(b.id), b.sessionVersion, db))?.id).toBe(b.id);
  });

  it("revokeAllSessions increments monotonically and is safe under concurrency", async () => {
    const user = await makeUser();
    // A SQL increment, not read-then-write: concurrent revocations must all land.
    await Promise.all(Array.from({ length: 5 }, () => revokeAllSessions(user.id, db)));
    expect(await getSessionVersion(user.id, db)).toBe(6); // 1 + 5
    expect(await verifySessionUser(sessionFor(user.id), 1, db)).toBeNull();
  });

  it("a failed password change does NOT revoke anything", async () => {
    const user = await makeUser();
    const before = await getSessionVersion(user.id, db);
    const bad = await changeUserPassword(db, user.id, "wrong-current-password", "brand-new-password-2");
    expect(bad.ok).toBe(false);
    expect(await getSessionVersion(user.id, db)).toBe(before);
    // The still-valid session must survive a failed attempt.
    expect(await verifySessionUser(sessionFor(user.id), user.sessionVersion, db)).not.toBeNull();
  });

  it("getSessionVersion returns null for an unknown user", async () => {
    expect(await getSessionVersion("nobody", db)).toBeNull();
  });
});
