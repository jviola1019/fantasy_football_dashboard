import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, schema } from "../db";
import { createLeague } from "./leagues";
import { generateKey } from "./crypto";
import { DEFAULT_FORMAT, type LeagueFormat } from "./trade/format";

/**
 * The authoritative active-league contract (audit P2 §8).
 *
 * Trade Center resolved its league with a private `firstLeague()` that returned
 * `leagues[0]`, ignoring the header's switcher. For a multi-league user that
 * meant trade values priced for one league displayed under a different league's
 * name — wrong numbers with no visible tell. These tests pin the shared
 * resolver every route now uses.
 */
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    set: ({ name, value }: { name: string; value: string }) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    }
  })
}));

const { ACTIVE_LEAGUE_COOKIE, resolveActiveLeague } = await import("./activeLeague");

let db: ReturnType<typeof resetDbForTests>;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();
});

beforeEach(async () => {
  db = resetDbForTests();
  cookieStore.clear();
  addOrder = 0;
  await db.insert(schema.users).values([
    { id: "user-a", email: "a@example.com" },
    { id: "user-b", email: "b@example.com" }
  ]);
});

afterEach(() => cookieStore.clear());

const fmt = (over: Partial<LeagueFormat>): LeagueFormat => ({ ...DEFAULT_FORMAT, ...over });

/**
 * Adds a league with an EXPLICIT, distinct `createdAt`.
 *
 * `listLeagues` orders by `createdAt` then `id` (audit 2026-08-22, P1-1) --
 * before that it had no ORDER BY at all, so `leagues[0]`, which is the default
 * active league, was whatever the driver happened to return. These tests used
 * to create every league inside the same millisecond and then assert insertion
 * order, which no database ever promised: `createdAt` tied and the random uuid
 * broke the tie, so the assertion passed or failed on a coin flip.
 *
 * A real user adds leagues seconds apart. The helper reproduces that rather
 * than asserting a guarantee the schema cannot make.
 */
let addOrder = 0;

async function addLeague(
  userId: string,
  label: string,
  settings: LeagueFormat,
  externalLeagueId = label.toLowerCase()
) {
  const league = await createLeague(db, {
    userId,
    platform: "sleeper",
    externalLeagueId,
    season: 2026,
    label,
    settings
  });
  addOrder += 1;
  await db
    .update(schema.leagues)
    .set({ createdAt: new Date(1_700_000_000_000 + addOrder * 60_000) })
    .where(eq(schema.leagues.id, league.id));
  return league;
}

describe("resolveActiveLeague", () => {
  it("returns null when the user has no leagues", async () => {
    expect(await resolveActiveLeague("user-a", db)).toBeNull();
  });

  it("returns the only league, flagged as such", async () => {
    await addLeague("user-a", "Solo", fmt({ numTeams: 10 }));
    const res = (await resolveActiveLeague("user-a", db))!;

    expect(res.league.label).toBe("Solo");
    expect(res.reason).toBe("only-league");
    expect(res.leagues).toHaveLength(1);
  });

  it("with several leagues and NO selection, falls back to the first and says so", async () => {
    await addLeague("user-a", "Alpha", fmt({}));
    await addLeague("user-a", "Beta", fmt({}));
    const res = (await resolveActiveLeague("user-a", db))!;

    expect(res.league.label).toBe("Alpha");
    expect(res.reason).toBe("no-selection");
    expect(res.leagues).toHaveLength(2);

    // The property that actually matters, and the one P1-1 was about: the
    // order does not change between reads. An unordered query could return
    // Alpha now and Beta on the next request, silently switching which league
    // the app opens on.
    const again = (await resolveActiveLeague("user-a", db))!;
    expect(again.league.id).toBe(res.league.id);
    expect(again.leagues.map((l) => l.id)).toEqual(res.leagues.map((l) => l.id));
  });

  it("honours the SELECTED second league — the actual bug", async () => {
    await addLeague("user-a", "Alpha", fmt({}));
    const beta = await addLeague("user-a", "Beta", fmt({}));
    cookieStore.set(ACTIVE_LEAGUE_COOKIE, beta.id);

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.league.label).toBe("Beta");
    expect(res.reason).toBe("selected");
  });

  it("carries the SELECTED league's format, not the first league's", async () => {
    // The consequence that mattered: a 12-team PPR redraft league and a 10-team
    // superflex dynasty league price completely differently, and Trade Center
    // was always using the former.
    await addLeague("user-a", "Redraft PPR", fmt({ numTeams: 12, ppr: 1, leagueType: "redraft", numQbs: 1 }));
    const dyn = await addLeague(
      "user-a",
      "Superflex Dynasty",
      fmt({ numTeams: 10, ppr: 0.5, scoringFormat: "HALF", leagueType: "dynasty", numQbs: 2 })
    );
    cookieStore.set(ACTIVE_LEAGUE_COOKIE, dyn.id);

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.league.settings?.leagueType).toBe("dynasty");
    expect(res.league.settings?.numQbs).toBe(2);
    expect(res.league.settings?.numTeams).toBe(10);
  });

  it("falls back and REPORTS when the selected league was deleted", async () => {
    const alpha = await addLeague("user-a", "Alpha", fmt({}));
    const beta = await addLeague("user-a", "Beta", fmt({}));
    cookieStore.set(ACTIVE_LEAGUE_COOKIE, beta.id);
    await db.delete(schema.leagues).where((await import("drizzle-orm")).eq(schema.leagues.id, beta.id));

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.league.id).toBe(alpha.id);
    expect(res.reason).toBe("selection-unavailable");
  });

  it("falls back and REPORTS on a stale/garbage cookie value", async () => {
    const alpha = await addLeague("user-a", "Alpha", fmt({}));
    cookieStore.set(ACTIVE_LEAGUE_COOKIE, "not-a-real-league-id");

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.league.id).toBe(alpha.id);
    expect(res.reason).toBe("selection-unavailable");
  });

  it("NEVER honours another user's league id", async () => {
    const mine = await addLeague("user-a", "Mine", fmt({ numTeams: 12 }));
    const theirs = await addLeague("user-b", "Theirs", fmt({ numTeams: 8 }), "theirs");
    cookieStore.set(ACTIVE_LEAGUE_COOKIE, theirs.id);

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.league.id).toBe(mine.id);
    expect(res.reason).toBe("selection-unavailable");
    // And the foreign league must not appear in the options at all.
    expect(res.leagues.map((l) => l.id)).not.toContain(theirs.id);
  });

  it("only ever lists leagues the user owns", async () => {
    await addLeague("user-a", "Mine", fmt({}));
    await addLeague("user-b", "Theirs", fmt({}), "theirs");

    const res = (await resolveActiveLeague("user-a", db))!;
    expect(res.leagues).toHaveLength(1);
    expect(res.leagues[0]!.label).toBe("Mine");
  });
});
