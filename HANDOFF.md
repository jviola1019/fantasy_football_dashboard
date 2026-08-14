# HANDOFF — forensic remediation of the 2026-08-06 audit

**Branch** `fix/2026-08-06-forensic-remediation` · **base** `efb124b` (= `origin/main`, verified unmoved)
**Plan** `~/.claude/plans/you-are-the-lead-proud-canyon.md` · **Evidence** `reports/2026-08-06/`

No merge, no deployment, no credential rotation has occurred.

---

## Finding ledger

| ID | Finding | Status |
|---|---|---|
| F-001 | Vulnerable Next.js lockfile | **DONE** — `f11b9d5` |
| F-008 | *(new, not in audit)* CRITICAL next-auth fail-open | **DONE** — `f11b9d5` |
| F-002 | 2025 bye data drives 2026 alerts | **DONE** — `8dc4e05` |
| F-003 | Notification dedup nonfunctional | **DONE** — `9ed7f17` |
| F-011 | *(new)* Latent Postgres timestamp write failure | **DONE** — `9ed7f17` |
| F-004 | Password change does not revoke JWT sessions | **TODO** |
| F-005 | Auth abuse + password hashing | **TODO** |
| F-006 | Dependency scanning not continuous | **TODO** |
| F-007 | CSP hardening | **TODO** |
| F-010 | *(user-added)* League-format propagation + draft/FA correctness | **TODO** |
| F-009 | *(user-added)* Credential leak sweep | **TODO** |
| F-012 | *(user-added)* Per-page efficiency/marketability + news immediacy | **TODO** |

## Corrections to the audit (verified, not assumed)

- Next.js advisories: audit said 5, actual **9** for `>=16.0.0 <16.2.11` (4 HIGH). Missed
  `GHSA-89xv-2m56-2m9x`, `GHSA-p9j2-gv94-2wf4`, `GHSA-6gpp-xcg3-4w24`, `GHSA-68g3-v927-f742`.
- Correct target is **16.3.x**, not the 16.2.11 floor: only 16.3.x pins patched `sharp@^0.35.3`
  and bundles patched `postcss@8.5.23`.
- **`next-auth@5.0.0-beta.31` is CRITICAL-vulnerable** (`GHSA-8fpg-xm3f-6cx3`, auth checks fail
  open). Entirely absent from the audit.
- Audit claimed Dependabot alerts were disabled — **false**; they are enabled (45 alerts on
  `main`). What is actually off: `dependabot_security_updates`, `automated-security-fixes`, and
  there is no `.github/dependabot.yml`.
- The retired 2025 bye table was not merely stale — **WAS was wrong** (listed 14, actually 12),
  and Sleeper-sourced Washington players were silently skipped entirely (table keyed only `WSH`).

## Environment

- Node v25.8.2 local / Node 20 CI · npm 11.11.1
- **PostgreSQL 17.11 installed locally** (winget), service running, isolated `rae_test` database.
  `RAE_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/rae_test`
- Live accounts verified: Sleeper `jviola1019` (`740151420728283136`); ESPN SWID authenticates.
  ESPN leagues: `1117005295` (8-team full PPR), `1546190` (10-team full PPR **keeper**),
  `680288896` (12-team **half-PPR**), `1955461726` (10-team full PPR).
  Sleeper 2026 `1389332513259790336` is **`pre_draft`** — usable for real draft testing.
  No dynasty / superflex / standard league exists in the real accounts → fixtures needed.
- MCP servers (Neon/Supabase/Vercel) **BLOCKED** — OAuth needs an interactive session.
- Vercel CLI not installed.

## Gate baseline vs now

| Gate | Baseline (`efb124b`) | Current |
|---|---|---|
| typecheck | 0 | 0 |
| lint | 0 | 0 |
| vitest | 502 passed / 6 skipped | 561 passed / 19 skipped |
| build | 0 | 0 |
| e2e | 157 passed / 1 skipped | not re-run since Segment 1 |
| `npm audit --omit=dev` | 10 vulns (7 high, 3 critical) | **0** |
| Postgres integration | did not exist | 11 passed (real PG 17.11) |

## Next steps

1. **Segment 4 — F-004/F-005.** Decided: DB sessions **and** a `sessionVersion` stamp (the stamp is
   what kills legacy JWT cookies at cutover). Throttle in a SQL `auth_attempts` table. Also close
   the register enumeration oracle at [errors.ts:24](src/lib/auth/errors.ts#L24), add a password
   `.max()`, and introduce versioned `scrypt2` chosen from benchmark evidence.
   Note: Next 16.3 **deprecates Edge runtime and middleware** — migrating `src/proxy.ts` to the
   Node runtime lets it reach the DB, removing the constraint that forced session checks out of it.
2. Segment 5 — F-006. 3. Segment 6 — F-007. 4. Segment 7 — F-010. 5. Segments 8–11.
6. Re-run the full gate set incl. e2e + lighthouse, then open a **draft** PR.

## Known gaps / honest caveats

- There is **no notification UI anywhere** in the app (no bell, no inbox, no dismissal control).
  The F-002 "honest UI explanation" is therefore surfaced in the cron response and logs only.
- `@vercel/config` still resolves a vulnerable `path-to-regexp`; it is now a devDependency
  (`vercel.ts` uses `import type` only) and needs an expiring exception entry in Segment 5.
- Dev-tree `npm audit` still reports 24 findings (lhci/puppeteer/drizzle-kit chains). Not
  production runtime; needs triage + documented exceptions.

## Requires owner approval (not done)

Production deploy · **ESPN credential rotation (recommended — the cookies were pasted into a chat
transcript)** · enabling Dependabot security updates + branch ruleset · deleting the stale
`audit/2026-06-09` branch · merging the PR.
