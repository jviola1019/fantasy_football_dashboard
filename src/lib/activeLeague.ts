import { cookies } from "next/headers";
import { getLeagueForUser, listLeagues, type LeagueRecord } from "./leagues";
import { getDb, type Db } from "../db";

// Server-only helpers for the multi-league switcher (Feature C). The active
// league for a session is persisted as an httpOnly cookie so it survives
// page reloads without a DB write. The cookie's value is validated against
// the user's owned leagues every time it's read — a stale or hand-crafted
// id from another user resolves to null and the homepage falls back to
// leagues[0] as if the cookie were absent.

export const ACTIVE_LEAGUE_COOKIE = "rae_active_league";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

/**
 * Read the active-league cookie and verify it belongs to `userId`. Returns
 * the validated league id, or null when the cookie is absent, malformed,
 * or owned by a different user (the validation prevents cookie-pinning
 * cross-user data leakage if an attacker pastes another user's cookie).
 */
export async function getActiveLeagueId(userId: string): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_LEAGUE_COOKIE)?.value;
  if (!raw) return null;
  // UUIDs only — defensive against arbitrary strings being shoved in.
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(raw)) return null;
  const owned = await getLeagueForUser(getDb(), userId, raw);
  return owned ? raw : null;
}

export interface ActiveLeagueResolution {
  league: LeagueRecord;
  /**
   * How the league was chosen. Surfaced rather than swallowed so the UI can
   * tell the user WHICH league they are looking at, and admit when the one
   * they picked is gone instead of silently showing a different team's data.
   */
  reason: "selected" | "only-league" | "no-selection" | "selection-unavailable";
  /** Every league the user owns, already ownership-filtered. */
  leagues: LeagueRecord[];
}

/**
 * Resolve the league a request should operate on (audit P2 §8).
 *
 * The single authoritative selection contract. Trade Center used its own
 * `firstLeague()` returning `leagues[0]`, so a user with several leagues could
 * switch to their superflex dynasty league in the header and still be shown
 * trade values priced for a different league entirely — silently, with the
 * right-looking league name in the banner above it.
 *
 * Ownership is enforced twice: `getActiveLeagueId` rejects a cookie naming
 * another user's league, and the result is then matched against this user's
 * own list, so a foreign id cannot survive even if the first check changed.
 */
export async function resolveActiveLeague(
  userId: string,
  db: Db = getDb()
): Promise<ActiveLeagueResolution | null> {
  const leagues = await listLeagues(db, userId);
  if (leagues.length === 0) return null;

  const store = await cookies();
  const hadCookie = Boolean(store.get(ACTIVE_LEAGUE_COOKIE)?.value);
  const activeId = await getActiveLeagueId(userId);
  const selected = activeId ? leagues.find((l) => l.id === activeId) : undefined;

  if (selected) return { league: selected, reason: "selected", leagues };

  // A cookie that no longer resolves means the league was deleted, or belongs
  // to someone else. Falling back is correct, but the caller is told so the UI
  // can say the previous selection is unavailable.
  return {
    league: leagues[0]!,
    reason: hadCookie ? "selection-unavailable" : leagues.length === 1 ? "only-league" : "no-selection",
    leagues
  };
}

/**
 * Write the active-league cookie. The CALLER must have already verified
 * ownership of `leagueId` via getLeagueForUser — this helper does not
 * gate. The corresponding server action `setActiveLeagueAction` in
 * src/app/settings/leagues/actions.ts is responsible for the auth check.
 */
export async function setActiveLeagueCookie(leagueId: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: ACTIVE_LEAGUE_COOKIE,
    value: leagueId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS
  });
}

/** Clear the active-league cookie (e.g. when the user deletes their active league). */
export async function clearActiveLeagueCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_LEAGUE_COOKIE);
}
