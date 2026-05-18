import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, schema } from "../db";
import {
  createLeague,
  deleteLeagueForUser,
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
});
