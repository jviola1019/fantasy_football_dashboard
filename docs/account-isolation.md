# Account isolation

RAE stores per-user data (leagues, encrypted credentials, notifications) in the same Postgres tables across the whole tenant. Isolation is enforced by every server-side query carrying the signed-in user's `session.user.id` (Auth.js JWT) in its `where` clause, and by the API routes refusing to act on data the session doesn't own.

## The guarantees we make

1. **No user can list another user's leagues.** Every read path goes through `listLeagues(db, userId)` in `src/lib/leagues.ts:60`. There is no "global" league query in the codebase.
2. **No user can refresh, decrypt, or delete another user's league.** `getLeagueForUser(db, userId, leagueId)` returns null for non-owned ids; `deleteLeagueForUser` only matches when both the league id *and* the user id match. The refresh route in `src/app/api/leagues/[id]/refresh/route.ts` returns 404 when `getLeagueForUser` returns null.
3. **No user can list, dismiss, or write another user's notifications.** `listNotificationsForUser`, `dismissNotificationForUser` (`src/lib/lifecycle/notifications.ts:42`+`67`) both scope by `userId`. `GET /api/notifications` reads `session.user.id` from `auth()`.
4. **ESPN cookies and other encrypted payloads are stored AES-256-GCM-encrypted in the `leagueCredentials` table.** They are never returned to the client after creation. Decryption happens only inside `getLeagueCredentials(db, leagueId)`, and only after the same league has passed the per-user ownership check above.
5. **Sessions are stateless JWTs signed with `AUTH_SECRET`** (`session: { strategy: "jwt" }` in `src/lib/auth.ts`). The Drizzle adapter persists users + accounts + verificationTokens; the session itself lives in the cookie, so revoking a user requires deleting / disabling their `users` row.

## Regression gates

| Test | Asserts |
| --- | --- |
| `src/lib/leagues.test.ts` | Vitest: `getLeagueForUser` / `listLeagues` / `deleteLeagueForUser` reject cross-user ids. |
| `src/lib/lifecycle/notifications.test.ts` | Vitest: notification list/dismiss reject cross-user ids. |
| `src/lib/users.test.ts` | Vitest: `authenticateUser` returns null for a wrong password and a non-existent email — without leaking which case it was. |
| `e2e/07-no-shared-data.spec.ts` | Playwright: two parallel browser sessions never see each other's data, including via the refresh API. |

## What is not yet isolated (documented future work)

- The homepage fixture envelope is the same for every visitor. The `<DemoBanner>` makes this unambiguous; the next sprint will auto-load each user's first league when present.
- The lifecycle cron runs against every stored league but writes notifications scoped per `userId` from the league row. No cross-user leak, but a single cron failure still affects everyone.

## What would break isolation if changed (do not)

- Replacing `getLeagueForUser` with a single-arg `getLeague(leagueId)` query.
- Returning `getLeagueCredentials(db, leagueId)` from any API route directly.
- Caching anything keyed only by `leagueId` (always key by `(userId, leagueId)`).
- Adding a "global" notifications feed that any user can read without filtering by `userId`.
