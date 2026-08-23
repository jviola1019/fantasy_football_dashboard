import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, schema } from "../db";
import {
  createLeague,
  deleteLeagueForUser,
  findUserLeagueByExternal,
  getLeagueCredentials,
  getLeagueForUser,
  listLeagues
} from "./leagues";
import { generateKey } from "./crypto";

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();
});

describe("league storage and isolation", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(async () => {
    db = resetDbForTests();
    await db.insert(schema.users).values([
      { id: "user-a", email: "a@example.com" },
      { id: "user-b", email: "b@example.com" }
    ]);
  });

  it("encrypts ESPN cookies and round-trips them", async () => {
    const league = await createLeague(db, {
      userId: "user-a",
      platform: "espn",
      externalLeagueId: "12345",
      season: 2026,
      label: "Alpha League",
      credentials: { espnS2: "S2-token", swid: "{ABCD}" }
    });

    const creds = await getLeagueCredentials(db, league.id);
    expect(creds).toEqual({ espnS2: "S2-token", swid: "{ABCD}" });
  });

  it("rejects ESPN leagues missing credentials", async () => {
    await expect(
      createLeague(db, {
        userId: "user-a",
        platform: "espn",
        externalLeagueId: "1",
        season: 2026,
        label: "x"
      })
    ).rejects.toThrow(/espn_s2/i);
  });

  it("isolates leagues per user — getLeagueForUser returns null across users", async () => {
    const league = await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    expect(await getLeagueForUser(db, "user-a", league.id)).not.toBeNull();
    expect(await getLeagueForUser(db, "user-b", league.id)).toBeNull();
  });

  it("isolates leagues per user — listLeagues only returns own", async () => {
    await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    await createLeague(db, {
      userId: "user-b",
      platform: "sleeper",
      externalLeagueId: "L2",
      season: 2026,
      label: "Beta"
    });
    const aLeagues = await listLeagues(db, "user-a");
    const bLeagues = await listLeagues(db, "user-b");
    expect(aLeagues).toHaveLength(1);
    expect(bLeagues).toHaveLength(1);
    expect(aLeagues[0]?.label).toBe("Alpha");
    expect(bLeagues[0]?.label).toBe("Beta");
  });

  it("isolates deletes — user B cannot delete user A's league", async () => {
    const league = await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    const deletedByB = await deleteLeagueForUser(db, "user-b", league.id);
    expect(deletedByB).toBe(false);
    expect(await getLeagueForUser(db, "user-a", league.id)).not.toBeNull();

    const deletedByA = await deleteLeagueForUser(db, "user-a", league.id);
    expect(deletedByA).toBe(true);
    expect(await getLeagueForUser(db, "user-a", league.id)).toBeNull();
  });

  it("rejects a duplicate league (same user, platform, externalLeagueId, season)", async () => {
    await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    await expect(
      createLeague(db, {
        userId: "user-a",
        platform: "sleeper",
        externalLeagueId: "L1",
        season: 2026,
        label: "Alpha again"
      })
    ).rejects.toThrow(/duplicate/i);
    // No second (hollow) row was written.
    expect(await listLeagues(db, "user-a")).toHaveLength(1);
  });

  it("allows the same externalLeagueId across different seasons", async () => {
    await createLeague(db, { userId: "user-a", platform: "sleeper", externalLeagueId: "L1", season: 2025, label: "25" });
    await createLeague(db, { userId: "user-a", platform: "sleeper", externalLeagueId: "L1", season: 2026, label: "26" });
    expect(await listLeagues(db, "user-a")).toHaveLength(2);
  });

  it("the duplicate guard is per-user (same league id under two users is not a dup)", async () => {
    await createLeague(db, { userId: "user-a", platform: "sleeper", externalLeagueId: "L1", season: 2026, label: "A" });
    await createLeague(db, { userId: "user-b", platform: "sleeper", externalLeagueId: "L1", season: 2026, label: "B" });
    expect(await listLeagues(db, "user-a")).toHaveLength(1);
    expect(await listLeagues(db, "user-b")).toHaveLength(1);
  });

  it("findUserLeagueByExternal finds an existing league and ignores other users", async () => {
    const a = await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    expect((await findUserLeagueByExternal(db, "user-a", "sleeper", "L1", 2026))?.id).toBe(a.id);
    expect(await findUserLeagueByExternal(db, "user-b", "sleeper", "L1", 2026)).toBeNull();
    expect(await findUserLeagueByExternal(db, "user-a", "sleeper", "L1", 2025)).toBeNull();
  });

  it("ESPN credentials inserted for user A are not retrievable by user B's session", async () => {
    // The plan's account-isolation invariant: getLeagueCredentials by itself
    // is a leaf-level fn that does NOT take a userId, so the production
    // isolation guarantee depends entirely on callers gating it behind
    // getLeagueForUser. This test simulates the production guarded path —
    // user B never gets a leagueId back from getLeagueForUser, so creds are
    // unreachable even if a hypothetical attacker guessed the league UUID.
    const aLeague = await createLeague(db, {
      userId: "user-a",
      platform: "espn",
      externalLeagueId: "espn-123",
      season: 2026,
      label: "Alpha ESPN",
      credentials: { espnS2: "S2-secret-A", swid: "{AAAA-AAAA-AAAA}" }
    });

    // user-b's session asks for the league via the production-scoped helper.
    // getLeagueForUser must return null (cross-user scope check) — without
    // that null, the caller would never call getLeagueCredentials.
    const seenByB = await getLeagueForUser(db, "user-b", aLeague.id);
    expect(seenByB).toBeNull();

    // user-b does not appear in user-a's league list either.
    const bLeagues = await listLeagues(db, "user-b");
    expect(bLeagues.map((l) => l.id)).not.toContain(aLeague.id);

    // user-a's own session still sees the league and can decrypt the creds.
    const seenByA = await getLeagueForUser(db, "user-a", aLeague.id);
    expect(seenByA).not.toBeNull();
    const credsForA = await getLeagueCredentials(db, aLeague.id);
    expect(credsForA?.espnS2).toBe("S2-secret-A");
  });

  it("cascading delete removes ESPN credentials with the league", async () => {
    // Deleting a user's league must also remove the encrypted credentials —
    // otherwise stale ciphertext lives forever in the leagueCredentials table.
    const aLeague = await createLeague(db, {
      userId: "user-a",
      platform: "espn",
      externalLeagueId: "espn-456",
      season: 2026,
      label: "Alpha ESPN 2",
      credentials: { espnS2: "S2-cascade", swid: "{BBBB}" }
    });
    expect(await getLeagueCredentials(db, aLeague.id)).not.toBeNull();

    const deleted = await deleteLeagueForUser(db, "user-a", aLeague.id);
    expect(deleted).toBe(true);
    expect(await getLeagueCredentials(db, aLeague.id)).toBeNull();
  });

  // ── P1-1 (audit 2026-08-22) ───────────────────────────────────────────────
  it("returns leagues in a deterministic, total order", async () => {
    /**
     * `listLeagues` had no ORDER BY, and `leagues[0]` is the DEFAULT ACTIVE
     * LEAGUE when no selection cookie is present. The order of this result
     * therefore decides whose roster, projections, trade prices and keeper
     * costs a returning user sees. SQLite happened to return insertion order;
     * Postgres is free to return anything, and an UPDATE physically relocates
     * a row -- so merely editing one league's settings could silently change
     * which league the app opened on.
     */
    for (const n of ["one", "two", "three"]) {
      await createLeague(db, {
        userId: "user-a",
        platform: "sleeper",
        externalLeagueId: `ext-${n}`,
        season: 2025,
        label: `League ${n}`,
        sleeperUsername: "someone"
      });
    }
    const first = (await listLeagues(db, "user-a")).map((l) => l.id);
    expect(first).toHaveLength(3);

    // Repeated reads agree...
    expect((await listLeagues(db, "user-a")).map((l) => l.id)).toEqual(first);

    // ...and an UPDATE to a middle row does not reorder the list, which is the
    // exact scenario that changed a user's active league on Postgres.
    await db
      .update(schema.leagues)
      .set({ label: "renamed" })
      .where(eq(schema.leagues.id, first[1]!));
    expect((await listLeagues(db, "user-a")).map((l) => l.id)).toEqual(first);
  });

  // ── P1-6 (audit 2026-08-22) ───────────────────────────────────────────────
  it("does not leave a credential-less league behind when encryption fails", async () => {
    /**
     * createLeague writes TWO rows with no transaction. A failure between them
     * left an ESPN league with no credentials: it could never refresh, reported
     * a misleading error, and the duplicate guard then BLOCKED re-adding it --
     * a permanently bricked row created by a transient failure.
     *
     * Encryption now happens BEFORE any row is written, so the most likely
     * failure (a missing or malformed key) cannot leave anything behind at all.
     */
    const saved = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = "not-a-valid-key";
    try {
      await expect(
        createLeague(db, {
          userId: "user-a",
          platform: "espn",
          externalLeagueId: "ext-espn",
          season: 2025,
          label: "ESPN League",
          credentials: { espnS2: "s2", swid: "{swid}" }
        })
      ).rejects.toThrow();
    } finally {
      process.env.CREDENTIAL_ENCRYPTION_KEY = saved;
    }

    // Nothing was created, so the user can simply try again.
    expect(await listLeagues(db, "user-a")).toHaveLength(0);
    expect(
      await findUserLeagueByExternal(db, "user-a", "espn", "ext-espn", 2025)
    ).toBeNull();
  });
});
