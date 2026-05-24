import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests, schema } from "../db";
import { createLeague } from "./leagues";
import { generateKey } from "./crypto";

// next/headers is server-only and not available in vitest by default; mock it
// to return a controllable cookie store. This isolates the cookie-read +
// ownership-validation logic from the Next.js server runtime.
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

// db comes from getDb(); resetDbForTests replaces the cached connection with
// a fresh in-memory SQLite. activeLeague.ts calls getDb() through the
// `setActiveLeagueCookie` / `getActiveLeagueId` helpers, which transitively
// import the same db module — sharing the test DB through the cache works
// because resetDbForTests writes to the same module singleton.

let db: ReturnType<typeof resetDbForTests>;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = generateKey();
});

beforeEach(async () => {
  db = resetDbForTests();
  cookieStore.clear();
  await db.insert(schema.users).values([
    { id: "user-a", email: "a@example.com" },
    { id: "user-b", email: "b@example.com" }
  ]);
});

afterEach(() => {
  cookieStore.clear();
});

describe("getActiveLeagueId", () => {
  it("returns null when the cookie is absent", async () => {
    const { getActiveLeagueId } = await import("./activeLeague");
    expect(await getActiveLeagueId("user-a")).toBeNull();
  });

  it("returns the cookie value when it belongs to the user", async () => {
    const league = await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    const { setActiveLeagueCookie, getActiveLeagueId } = await import("./activeLeague");
    await setActiveLeagueCookie(league.id);
    expect(await getActiveLeagueId("user-a")).toBe(league.id);
  });

  it("returns null when the cookie points at another user's league (cross-user defense)", async () => {
    const aLeague = await createLeague(db, {
      userId: "user-a",
      platform: "sleeper",
      externalLeagueId: "L1",
      season: 2026,
      label: "Alpha"
    });
    const { setActiveLeagueCookie, getActiveLeagueId } = await import("./activeLeague");
    // Set the cookie as if user-b had been hijacked to point at user-a's league.
    await setActiveLeagueCookie(aLeague.id);
    expect(await getActiveLeagueId("user-b")).toBeNull();
  });

  it("returns null for a malformed cookie value (anti-injection)", async () => {
    cookieStore.set("rae_active_league", "<script>alert(1)</script>");
    const { getActiveLeagueId } = await import("./activeLeague");
    expect(await getActiveLeagueId("user-a")).toBeNull();
  });

  it("clearActiveLeagueCookie removes the cookie", async () => {
    cookieStore.set("rae_active_league", "anything");
    const { clearActiveLeagueCookie } = await import("./activeLeague");
    await clearActiveLeagueCookie();
    expect(cookieStore.has("rae_active_league")).toBe(false);
  });
});
