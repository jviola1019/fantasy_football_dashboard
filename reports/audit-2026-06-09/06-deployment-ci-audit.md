# Deployment & CI Audit — RAE Fantasy Football Dashboard
**Date:** 2026-06-09  
**Branch audited:** `ui/tab-polish` (== origin/main == production HEAD `0a5ac58`)  
**Auditor:** deployment_ci_auditor worker (Sonnet 4.6)  
**Scope:** CI/CD, Vercel config, cron scheduling, observability, secret hygiene, smoke testing

---

## 1. Strengths

1. **Three-job CI pipeline is real and non-trivial.** `quality` (typecheck + lint + vitest), `e2e` (Playwright + axe), and `lighthouse` all run on every push/PR to `main`. This is well above average for a side-project-scale repo.
2. **E2E and Lighthouse run in CI, not just locally.** Both jobs execute `npx next build` then their tooling — not mocked. The `e2e` job even uploads a Playwright HTML report artifact on failure (7-day retention).
3. **Cron routes are all individually gated by `CRON_SECRET` Bearer auth** using timing-safe comparison (`safeEqual`). All 7 routes enforce this; none are open.
4. **`/api/health` endpoint exists** and checks `authSecret`, `credentialEncryptionKey`, `databaseUrl`, and does a live DB read (`users` table), returning structured JSON with `"ok"` / `"degraded"`.
5. **Dual-driver DB (SQLite local / Postgres prod)** is correctly implemented. `better-sqlite3` is loaded lazily via `require()` inside `createSqliteDb`, so Vercel's serverless environment never attempts to load the native module when `DATABASE_URL` starts with `postgres://`. No native binary in the Vercel function bundle.
6. **`vercel.ts` typed config** sets per-function memory and `maxDuration` for all heavy routes; API routes get `no-store` cache headers globally.
7. **CI uses fixed, non-secret placeholder credentials** (`ci-auth-secret-do-not-use-in-prod-...`) — not real production keys.
8. **`concurrency: cancel-in-progress: true`** prevents stale CI runs from blocking the queue.
9. **`lighthouserc.json` asserts hard accessibility floor** (`categories:accessibility: ["error", { minScore: 0.9 }]`) — a11y regressions block CI.

---

## 2. Exact Issues & Root Causes

### S0 — Critical

None identified.

---

### S1 — High Severity

#### FINDING-01: Real production secrets committed in `DEPLOY_TO_VERCEL.md`
- **Severity:** S1  **Confidence:** H
- **File:** `DEPLOY_TO_VERCEL.md` lines 34–36, 52
- **Details:** `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and `DB_INIT_TOKEN` are committed as literal values in a public-repo markdown file. The file has been in the git history since commit `ec2662b` (2026-05-18). The values are present at:
  - Line 34: `AUTH_SECRET = LgWf0D/...`
  - Line 35: `CREDENTIAL_ENCRYPTION_KEY = w5i6GX5Z...`
  - Line 36: `DB_INIT_TOKEN = KiqQvPM...`
  - Line 52: `DB_INIT_TOKEN` repeated in a `curl` example
- The file itself warns "Treat these like secrets — don't paste them into any chat or public document" — yet they are pasted into the file.
- **Root cause:** Documentation was written with literal values instead of `<REPLACE_ME>` placeholders. File is tracked in git (committed in `ec2662b`).
- **Risk:** Anyone with repo read access (or who clones the repo) can impersonate the init-db bootstrap, decrypt league credentials (if `CREDENTIAL_ENCRYPTION_KEY` was ever used in production without rotation), and sign forged Auth.js sessions.
- **Remediation:** Rotate all three secrets immediately in Vercel dashboard. Replace the literal values in the markdown with `<your-generated-value>` placeholders. Consider adding a `gitleaks` / `trufflehog` pre-commit hook and a CI secret-scan step.

---

#### FINDING-02: No smoke test against the live Vercel production (or preview) URL
- **Severity:** S1  **Confidence:** H
- **File:** `.github/workflows/ci.yml` (entire file), `playwright.config.ts` line 4
- **Details:** All three CI jobs build and test against `localhost:3000`. There is no job that exercises `https://fantasy-football-dashboard-seven.vercel.app/` — neither a smoke test nor a post-deploy Playwright run. `PLAYWRIGHT_BASE_URL` is never set to a Vercel URL in any workflow. No `scripts/smoke-vercel.ts` or equivalent exists.
- **Root cause:** CI was designed for local build verification. Post-deploy smoke testing on the live URL is absent.
- **Risk:** A Vercel-specific environment variable misconfiguration, a missing DB migration, or a function-bundle issue could silently break production without any CI signal. The gap between "passes local build" and "works on Vercel" is unverified on every deploy.
- **Remediation:** Add a `smoke` job that triggers on `workflow_run` (after a successful Vercel deploy) or on a `deployment_status` webhook, using `PLAYWRIGHT_BASE_URL: ${{ secrets.VERCEL_PROD_URL }}`. At minimum: `GET /api/health` must return `{"status":"ok"}` and `/` must load without a 500. See proposed outline in §4.

