# 05 — Auth / Account-Scope / Security Audit

> Authored by the orchestrator after the `auth_security_auditor` worker stalled (stream
> watchdog, 600 s no-progress) before writing its file. The worker did confirm, before
> dying, that "all server actions consistently check `session?.user?.id` and scope DB
> operations by `userId`." All findings below are independently verified against code at
> `audit/2026-06-09` (== `origin/main`).

## Headline

The **cryptographic and account-isolation engineering is correct and above the bar for a
personal project**. The single security failure is **operational secret hygiene**, not
design: three real production secrets are committed in a public repo (see S0 below). Once
those are rotated, the auth surface is in good shape, with a short list of defense-in-depth
gaps.

## Severity legend
S0 critical · S1 high · S2 medium · S3 low · confidence H/M/L

---

## Strengths (verified)

- **Credential encryption is textbook.** `src/lib/crypto.ts` uses `aes-256-gcm`
  (authenticated), a fresh 12-byte random IV per message, stores the auth tag, requires a
  32-byte key decoded from `CREDENTIAL_ENCRYPTION_KEY`, and **throws if the key is missing
  or wrong length — no hardcoded fallback key** (`crypto.ts:13-23`).
- **Password storage is sound.** `src/lib/passwords.ts` uses `scrypt` (KEY_LEN 64) with a
  per-password 16-byte random salt, a versioned format (`scrypt1$salt$hash`), constant-time
  comparison via `timingSafeEqual`, and an 8-char minimum (`passwords.ts:10-36`). No
  plaintext path; `verifyPassword` fails closed on malformed input.
- **Account isolation holds.** Every league read is scoped by the session user id —
  `select … where eq(leagues.userId, userId)` and, for single-league reads,
  `and(eq(leagues.userId, userId), eq(leagues.id, leagueId))`
  (`src/lib/leagues.ts:73,81,89`). A user cannot read another user's league by guessing an
  id. Regression-guarded by `e2e/07-no-shared-data.spec.ts`. **(H)**
- **`/api/admin/init-db` is token-gated and safe.** Compares `x-init-token` to
  `DB_INIT_TOKEN` with a timing-safe `safeEqual`, returns 503 if the token is unset, and
  runs only idempotent `CREATE TABLE IF NOT EXISTS` DDL — it **cannot drop or mutate
  existing data** (`src/app/api/admin/init-db/route.ts:13-47`). **(H)**
- **Cron routes are authenticated.** All 7 `src/app/api/cron/*` routes require `CRON_SECRET`
  with a timing-safe comparison (independently confirmed by the data-pipeline worker;
  `03-data-pipeline-audit.md`). **(H)**
- **Session config is correct for the Credentials provider** — JWT strategy, id propagated
  via `jwt`/`session` callbacks, `trustHost: true` for self-host/Vercel (`auth.ts:13-61`).

---

## Issues + root causes

### S0 · H — Real production secrets committed in a PUBLIC repo
`DEPLOY_TO_VERCEL.md:34-36,52` contains literal, real values for:
- `AUTH_SECRET` (`LgWf0D/pj…`) — NextAuth JWT signing key → **session forgery / full auth bypass**.
- `CREDENTIAL_ENCRYPTION_KEY` (`w5i6GX5ZAk…`) — at-rest key for ESPN creds → **decrypt any stored credential**.
- `DB_INIT_TOKEN` (`KiqQvPMfgc…`) — guards `/api/admin/init-db`.

Evidence of active exposure:
- Repo is public: GitHub API `"private": false`, `"visibility": "public"`.
- Raw file fetchable anonymously: `raw.githubusercontent.com/.../main/DEPLOY_TO_VERCEL.md` → **HTTP 200**.
- Introduced in commit `ec2662b`; present at HEAD; in history regardless of file deletion.
- Bitter irony: line 39 reads "Treat these like secrets … Don't paste them into any public document," directly above the pasted secrets.

