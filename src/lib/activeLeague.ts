import { cookies } from "next/headers";
import { getLeagueForUser } from "./leagues";
import { getDb } from "../db";

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
