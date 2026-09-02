# ESPN credentials: what is possible, and what we should build

**Decision date** 2026-09-02 · **Status** accepted, implementation in progress

---

## The question

> Is there a way to permanently add ESPN credentials that will not close or
> expire but is safe and will only save to account settings?

Three parts, and they have three different answers: **no**, **yes**, and
**already true**.

## 1. "Permanent, never expires" — not achievable, and nobody can achieve it

`espn_s2` and `SWID` are session cookies issued by ESPN's auth service. Their
lifetime is ESPN's to set and ESPN's to revoke. Nothing this product stores can
extend them, because the expiry is enforced on ESPN's side at request time.

What the research actually says:

- **ESPN publishes no expiry.** There is no documented lifetime in any ESPN
  API documentation, and none of the mature community clients states one.
- **The observed behaviour is "persists until something invalidates it".**
  The maintainer thread for `cwendt94/espn-api` — the most widely used ESPN
  fantasy client — records only that the cookie "remains the same through
  different sessions". Practical guidance across tools is uniform: cookies keep
  working until you log out or ESPN resets the session, and then you re-paste.
- **Programmatic renewal is blocked deliberately.** ESPN added reCAPTCHA to the
  login flow. The same thread concludes that automated credential capture "would
  likely require using selenium or some browser then grab the cookies", and
  rules it out of scope. Driving a headless browser against ESPN's login to
  farm cookies would also mean handling the user's ESPN password, which this
  product must never do, and would sit squarely against ESPN's terms.

So a claim of "permanent credentials" would be a claim this product cannot
honour. Under the project's own rule — do not present something as reliable that
has not been shown to be — the honest design goal is not permanence. It is:

> **Minimise how often a re-paste is needed, and how much it costs when it is.**

## 2. "Only saves to account settings" — yes, and it is the right shape

Credentials are currently stored **per league**, in `leagueCredentials` keyed by
`leagueId`. That is the wrong shape for how ESPN actually works.

An `espn_s2`/`SWID` pair authenticates **an ESPN account**, not a league. One
login already grants access to every league that account is in. So storing the
same secret once per league means:

- **N pastes to add N leagues**, for a value that is identical every time.
- **N updates on every expiry.** With four ESPN leagues, one cookie rotation is
  four separate edits, and a user who updates three of them gets a dashboard
  that is half-working with no obvious cause.
- **N copies of a secret at rest**, which is N times the surface for a partial
  rotation to leave a stale copy behind.

### The decision

**Account-level storage, per-league override.**

| | where it lives | why |
|---|---|---|
| ESPN cookies | one row per **user** | one paste, one update, one copy at rest |
| League format, keepers, draft slot, season, label | per **league**, unchanged | each league's presets are its own and must stay exact |
| Per-league cookie override | optional, per league | preserves the multi-ESPN-account case |

The override is what makes this safe to adopt rather than a narrowing. Somebody
with leagues under two different ESPN logins keeps working: a league with its own
credentials uses them, and every other league falls back to the account pair.
Resolution order is explicit — **league override, then account default, then
unavailable** — so there is never an ambiguous "which secret did it use".

Encryption is unchanged: AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY`, with the
IV and auth tag stored beside the ciphertext, exactly as `leagueCredentials`
does today. Moving the row does not weaken the seal, and
`scripts/reencrypt-credentials.ts` continues to cover both tables.

### Why not the alternatives

- **"Per league, but offer to copy from another league on add."** Cheaper, and it
  fixes only the first paste. Expiry — the recurring cost — still multiplies by
  the number of leagues, which is the actual complaint.
- **"Account only, no override."** Simpler, and it silently breaks anyone with
  two ESPN logins. A design that cannot represent a real situation will be
  worked around by adding the same league twice.

## 3. "Should update automatically for draft/free agency decisions" — already true

This one needed verification rather than construction, and it holds:

| mechanism | evidence |
|---|---|
| Every app route is dynamic | `export const dynamic = "force-dynamic"` in `src/app/(app)/layout.tsx` and each route segment |
| ESPN responses are never cached | `cache: "no-store"` on every request in `src/lib/espn/client.ts` |
| The request cache does not persist | `loadEnvelope` is React `cache()`, which dedupes **within one request** and is discarded after it |
| Draft state is recomputed, not stored | `detectEspnDraftState` runs in `toEnvelope.ts` on the rosters fetched for that request |
| A daily sweep exists as well | `/api/cron/lifecycle-check` walks every stored league at 09:30 UTC |

So a draft completing, or a player being dropped, is reflected on the next page
load. There is nothing to poll and no refresh button to press, and adding one
would be inventing an affordance for a problem the architecture does not have.

## What was fixed on the way to this decision

Two defects in how a credential failure is reported, both found while
establishing the above.

**The private league ID was being rendered onto the page.** `fetchWithEnvelope`
built its failure string as `HTTP ${status} from ${url}`, and
`GovernancePanel.tsx` renders `sourceState.failure` verbatim as "Adapter
note: …". For ESPN, that URL carries the league id in its path — so it appeared
on screen and in any screenshot. Thrown fetch errors leaked it too, because
Node's messages quote the request back. Both are redacted to the host now.

**A 401 was reported as a status code.** The single most common ESPN failure is
an expired cookie, which the user can fix in under a minute — if anybody tells
them. It now reads:

> ESPN rejected the stored credentials (HTTP 401). ESPN's espn_s2 and SWID
> cookies expire; paste fresh ones in Settings → Leagues to restore this league.

and, importantly, an anonymous 401 does **not** say that — telling somebody to
re-paste cookies they never entered would send them to a page that cannot help.

## Sources

- [cwendt94/espn-api — ESPN_S2 and SWID Credentials (discussion #150)](https://github.com/cwendt94/espn-api/discussions/150)
- [ffscrapr — ESPN: Private Leagues](https://ffscrapr.ffverse.com/articles/espn_authentication.html)
- [GameDayBot — ESPN_S2 and SWID](https://www.gamedaybot.com/help/espn_s2-and-swid/)