**Root cause:** human-facing deploy/audit runbooks were written with real generated keys
inline instead of placeholders, and committed.

> **Correction (2026-06-09):** an earlier draft said the blast radius was "bounded to
> these three keys." The `check-doc-secrets` guard built during remediation found a
> **second leak site**, `AUDIT.md:83-86`, exposing additional secrets: a `CRON_SECRET`,
> a **second, different** `DB_INIT_TOKEN` value, the old Neon `DATABASE_URL` password
> (per its note already rotated), and a plaintext **test-account password**. Both files
> are now redacted (commit `f363637`). No committed
> live DB connection string and no real ESPN cookies were found (the `espn_s2`/`SWID` hits
> are code refs + fake test fixtures; only `.env.example` is tracked). **Full rotation list
> below.**

**Remediation (rotation is the only real fix — deletion does not un-leak):**
1. Rotate **all of these** in Vercel (Prod/Preview/Dev), then redeploy:
   - `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `DB_INIT_TOKEN`, `CRON_SECRET`: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
   - Change the leaked **test-account password** from the app's account settings.
   - The leaked **Neon `DATABASE_URL` password** is per `AUDIT.md`'s note already rotated — confirm it.
   - Side effects: new `AUTH_SECRET` invalidates sessions (re-login); new `CREDENTIAL_ENCRYPTION_KEY` requires clearing `leagueCredentials` → affected users re-add ESPN leagues.
2. ✅ Done (commit `f363637`): redacted literals in `DEPLOY_TO_VERCEL.md` **and** `AUDIT.md`.
3. ✅ Done: `scripts/check-doc-secrets.ts` (+ tested `src/lib/security/docSecrets.ts`) wired into CI to fail on any secret-shaped literal in tracked `*.md`/`*.json`/`*.env*`.
4. Optional hygiene: `git filter-repo`/BFG to purge the values from history + force-push (belt-and-suspenders; the values are already public/indexed, so treat them as permanently burned).

### S3 · M — No `src/middleware.ts`; route protection is page-level
Protection works at runtime (`/settings/leagues`, `/settings/account` → 307 `/login`), but it
is enforced per page/handler rather than centrally. A future protected route or API handler
that forgets its `auth()` check would silently become public. **Recommend** a `middleware.ts`
matcher covering `/settings/:path*` and the mutating API routes as defense-in-depth, keeping
the page-level checks too.

### S3 · L — `/api/health` discloses configuration presence
Public `GET /api/health` returns `{authSecret, credentialEncryptionKey, databaseUrl,
database}` booleans. No values leak, but it confirms to an anonymous caller which secrets are
configured and that the DB is reachable. Low risk; consider gating the detailed `checks`
behind an auth/secret and returning only `{status}` publicly.

### S3 · L — `scrypt` uses Node default cost parameters
`passwords.ts` calls `scrypt(password, salt, 64)` with default cost (`N=16384`). Acceptable,
but undocumented and not tuned. Consider pinning explicit `{N, r, p}` (and bumping N) and
recording it in the version tag (e.g. `scrypt2`) so future hardening is migration-safe.

### S3 · L — `init-db` returns raw error detail to caller
`route.ts:42-44` returns `err.message` to the client. The route is token-gated (the comment
acknowledges this), so it's acceptable, but post-rotation keep the token strong since the
error path is more verbose than a typical public endpoint.

---

## Open questions / unknowns (could not verify from code)
- **Whether the leaked secrets have already been abused** — needs Vercel/Neon access logs.
- **GitHub branch protection / required checks** — not visible without repo admin API.
- **Whether prod `leagueCredentials` currently holds real ESPN cookies** — determines the
  human impact of rotating `CREDENTIAL_ENCRYPTION_KEY` (likely ~0 for a personal app).
- **Exact route-protection mechanism** (layout `auth()` vs per-page) — confirmed working via
  HTTP 307 but not traced to a single chokepoint; the absence of `middleware.ts` is the point.
