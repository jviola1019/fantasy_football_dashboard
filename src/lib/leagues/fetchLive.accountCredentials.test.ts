import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EspnClient } from "../espn/client";

/**
 * The account-level ESPN pair has to be the one the LIVE FETCH actually uses.
 *
 * `resolveEspnCredentials` shipped with nine tests and a decision doc, and then
 * `fetchLeagueLive` went on calling `getLeagueCredentials` — the per-league
 * lookup. Every part of the feature existed except the line that reaches for it,
 * so a user who saved their ESPN sign-in once and added a second league got
 * "missing credentials" on the second one, from a product that had their
 * cookies the whole time.
 *
 * That is the shape this repo keeps finding: a mechanism that is complete
 * everywhere except at the point of use, and a test suite that covers the
 * mechanism rather than the path. These tests run the real DB, the real seal,
 * and the real `fetchLeagueLive`, and stub only the network.
 */
// `vi.hoisted` because `vi.mock` factories are lifted above every import;
// a plain `const` above them is still in its temporal dead zone when they run.
const { getLeagueMock } = vi.hoisted(() => ({ getLeagueMock: vi.fn() }));
vi.mock("../espn/league", () => ({
  getLeague: getLeagueMock,
  getRoster: vi.fn(),
  getScoreboard: vi.fn(),
  getDraft: vi.fn(),
  getTransactions: vi.fn(),
  getFreeAgents: vi.fn()
}));

import { resetDbForTests } from "../../db";
import { createLeague, deleteAccountCredentials, setAccountCredentials } from "../leagues";
import { createUserWithPassword } from "../users";
import { generateKey } from "../crypto";
import { fetchLeagueLive } from "./fetchLive";

process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();

const ACCOUNT = { espnS2: "ACCOUNT_S2", swid: "{ACCOUNT-SWID}" };
const OVERRIDE = { espnS2: "OVERRIDE_S2", swid: "{OVERRIDE-SWID}" };

/** The cookie header the production client would send, captured at the seam. */
let sentCookie: string | undefined;

beforeEach(() => {
  sentCookie = undefined;
  getLeagueMock.mockReset();
  getLeagueMock.mockImplementation(async (client: EspnClient) => {
    sentCookie = client.cookieHeader();
    return {
      data: { teams: [], settings: null },
      source: {
        source: "ESPN league (test)",
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 300,
        freshness: "fresh" as const,
        confidence: 0.9,
        validation: "valid" as const,
        missingFields: [],
        assumptions: [],
        failure: null
      }
    };
  });
});

async function seed(opts: { account: boolean; override: boolean }) {
  const db = resetDbForTests();
  const user = await createUserWithPassword(db, {
    email: "manager@example.com",
    password: "correct-horse-battery"
  });
  if (opts.account) await setAccountCredentials(db, user.id, ACCOUNT);
  const league = await createLeague(db, {
    userId: user.id,
    platform: "espn",
    externalLeagueId: "1546190",
    season: 2026,
    label: "Dynasty Warriors",
    credentials: opts.override ? OVERRIDE : undefined
  });
  return { db, userId: user.id, leagueId: league.id };
}

describe("fetchLeagueLive reaches ESPN with the credentials that resolution picked", () => {
  it("uses the ACCOUNT pair for a league that has no override", async () => {
    // THE DEFECT. Before the fix this returned failure "missing credentials"
    // and never called ESPN at all, despite the account row existing.
    const { db, userId, leagueId } = await seed({ account: true, override: false });
    const snapshot = await fetchLeagueLive(userId, leagueId, db);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.failure).not.toBe("missing credentials");
    expect(getLeagueMock).toHaveBeenCalledTimes(1);
    expect(sentCookie).toBe("espn_s2=ACCOUNT_S2; SWID={ACCOUNT-SWID}");
  });

  it("lets a per-league override win over the account pair", async () => {
    const { db, userId, leagueId } = await seed({ account: true, override: true });
    await fetchLeagueLive(userId, leagueId, db);
    expect(sentCookie).toBe("espn_s2=OVERRIDE_S2; SWID={OVERRIDE-SWID}");
  });

  it("still reports missing credentials once the account sign-in is revoked — the canary", async () => {
    // Without this, the two tests above could pass on a build that simply
    // always fetched, and "missing credentials" would have quietly stopped
    // being reachable.
    //
    // Note HOW the state is reached. `createLeague` now refuses to create an
    // ESPN league that cannot authenticate at all, so the honest way here is
    // the way a real user gets here: the league is added against the account
    // pair, and the account pair is later removed. That is a supported action,
    // and this pins what the leagues do afterwards — degrade with a stated
    // reason, not fetch with nothing and report an ESPN-side error.
    const { db, userId, leagueId } = await seed({ account: true, override: false });
    await deleteAccountCredentials(db, userId);
    const snapshot = await fetchLeagueLive(userId, leagueId, db);
    expect(snapshot!.failure).toBe("missing credentials");
    expect(getLeagueMock).not.toHaveBeenCalled();
  });

  it("refuses to create an ESPN league that could never authenticate", async () => {
    // The other half of the invariant the canary now leans on: relaxing
    // createLeague to accept the account pair must NOT relax it to accept
    // nothing, which would brick the row at add time instead of at fetch time.
    const db = resetDbForTests();
    const user = await createUserWithPassword(db, {
      email: "nocreds@example.com",
      password: "correct-horse-battery"
    });
    await expect(
      createLeague(db, {
        userId: user.id,
        platform: "espn",
        externalLeagueId: "1546190",
        season: 2026,
        label: "No Cookies",
        credentials: undefined
      })
    ).rejects.toThrow(/espn_s2/);
  });

  it("declares WHICH credential the request used, so provenance is not guesswork", async () => {
    // "Never remove source metadata." A request authenticated by the account
    // sign-in and one authenticated by a league-specific paste are different
    // facts, and the difference is exactly what a user debugging a 401 needs.
    const account = await seed({ account: true, override: false });
    const viaAccount = await fetchLeagueLive(account.userId, account.leagueId, account.db);
    expect(viaAccount!.source.assumptions.join(" ")).toContain("account ESPN sign-in");

    const override = await seed({ account: true, override: true });
    const viaOverride = await fetchLeagueLive(override.userId, override.leagueId, override.db);
    expect(viaOverride!.source.assumptions.join(" ")).toContain("league-specific ESPN cookies");
  });

  it("never puts a cookie value in the metadata it declares", async () => {
    // The origin is safe to show. The secret is not, and this is the test that
    // keeps a later "helpful" debug line from shipping one.
    const { db, userId, leagueId } = await seed({ account: true, override: false });
    const snapshot = await fetchLeagueLive(userId, leagueId, db);
    const serialised = JSON.stringify(snapshot!.source);
    expect(serialised).not.toContain(ACCOUNT.espnS2);
    expect(serialised).not.toContain(ACCOUNT.swid);
  });
});