---

#### FINDING-03: No branch protection evidence
- **Severity:** S1  **Confidence:** M (GitHub Settings not visible from repo)
- **Details:** The CI workflow runs on `push` to `main` — meaning it runs *after* the push, not as a required status check before merge. Without branch protection rules requiring `quality`, `e2e`, and `lighthouse` to pass, it is possible to merge a PR with failing gates.
- **Root cause:** Branch protection is a GitHub repository setting, not a file in the repo. Cannot confirm it is set.
- **Risk:** A developer could merge a PR before CI completes or after a failing run. The existing CI jobs provide false assurance if not enforced as merge requirements.
- **Remediation:** Enable branch protection on `main`: require status checks `quality`, `e2e`, `lighthouse` to pass before merge; require PR reviews (at least 1); disable direct push to `main`. Confirm setting is active.

---

### S2 — Medium Severity

#### FINDING-04: Lighthouse job has no `needs:` dependency on `e2e`; all three jobs run in parallel
- **Severity:** S2  **Confidence:** H
- **File:** `.github/workflows/ci.yml` lines 13–69
- **Details:** The `quality`, `e2e`, and `lighthouse` jobs are declared at the top level with no `needs:` relationship. They run fully in parallel. Both `e2e` and `lighthouse` independently install deps and run `npx next build` — doubling build time and compute cost unnecessarily. More importantly, a Lighthouse score can be uploaded to LHCI temporary storage from a failing build that also had Playwright failures — the results are not linked.
- **Remediation:** Add `needs: [quality]` to both `e2e` and `lighthouse`. Consider sharing the build artifact via `actions/upload-artifact` / `actions/download-artifact` to avoid the second `next build`.

#### FINDING-05: `opportunity-refresh` route not covered by `vercel.ts` `functions` config
- **Severity:** S2  **Confidence:** H
- **File:** `vercel.ts` lines 18–43 (functions block), `src/app/api/cron/opportunity-refresh/route.ts`
- **Details:** Six of the seven cron routes have explicit function-level overrides in `vercel.ts` `functions`. `opportunity-refresh` is scheduled (`schedule: "25 9 * * *"`, line 71) but has no corresponding entry in the `functions` block — it will run with Vercel's default memory (1024 MB on Pro, 512 MB on Hobby) and default `maxDuration` (10s on Hobby, 60s on Pro). On the Hobby plan the default `maxDuration` is 10 seconds. If the nflverse snapshot fetch takes longer than 10 seconds (plausible for external HTTP), the function times out silently.
- **Remediation:** Add `"src/app/api/cron/opportunity-refresh/route.ts": { memory: 512, maxDuration: 60 }` to the `functions` block in `vercel.ts`.

#### FINDING-06: No cron failure alerting or monitoring
- **Severity:** S2  **Confidence:** H
- **File:** All `src/app/api/cron/*/route.ts`; no alerting config found anywhere
- **Details:** All 7 cron routes return structured JSON (`ok: true/false`, `stage`, `error`) but there is no downstream consumer of these responses. Vercel Cron does not retry on failure and does not alert. There is no Sentry, no Vercel Analytics, no logging integration, no Uptime monitor, no `/api/cron/status` aggregator, and no alert configured on `/api/health` degraded state.
- **Root cause:** Observability was not in scope for any sprint.
- **Risk:** A cron silently fails (e.g., Sleeper API down, DB connection pool exhausted), stale data accumulates, and the first signal is a confused user. The `lifecycle-check` cron, which depends on fresh upstream snapshots, will produce stale lifecycle notifications with no indication of why.
- **Remediation:** At minimum, add a Vercel Log Drain → Axiom/Logtail/Datadog and create an alert on log lines containing `"ok":false`. Better: add Sentry (free tier) and call `Sentry.captureException` in the cron catch blocks. Add a Vercel Cron monitor URL to Better Uptime or Cronitor.

