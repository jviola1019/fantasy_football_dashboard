import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORMAT } from "@/lib/trade/format";

/**
 * WHERE A PASTED ESPN COOKIE PAIR ENDS UP.
 *
 * This is a storage-location decision about a secret, made inside a server
 * action, and it is invisible from every screen — which is exactly the kind of
 * thing that quietly regresses. The rule it pins:
 *
 *   typed cookies, no override ticked  -> the ACCOUNT sign-in, one row, no copy
 *                                         on the league
 *   typed cookies, override ticked     -> a league-only row; the account
 *                                         sign-in is left alone
 *   nothing typed                      -> the account pair authenticates the add
 *   nothing typed, no account pair     -> refused, and no league is created
 *   typed cookies, account pair exists -> ADOPTED only when there is none; this
 *                                         form never replaces an account-wide
 *                                         secret
 *
 * The failure this replaces: adding four ESPN leagues stored four encrypted
 * copies of one secret, and rotating the cookie fixed one of them.
 */
const requireUserMock = vi.hoisted(() => vi.fn());
const verifyLeagueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/requireUser", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/trade/verify", () => ({ verifyLeague: verifyLeagueMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resetDbForTests } from "@/db";
import {
  getAccountCredentialAge,
  getAccountCredentials,
  getLeagueCredentials,
  listLeagues
} from "@/lib/leagues";
import { createUserWithPassword } from "@/lib/users";
import { generateKey } from "@/lib/crypto";
import { addLeague } from "./actions";

process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();

const TYPED = { espnS2: "TYPED_S2", swid: "{TYPED-SWID}" };
const OTHER_LOGIN = { espnS2: "OTHER_S2", swid: "{OTHER-SWID}" };

let db: ReturnType<typeof resetDbForTests>;
let userId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function espnForm(overrides: Record<string, string> = {}): FormData {
  return form({
    platform: "espn",
    externalLeagueId: "1546190",
    season: "2026",
    label: "Dynasty Warriors",
    ...overrides
  });
}

beforeEach(async () => {
  db = resetDbForTests();
  const user = await createUserWithPassword(db, {
    email: "manager@example.com",
    password: "correct-horse-battery"
  });
  userId = user.id;
  requireUserMock.mockResolvedValue({ id: userId, email: "manager@example.com", name: null });
  verifyLeagueMock.mockReset();
  verifyLeagueMock.mockResolvedValue({
    ok: true,
    format: DEFAULT_FORMAT,
    resolvedLabel: "Dynasty Warriors",
    resolvedSeason: 2026
  });
});

describe("addLeague stores one ESPN secret, in the right place", () => {
  it("makes the first pasted pair the ACCOUNT sign-in, with no per-league copy", async () => {
    const result = await addLeague(espnForm({ espnS2: TYPED.espnS2, swid: TYPED.swid }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const account = await getAccountCredentials(db, userId);
    expect(account?.espnS2).toBe(TYPED.espnS2);
    expect(account?.swid).toBe(TYPED.swid);
    // The point of the whole change: the league does NOT hold its own copy.
    expect(await getLeagueCredentials(db, result.leagueId)).toBeNull();
  });

  it("adds a second ESPN league with nothing pasted at all", async () => {
    await addLeague(espnForm({ espnS2: TYPED.espnS2, swid: TYPED.swid }));
    const second = await addLeague(espnForm({ externalLeagueId: "9988776", label: "Money League" }));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(await getLeagueCredentials(db, second.leagueId)).toBeNull();
    // And the add was really verified — against the account pair, not skipped.
    expect(verifyLeagueMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentials: TYPED })
    );
    expect((await listLeagues(db, userId)).length).toBe(2);
  });

  it("keeps a ticked override on the league and leaves the account sign-in alone", async () => {
    await addLeague(espnForm({ espnS2: TYPED.espnS2, swid: TYPED.swid }));
    const before = await getAccountCredentialAge(db, userId);

    const second = await addLeague(
      espnForm({
        externalLeagueId: "9988776",
        label: "Other Login League",
        espnS2: OTHER_LOGIN.espnS2,
        swid: OTHER_LOGIN.swid,
        credentialScope: "league"
      })
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(await getLeagueCredentials(db, second.leagueId)).toEqual(OTHER_LOGIN);
    const after = await getAccountCredentials(db, userId);
    expect(after?.espnS2).toBe(TYPED.espnS2);
    expect(after?.rotatedAt.getTime()).toBe(before?.rotatedAt.getTime());
  });

  it("refuses an ESPN league when nothing is pasted and nothing is saved", async () => {
    const result = await addLeague(espnForm());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ESPN sign-in/);
    // Nothing half-created, and no pointless network call spent.
    expect(await listLeagues(db, userId)).toEqual([]);
    expect(verifyLeagueMock).not.toHaveBeenCalled();
  });

  it("does not store a pair that ESPN rejected", async () => {
    // Verification runs BEFORE the write, so a bad paste leaves no trace to
    // debug later — and cannot masquerade as a working sign-in on the account
    // page, where age is the only signal.
    verifyLeagueMock.mockResolvedValue({ ok: false, error: "ESPN returned 401" });
    const result = await addLeague(espnForm({ espnS2: "WRONG", swid: "{WRONG}" }));
    expect(result.ok).toBe(false);
    expect(await getAccountCredentialAge(db, userId)).toBeNull();
    expect(await listLeagues(db, userId)).toEqual([]);
  });

  it("adopts a pasted pair as the account sign-in, but never REPLACES one", async () => {
    // The form cannot send account-scoped cookies once a pair exists — the
    // fields collapse into the override tick — so a request that does is
    // hand-crafted. Swapping an account-wide secret from a league form is not
    // something this path should be able to do; replacing has its own verified
    // home on /settings/account.
    await addLeague(espnForm({ espnS2: TYPED.espnS2, swid: TYPED.swid }));
    const first = await getAccountCredentials(db, userId);

    await addLeague(
      espnForm({
        externalLeagueId: "9988776",
        label: "Forged",
        espnS2: OTHER_LOGIN.espnS2,
        swid: OTHER_LOGIN.swid,
        credentialScope: "account"
      })
    );

    const after = await getAccountCredentials(db, userId);
    expect(after?.espnS2).toBe(TYPED.espnS2);
    expect(after?.rotatedAt.getTime()).toBe(first?.rotatedAt.getTime());
  });

  it("never asks Sleeper for credentials", async () => {
    // The regression guard for the branch above: `credentialScope` defaults to
    // "account", and a Sleeper add must not therefore write an ESPN sign-in.
    await addLeague(
      form({
        platform: "sleeper",
        externalLeagueId: "1395917841022074880",
        season: "2026",
        label: "Offline"
      })
    );
    expect(await getAccountCredentialAge(db, userId)).toBeNull();
    expect(verifyLeagueMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: undefined })
    );
  });
});
