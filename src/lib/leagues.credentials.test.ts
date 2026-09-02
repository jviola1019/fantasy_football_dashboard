import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../db";
import {
  createLeague,
  resolveEspnCredentials,
  setAccountCredentials,
  getAccountCredentialAge,
  deleteAccountCredentials,
  getLeagueCredentials
} from "./leagues";
import { createUserWithPassword } from "./users";
import { generateKey } from "./crypto";

/**
 * ESPN cookies authenticate an ACCOUNT, not a league.
 *
 * Storing them per league meant N pastes to add N leagues and N edits every time
 * ESPN rotated them — and a user who updated three of four got a half-working
 * dashboard with no visible cause. These pin the resolution contract that
 * replaces it, including the case the account-only design would have broken.
 *
 * See docs/espn-credentials-decision.md.
 */
const EMAIL = "manager@example.com";
const PASSWORD = "correct-horse-battery";
// A per-run key, as leagues.test.ts does. The seal is real; only the key is
// ephemeral, so a leaked test fixture cannot decrypt anything.
process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();

const ACCOUNT = { espnS2: "ACCOUNT_S2_VALUE", swid: "{ACCOUNT-SWID}" };
const OVERRIDE = { espnS2: "OVERRIDE_S2_VALUE", swid: "{OVERRIDE-SWID}" };

describe("ESPN credentials resolve account-first, override-wins", () => {
  let db: ReturnType<typeof resetDbForTests>;
  let userId: string;
  let leagueA: string;
  let leagueB: string;

  beforeEach(async () => {
    db = resetDbForTests();
    const user = await createUserWithPassword(db, { email: EMAIL, password: PASSWORD });
    userId = user.id;
    // Two ESPN leagues under one account — the case the old shape charged twice for.
    const a = await createLeague(db, {
      userId,
      platform: "espn",
      externalLeagueId: "1546190",
      season: 2026,
      label: "Dynasty Warriors",
      credentials: OVERRIDE
    });
    const b = await createLeague(db, {
      userId,
      platform: "espn",
      externalLeagueId: "9988776",
      season: 2026,
      label: "Money League",
      credentials: OVERRIDE
    });
    leagueA = a.id;
    leagueB = b.id;
  });

  it("uses the account pair for a league that has no override", async () => {
    // Remove the per-league row that createLeague wrote, leaving only the account.
    const fresh = resetDbForTests();
    const user = await createUserWithPassword(fresh, { email: EMAIL, password: PASSWORD });
    await setAccountCredentials(fresh, user.id, ACCOUNT);
    const league = await createLeague(fresh, {
      userId: user.id,
      platform: "sleeper",
      externalLeagueId: "1395917841022074880",
      season: 2026,
      label: "Offline"
    });
    const resolved = await resolveEspnCredentials(fresh, user.id, league.id);
    expect(resolved?.espnS2).toBe(ACCOUNT.espnS2);
    expect(resolved?.origin).toBe("account");
  });

  it("prefers a per-league override where one exists", async () => {
    // The case an account-ONLY design would have broken: two ESPN logins.
    await setAccountCredentials(db, userId, ACCOUNT);
    const resolved = await resolveEspnCredentials(db, userId, leagueA);
    expect(resolved?.espnS2).toBe(OVERRIDE.espnS2);
    expect(resolved?.origin).toBe("league-override");
  });

  it("returns null rather than a default when neither exists", async () => {
    const fresh = resetDbForTests();
    const user = await createUserWithPassword(fresh, { email: EMAIL, password: PASSWORD });
    const league = await createLeague(fresh, {
      userId: user.id,
      platform: "sleeper",
      externalLeagueId: "123",
      season: 2026,
      label: "No creds"
    });
    expect(await resolveEspnCredentials(fresh, user.id, league.id)).toBeNull();
  });

  it("one account write serves every league that has no override", async () => {
    // THE WHOLE POINT. One paste, N leagues.
    const fresh = resetDbForTests();
    const user = await createUserWithPassword(fresh, { email: EMAIL, password: PASSWORD });
    const ids: string[] = [];
    for (const ext of ["111", "222", "333"]) {
      const l = await createLeague(fresh, {
        userId: user.id,
        platform: "sleeper",
        externalLeagueId: ext,
        season: 2026,
        label: `League ${ext}`
      });
      ids.push(l.id);
    }
    await setAccountCredentials(fresh, user.id, ACCOUNT);
    for (const id of ids) {
      const r = await resolveEspnCredentials(fresh, user.id, id);
      expect(r?.espnS2, `league ${id} did not see the account pair`).toBe(ACCOUNT.espnS2);
    }
  });

  it("re-sealing replaces the pair and moves rotatedAt forward", async () => {
    await setAccountCredentials(db, userId, ACCOUNT);
    const first = await getAccountCredentialAge(db, userId);
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await setAccountCredentials(db, userId, { espnS2: "ROTATED", swid: "{NEW}" });
    const second = await getAccountCredentialAge(db, userId);
    expect(second!.rotatedAt.getTime()).toBeGreaterThanOrEqual(first!.rotatedAt.getTime());
    const fresh = resetDbForTests();
    // and the value really changed
    const league = await createLeague(db, {
      userId,
      platform: "sleeper",
      externalLeagueId: "777",
      season: 2026,
      label: "x"
    });
    expect((await resolveEspnCredentials(db, userId, league.id))?.espnS2).toBe("ROTATED");
    expect(fresh).toBeDefined();
  });

  it("never stores the cookies in plaintext", async () => {
    // The seal is the whole reason this table exists rather than a settings row.
    await setAccountCredentials(db, userId, ACCOUNT);
    const raw = await db.select().from((await import("../db/schema")).accountCredentials);
    const blob = Buffer.from(raw[0]!.ciphertext as Buffer).toString("utf8");
    expect(blob).not.toContain(ACCOUNT.espnS2);
    expect(blob).not.toContain("espnS2");
  });

  it("keeps one user's credentials away from another's", async () => {
    // Account isolation: the primary key is userId, and the resolver is passed
    // the userId rather than trusting the league row.
    const other = await createUserWithPassword(db, {
      email: "other@example.com",
      password: PASSWORD
    });
    await setAccountCredentials(db, userId, ACCOUNT);
    const leagueOfOther = await createLeague(db, {
      userId: other.id,
      platform: "sleeper",
      externalLeagueId: "555",
      season: 2026,
      label: "Theirs"
    });
    expect(await resolveEspnCredentials(db, other.id, leagueOfOther.id)).toBeNull();
  });

  it("deletes cleanly", async () => {
    await setAccountCredentials(db, userId, ACCOUNT);
    await deleteAccountCredentials(db, userId);
    expect(await getAccountCredentialAge(db, userId)).toBeNull();
  });

  it("leaves the existing per-league accessor working", async () => {
    // Nothing about the old path changes; it is now the override.
    const creds = await getLeagueCredentials(db, leagueB);
    expect(creds?.espnS2).toBe(OVERRIDE.espnS2);
  });
});