#### FINDING-07: `lighthouserc.json` uses `temporary-public-storage` — results are ephemeral and public
- **Severity:** S2  **Confidence:** H
- **File:** `lighthouserc.json` line 22
- **Details:** `"target": "temporary-public-storage"` uploads Lighthouse reports to an unauthenticated public Google Cloud Storage bucket. Reports expire (typically 7 days) and are publicly accessible via the URL logged to CI output. This means: (a) anyone can read your lighthouse scores; (b) results are not retained for trend analysis; (c) the link in the CI log becomes a dead link after expiration.
- **Remediation:** Switch to `target: lhci-server` (self-hosted LHCI server or Vercel-hosted), or use `target: filesystem` + the `actions/upload-artifact` step for private retention.

#### FINDING-08: `package.json` has no `engines` field — no Node version contract
- **Severity:** S2  **Confidence:** H
- **File:** `package.json` (entire file)
- **Details:** No `"engines": { "node": ">=20" }` field. CI pins Node 20 (`.github/workflows/ci.yml` lines 22, 38, 56). Vercel uses Node 20 by default for new projects but falls back to earlier versions for older projects. Without an `engines` constraint, a future `node-version: 22` bump in the workflow would not be caught until a runtime failure.
- **Remediation:** Add `"engines": { "node": ">=20.0.0" }` to `package.json`.

---

### S3 — Low Severity

#### FINDING-09: E2E specs 15–17 absent from `reports/playwright.json` (snapshot is stale)
- **Severity:** S3  **Confidence:** H
- **File:** `reports/playwright.json` (root `suites` array has 6 spec files: 01, 02, 03, 04, 05, 07, 14); current `e2e/` directory has 10 spec files: 01, 02, 03, 04, 05, 07, 14, 15, 16, 17
- **Details:** Specs `15-sprint5-panels.spec.ts`, `16-topbar-nav.spec.ts`, and `17-account-flows.spec.ts` were added after the last `playwright.json` regeneration (which was the 2026-05-30 Opus reverification run). The JSON in `reports/` is used as a record-of-truth in audit documents but is 3 spec files behind reality. The count in the CI job history (24 tests) predates these additions; current test count is not reflected.
- **Risk:** Audit documents that cite `reports/playwright.json` undercount the actual E2E coverage. Not a functional risk, but a documentation accuracy risk.
- **Remediation:** Regenerate `reports/playwright.json` after a full E2E run (or after next CI green).

#### FINDING-10: `lighthouserc.json` only checks `/` and `/login` — authenticated routes not covered
- **Severity:** S3  **Confidence:** H
- **File:** `lighthouserc.json` lines 6–7
- **Details:** The Lighthouse CI config only audits `http://localhost:3000/` and `http://localhost:3000/login`. Routes `/dashboard`, `/players`, `/analytics`, `/draft`, `/waivers`, `/trades`, `/settings/*` are not included. Performance regressions and accessibility violations on these routes would not trigger CI.
- **Remediation:** Add the primary app routes to the `url` array. Note: authenticated routes require a cookie; configure a Lighthouse `puppeteerScript` to sign in first, or add unauthenticated versions of the routes as LH targets.

#### FINDING-11: No `NEXTAUTH_URL` in CI environment — may affect auth redirect in E2E
- **Severity:** S3  **Confidence:** M
- **File:** `.github/workflows/ci.yml` `env:` blocks (lines 33–35, 57–59); `.env.example` line 3
- **Details:** The `e2e` CI job sets `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` but not `NEXTAUTH_URL`. Auth.js v5 beta uses `AUTH_URL` or `NEXTAUTH_URL` to construct redirect URLs. The Playwright webServer starts on `localhost:3000` so the default fallback likely works, but this is implicit behavior that could break if the port changes or if Auth.js v5 changes its auto-detection logic.
- **Remediation:** Add `NEXTAUTH_URL: http://localhost:3000` to the `e2e` job `env:` block.

---

## 3. Cron Schedule vs. Route Reconciliation

