import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests, schema } from "../../db";

/**
 * `requireUser` is THE authorization choke point for Node-runtime code, and it
 * had no direct test (audit 2026-08-22, P3). `verifySessionUser` underneath it
 * was covered; the WIRING was not -- and the wiring is where the interesting
 * failures live, because it decides what happens when the session provider
 * itself misbehaves.
 *
 * The property that matters is that it FAILS CLOSED. A choke point that returns
 * a user when it is confused is worse than no choke point, because every caller
 * has stopped checking.
 */
const authMock = vi.fn();
vi.mock("../auth", () => ({ auth: () => authMock() }));

const { requireUser } = await import("./requireUser");

describe("requireUser", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(async () => {
    authMock.mockReset();
    db = resetDbForTests();
    await db.insert(schema.users).values({
      id: "user-1",
      email: "a@example.com",
      sessionVersion: 3
    });
  });

  it("returns the user when the token generation matches the stored one", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 3 } });
    const user = await requireUser(db);
    expect(user?.id).toBe("user-1");
    expect(user?.sessionVersion).toBe(3);
  });

  it("returns null when the session provider THROWS", async () => {
    // The `.catch(() => null)` in requireUser. A provider outage must deny
    // access, not fall through to whatever the caller does with an exception.
    authMock.mockRejectedValue(new Error("JWT decrypt failed"));
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null when the session provider returns null", async () => {
    authMock.mockResolvedValue(null);
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null when the token carries NO session generation", async () => {
    // A token minted before sessionVersion existed, or one hand-crafted without
    // it. Absence must not be read as "any generation is fine".
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null when the generation is present but stale", async () => {
    // The revocation path: the stored version was advanced after this token.
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 2 } });
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null for a user that no longer exists", async () => {
    // A token must not outlive the account it names.
    authMock.mockResolvedValue({ user: { id: "deleted-user", sessionVersion: 1 } });
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null when the generation is the right VALUE but the wrong TYPE", async () => {
    // "3" == 3 is true under loose comparison; the check must be strict, or a
    // string-typed claim from a hand-rolled token would authenticate.
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: "3" } });
    expect(await requireUser(db)).toBeNull();
  });

  it("returns null when the session has a user with no id", async () => {
    authMock.mockResolvedValue({ user: { sessionVersion: 3 } });
    expect(await requireUser(db)).toBeNull();
  });
});