| Route file | Schedule in `vercel.ts` | In `functions` config | Status |
|---|---|---|---|
| `players-refresh` | `0 8 * * *` (08:00 UTC daily) | Yes (1024 MB, 60s) | OK |
| `rankings-refresh` | `30 8 * * *` (08:30 UTC daily) | Yes (512 MB, 60s) | OK |
| `ktc-refresh` | `0 9 * * *` (09:00 UTC daily) | Yes (512 MB, 60s) | OK |
| `projections-refresh` | `15 9 * * *` (09:15 UTC daily) | Yes (512 MB, 60s) | OK |
| `news-refresh` | `20 9 * * *` (09:20 UTC daily) | Yes (512 MB, 60s) | OK |
| `opportunity-refresh` | `25 9 * * *` (09:25 UTC daily) | **MISSING** | **Gap (FINDING-05)** |
| `lifecycle-check` | `30 9 * * *` (09:30 UTC daily) | Yes (512 MB, 60s) | OK |

**Result:** 7/7 cron routes are scheduled. All 7 route files exist. One route (`opportunity-refresh`) is missing its `functions` config entry, leaving it on default Vercel limits. No orphan schedules (all scheduled paths resolve to existing route files). No unscheduled route files.

---

## 4. Recommended Remediations

### 4.1 Immediate (pre-next-deploy)
1. **Rotate and redact secrets** in `DEPLOY_TO_VERCEL.md` (FINDING-01). Replace literal values with `<generated-value>` placeholders. Rotate in Vercel dashboard.
2. **Add `opportunity-refresh` to `vercel.ts` functions** (FINDING-05, 2-line change).
3. **Add `engines` to `package.json`** (FINDING-08, 1-line change).
4. **Confirm branch protection** on `main` requires all 3 CI jobs (FINDING-03).

### 4.2 Near-term
5. Add a Vercel smoke test job (FINDING-02). Proposed hardened `ci.yml` outline:

```yaml
# Proposed addition — post-deploy smoke job
smoke:
  name: smoke — live prod
  runs-on: ubuntu-latest
  needs: [quality, e2e, lighthouse]  # only after all gates pass
  if: github.ref == 'refs/heads/main'  # only on main merges
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm }
    - run: npm ci --no-audit --no-fund
    - run: npx playwright test --project=chromium e2e/smoke-vercel.spec.ts
      env:
        PLAYWRIGHT_BASE_URL: ${{ secrets.VERCEL_PROD_URL }}
```

Proposed `scripts/smoke-vercel.ts` (minimal):
```typescript
import { test, expect } from "@playwright/test";

test("health endpoint returns ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe("ok");
});

test("homepage loads without 5xx", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(500);
  await expect(page.locator(".governance-banner")).toBeVisible({ timeout: 10_000 });
});

test("login page is reachable", async ({ page }) => {
  const res = await page.goto("/login");
  expect(res?.status()).toBeLessThan(500);
});
```

6. **Add error tracking** (FINDING-06). Minimum: Sentry free tier. Wrap cron catch blocks with `Sentry.captureException`.
7. **Fix `lighthouserc.json` upload target** (FINDING-07). Use `filesystem` + artifact upload.
8. **Expand Lighthouse URLs** to include `/dashboard` (FINDING-10).
9. **Add `needs: [quality]`** to `e2e` and `lighthouse` jobs (FINDING-04).
10. **Regenerate `reports/playwright.json`** after next full E2E run (FINDING-09).

---

## 5. Open Questions (GitHub/Vercel Settings — not visible from repo)

1. **Branch protection on `main`:** Are the three CI status checks (`quality`, `e2e`, `lighthouse`) configured as required checks before merge? Is direct push to `main` blocked?
2. **Vercel plan tier:** Is this a Hobby or Pro plan? On Hobby, cron `maxDuration` defaults to 10s for routes without explicit config — directly affects `opportunity-refresh` (FINDING-05).
3. **`CRON_SECRET` set in Vercel?** The routes return HTTP 503 if `CRON_SECRET` is absent. Has it been set in the Vercel dashboard for Production/Preview environments?
4. **Preview deploy smoke testing:** Does Vercel automatically deploy preview URLs on PR branches? If so, are those previews tested in any way before merge?
5. **Database URL in Preview environments:** Is `DATABASE_URL` set in Vercel Preview environments? The Neon integration sets it for Production and Development but Preview may require manual propagation.
6. **Log drain configured?** Is there a Vercel Log Drain wired to any observability backend?
7. **`DB_INIT_TOKEN` rotated?** Following the secret exposure in `DEPLOY_TO_VERCEL.md`, was the init-db token rotated before or after the first production deploy?
