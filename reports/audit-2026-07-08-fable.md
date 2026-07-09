# RAE Full-System Audit — 2026-07-08 (Fable 5)

**HEAD:** `53d9a50` (= `origin/main`; branch `audit/2026-06-09`, clean tree)
**Method:** independent full-repo audit — six lanes: secrets/leaks, row-by-row security, architecture/infra, quant/backtesting (subagent), UI/UX guardrails (subagent), verification gates. Every claim cited file:line or command output. Prior ledger (`reports/audit-2026-06-11-fable.md`) used only as a checklist of claims to re-verify, never as evidence.

**Gates run this session (Node 25.8.2, npm 11.11.1):**

| Gate | Result |
|---|---|
| `npm run typecheck` | ✓ exit 0 |
| `npm run lint` | ✓ exit 0 |
| `npm run test` (vitest) | ✓ **498 passed / 6 skipped** (58 files passed / 3 skipped) — vs round-4's 500: round-5 deleted 2 dead-model tests (`c6964e6`) |
| `npm run check:secrets` | ✓ 45 tracked files, no secret-shaped literals |
| `npm run build` | ✓ "Compiled successfully in 13.0s", all routes dynamic as designed |
| Client-bundle secret grep (post-build `.next/static/chunks`) | ✓ clean — no server env names, no secret-shaped base64; sole `espn_s2` hit is a form label with `type="password"` input |

---

## A. Executive verdict

The codebase is in genuinely strong shape: every prior-round remediation I re-verified is real, the crypto/auth/authz layer is textbook, the data layer is injection-free and user-scoped, CI is layered and green, and production smoke has passed daily since the merge. The material findings this round are **platform/settings-level, not code-level**: the GitHub repo's guardrails (branch protection, dependency graph) are off, so two of the shipped security gates are silently not protecting anything; the burned secrets remain readable in public git history and gitleaks provably does not detect them; and the app serves no browser security headers. Plus a small tail of hardening and doc-continuity items.

## B. Issue register (this session)

| ID | Sev | Conf | Finding | Evidence | Fix |
|---|---|---|---|---|---|
| A-01 | S2 | Confirmed | Burned secrets (`AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `DB_INIT_TOKEN` values) remain readable in public git history — redaction commit `f363637` cleaned the tip only. **gitleaks does not catch them** (markdown-table format; full-history Security runs on main are green, e.g. run 27440335973). Local `.env` verified rotated (all three leaked values absent). Vercel-side rotation not verifiable from the repo. | `git show <earliest>:DEPLOY_TO_VERCEL.md` lines 34–36; Security workflow runs green | Treat values as burned (they are public forever); **owner confirms Vercel/Neon rotation**; add the three burned literals to `docSecrets.ts` deny-list so they can never be re-introduced; do NOT rewrite history (public repo, forks/caches defeat it) |
| A-02 | S2 | Confirmed | `main` has **no branch protection and no rulesets** — CI/CodeQL/Security are not required checks; direct and force pushes accepted. Previously "unverifiable"; now confirmed via API. | `gh api …/branches/main/protection` → 404 "Branch not protected"; `…/rulesets` → `[]` | Add a ruleset on `main`: require PR, require CI + Security checks, block force pushes/deletions (no required approvals — solo repo) |
| A-03 | S2 | Confirmed | `dependency-review` job **fails on every PR** because the repo's Dependency graph is disabled; vulnerability alerts also disabled. The gate has never protected a PR since it shipped. | run 27440331347: `##[error]Dependency review is not supported on this repository…`; `gh api …/vulnerability-alerts` → 404 disabled | Enable dependency graph + Dependabot alerts (Settings → Security & analysis, or `gh api -X PUT …/vulnerability-alerts`); re-run a PR to see the job green |
| A-04 | S3 | High | **No security headers**: no CSP, no `frame-ancestors`/`X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`. `vercel.ts` headers only set `Cache-Control` on `/api/(.*)`. Authenticated dashboard → clickjacking-viable; CSP is the standing XSS backstop. | `vercel.ts:95-102`; `next.config.mjs` (no headers()) | Add a headers block (all routes): `frame-ancestors 'none'` CSP (or start with `X-Frame-Options: DENY`), `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy` |
| A-05 | S4 | High | Email-enumeration timing oracle: `authenticateUser` returns early when the email doesn't exist (no scrypt), ~50 ms faster than a wrong-password attempt. Registration also discloses existence ("user already exists") — the latter is a standard accepted tradeoff, the former is cheap to fix. | `src/lib/users.ts:37` | Verify against a static dummy hash when the row is missing |
| A-06 | S4 | High | Stale comment: auth config points readers at `src/middleware.ts`; the file is `src/proxy.ts` (Next 16 rename). | `src/lib/auth.config.ts:5`; `src/proxy.ts` exists | One-line comment fix |
| A-07 | S4 | High | Doc-continuity residual from F-07 §I: `AUDIT.md` and `audit_report.md` lack the "historical — superseded by reports/audit-*" banner that `FINAL_AUDIT.md` has. | `head -3` of each | Add one-line banner to both |
| A-08 | S3 | Med | Lighthouse CI asserts only `/` and `/login`; `/dashboard` — the route with the measured perf history (54 → 74 after round-4) — has no assertion, so a hydration/TBT regression there is CI-invisible. | `lighthouserc.json:6` | Add `/dashboard` to `collect.url` with a floor at/below current measured perf |

Quant lane (subagent) and UI/UX lane (subagent) findings: §E and §F below.

## C. Row-by-row security review — verified clean (evidence)

**Secrets & leaks**
- `.env` gitignored (`.gitignore:6`) and never committed (`git log --all -- .env` empty). 215 commits scanned with two pattern sets (KEY=value forms; postgres-URL/cookie/SWID forms) — only the known A-01 doc leak exists in history.
- Local `.env` holds only 4 vars; none match the leaked values (rotation locally done).
- `check-doc-secrets` guard is real and wired in CI before build (`.github/workflows/ci.yml:25`); scanner logic entropy-guarded with allow-list (`src/lib/security/docSecrets.ts`).
- Client bundle post-build: no secret material (see gates table).

**AuthN/AuthZ**
- Credentials flow: zod-validated (`auth.ts:9-12`), scrypt-verified; JWT sessions; `token.id → session.user.id` mapping (`auth.config.ts:19-26`).
- Edge proxy gates `/settings/:path*` (`proxy.ts:14`) as defense-in-depth over page-level `auth()`; app routes intentionally public with labeled demo data for anonymous users (`envelope/load.ts:61`, `196-202`).
- All 7 cron routes: identical `CRON_SECRET` bearer gate with `safeEqual` timing-safe compare, 503 when unset (grep verified across `src/app/api/cron/*/route.ts`).
- `/api/health`: public returns only `status`; `checks`/`databaseError`/`snapshots` require the cron bearer (`health/route.ts:149-160`); errors pass through `redact()`.
- `/api/admin/init-db`: `x-init-token` timing-safe gate, 503 when unset (`init-db/route.ts:14-21`).
- `/api/notifications` GET/DELETE and `/api/leagues/[id]/refresh` POST: session-gated (401), all reads user-scoped.

**IDOR / row-level security**
- Every league query is compound-keyed on `userId` + id: `getLeagueForUser` (`leagues.ts:117-124`), `deleteLeagueForUser` (`:126-132`), `findUserLeagueByExternal` (`:47-67`), `listLeagues` (`:112-115`).
- `getLeagueCredentials` is league-keyed, but all 3 production call sites resolve ownership first: `fetchLive.ts:189→197`, `refresh/route.ts:42-43`, `trade/actions.ts:27→54` (via `listLeagues(userId)`); the isolation invariant is also locked by `leagues.test.ts:154-201`.
- Notifications: list + dismiss compound-keyed (`lifecycle/notifications.ts:50-53`, `:67`).
- Active-league cookie: httpOnly, `sameSite: lax`, secure-in-prod, format-validated, **re-validated against ownership on every read** (`activeLeague.ts:21-29`, `:37-48`).

**Crypto**
- AES-256-GCM, 32-byte key enforced, random 12-byte IV per encryption, authTag stored (`crypto.ts`). No fallback key — throws when unset.
- scrypt pinned `N=16384,r=8,p=1`, versioned `scrypt1$` format, `timingSafeEqual`, min-8 passwords (`passwords.ts`).
- `safeEqual` used for all secret comparisons (`timingSafe.ts`).
- Password required for account deletion + typed DELETE confirmation (`users.ts:84-96`, `settings/account/actions.ts:72-74`); password change verifies current first.

**Injection surfaces**
- SQL: 100% Drizzle query-builder; raw SQL only in constant DDL (`db/index.ts`, `schema-pg.ts` via token-gated init route). `INIT_SQL.split(";")` safe — DDL fragments contain no embedded semicolons (`schema-pg.ts:174,185`).
- XSS: zero `dangerouslySetInnerHTML`/`eval`/`new Function`/`innerHTML` in `src` (grep).
- SSRF: all outbound hosts are constants (Sleeper/ESPN/FantasyPros/KTC/open-meteo/nflverse/fantasycalc/dynastyprocess); every user-influenced URL segment is `encodeURIComponent`-wrapped (`espn/client.ts:29-33`, `sleeper/league.ts`, `sleeper/drafts.ts` — grep verified). Header injection via ESPN cookies blocked by undici header validation; cookies sent only to `lm-api-reads.fantasy.espn.com`.
- Server actions: all four files auth-gated + zod-validated; `addLeague` never surfaces raw DB errors (`settings/leagues/actions.ts:79-85`).

**Error/data disclosure**
- `redact()` scrubs connection strings + `password=` pairs and truncates (`redact.ts:14-19`); used by health + crons.
- Silent-failure posture: snapshot reads degrade to labeled-unavailable but log once via `infraNull` (`envelope/load.ts:110-119`); live-path failure logs before fixture fallback (`load.ts:193`).

## D. Architecture & infrastructure — verified

- **Data flow:** one request-cached `loadEnvelope()` (React `cache()`, `load.ts:242`) feeds all 9 routes; `deriveAppData` + bootstrap bands run server-side (round-4 perf fix confirmed in `envelope/derive.ts:13-48` — `SIM_BASE` seeded, bands deterministic).
- **Dual-driver DB:** SQLite DDL generated from `SNAPSHOT_TABLES` (F-01 fix confirmed, `db/index.ts:62-75`); additive ALTERs swallow only "duplicate column name" (`:155-165`); FK cascades + WAL + foreign_keys pragma.
- **CI:** secrets-guard → typecheck/lint/vitest → e2e+axe → lighthouse (`ci.yml`); CodeQL weekly green (runs 28784166567, 28366728467); gitleaks green (but see A-01 caveat); production smoke green daily through 2026-07-08 (run 28955213738). CI dummy secrets are clearly labeled dummies.
- **Vercel:** `npm ci` install; per-function memory/duration incl. opportunity-refresh; honest Hobby-cron precision preamble; scoped `remotePatterns` with pathnames (F-02/03/04 fixes confirmed at `vercel.ts:8`, `next.config.mjs:10-14`).
- **Known accepted debts still open (carried, measure-first):** F-09 `Db` type force-cast (`db/index.ts:174`); F-11 all-routes `force-dynamic` (revisit ISR for `/`, `/login` after TTFB measurement); `/dashboard` LH perf 74 (improved, still below 90).
- **Stale-ledger corrections:** `gh` CLI is now installed (2.95.0) — prior ledger's "not installed" no longer holds; first CodeQL/gitleaks runs have now been observed green.

## E. Quant/backtest lane (completed inline — the subagent hit the account session limit mid-run)

**Verified clean:**
- `Math.random` in `src/`: zero hits on any data path (sole mention is a comment in `sidebar.tsx:611` explaining why the shadcn default was replaced with a fixed width).
- `rng.ts` mulberry32: correct reference implementation (`>>> 0` seed coercion, imul mixing, /2^32).
- `simulation.ts`: probabilities are genuine bracket-sim frequencies; `pct()` clamps to [0,100]; field anchored to actual starter count; risk scale bounded 0.85–1.15; assumptions array names league shape, projection source, and the calibration anchor.
- `derive.ts`: seeded `SIM_BASE`, server-side bootstrap bands over 20 deterministic seeds, `bootstrapCI` with pinned seed 1019 — reproducible.
- Continuity invariants locked by `envelope/continuity.test.ts` (determinism, cross-panel probability equality, champ⊆top3⊆playoffs, band well-formedness, buckets sum to 100).

**Findings (all fixed this session — see addendum):**

| ID | Sev | Finding |
|---|---|---|
| Q-01 (= UI F-07) | S3 | "Top 3 Finish %" computed two different ways (×3.4 in `simToRow`, ×2.0 in `deriveOutcomeDistribution`) — same label, different numbers between the Scenarios tab and the Multiverse; ±12%/−13% best/worst shaping factors undisclosed. |
| Q-02 (QNT-01) | S3 | Hand-tuned linear weights in `models.ts` (0.18/0.08/0.54/… ) were disclosed nowhere user-visible, violating "if assumptions matter, show them". |
| Q-03 | S4 (open, documented) | `http.ts:82` hardcodes `confidence: 0.9` for every schema-valid fetch — a policy constant surfaced in the src-badge as if measured. Acceptable as a fixed heuristic, but should eventually be per-source or renamed ("schema-valid" vs numeric confidence). Left as-is; recorded here as an accepted debt. |

## F. UI/UX guardrail lane (subagent — independent pass at HEAD)

**Headline:** no fabricated data anywhere (S1 count = 0); the governance architecture (envelope → GovernanceBanner/ModeBanner/DemoBanner on every `(app)` route) is intact; 10 prior fixes re-verified still in force (tabs ARIA + 44px, REPLAY removal, VOR relabels, CSS layer fix, reduced-motion, no hardcoded timestamps, fixture labeling, heatmap conditional caption, AA contrast, chart alt-text on the four shared charts).

**Findings (all fixed this session unless noted):**

| ID | Sev | Finding | Fix |
|---|---|---|---|
| F-01 | S2 | Start/Sit Edge headed a unitless ECR value index as "Projected/Replacement points" (`derivedMetrics.ts:217`, `RosterHealth.tsx:92-113`) | Renamed fields `value`/`bestAlt`; columns now "Value / Best Alternative / Value Gap" with an honest footnote |
| F-02 | S2 | Trade Center rendered FantasyCalc/KTC/DynastyProcess values with zero lineage (route banner describes the envelope, a different upstream) | `TradeValuesPayload.source: SourceMeta` threaded through to `PanelCard source=` — same badge as every other panel |
| F-03 | S3 | Outcome-fan SVG (only place 3 of 5 bucket %s appear) and playoff-triangle SVG (estimate + Wilson bounds) were `aria-hidden` with no text alternative | Both now `role="img"` with computed aria-labels carrying the numbers |
| F-04 | S2 | Roster release was a mouse-only clickable `<li>` (keyboard/AT users could only Reset); `.draft-btn`/`.draft-reset-btn`/`.vub-sort` ~19–21px targets | Release is a real `<button>` with per-player aria-label; 24px min-height everywhere + 44px on coarse pointers (PanelTabs precedent) |
| F-05 | S3 | 8–10px type on trust-critical surfaces: src-badge 9px, small-note 9px, heatmap conditional caption 9px, mini-table 10/8px, gov-panel-failure 10px | All floored at 11px (mini-panel titles 10px, table headers 9px uppercase) |
| F-06 | S3 | PlayerUniverse (the /players hero panel) rendered no per-panel lineage despite having the envelope in hand | `source={envelope?.sourceState}` |
| F-07 | S3 | (= Q-01) | Shared `estimateTopThree()` (×3.0, floored/capped) used by both surfaces + visible Scenarios disclosure of the estimator and ±12%/−13% stress shaping |
| F-08 | S3 | "Market Edge" pill: unexplained magic index (50+edge×1.4, clamp 0–99) | Visible "· 50 = neutral" + full derivation in title tooltip |
| F-09 | S3 | Nested `<main>` landmarks in the signed-in no-league state (NoLeagueCTA inside SidebarInset's main) + 100vh double-scroll | NoLeagueCTA → `<section aria-labelledby>` with `calc(100dvh − 96px)` |
| F-10 | S4 | All app routes shared one generic `<title>` (WCAG 2.4.2) | Root layout title template `%s — RAE` + per-page titles on all 9 app pages + mock-draft |
| F-11 | S4 | UserMenu initials-only accessible name on mobile; identical "Remove" buttons; cryptic "+ A/+ B"; bare "◂" marker | aria-labels on all; "+ Give / + Get"; sr-only "(selected)" |
| F-12 | S4 | "Pos"/"OP"/"FAAB"/"CI bands" abbreviations; `title`-only column semantics in NarrativeEngine (invisible on touch/AT); unnamed focusable `.table-wrap` regions ×10 | All spelled out; aria-labels on stat spans + explicit legend; every table-wrap now `role="region"` with a specific label |

**E2E gap analysis (open — candidate follow-ups, not regressions):** no console-error assertion in any spec; no keyboard-nav coverage (tabs arrow keys, draft actions); axe scan runs unauthenticated only (the F-09 state was never scanned); no per-panel badge render assertion; no reduced-motion test.

## G. Remediation plan (executed this session — see addendum)

Priority order:
1. A-03 enable dependency graph + Dependabot alerts (API) → re-verify job
2. A-02 ruleset on `main` (require CI+Security checks, block force push)
3. A-04 security headers in `vercel.ts` → build + e2e verify
4. A-01 burned-literal deny-list in `docSecrets.ts` (TDD) + owner rotation confirmation request
5. A-05 dummy-hash timing fix (TDD)
6. A-08 lighthouse `/dashboard` assertion
7. A-06/A-07 doc fixes
8. Quant/UI lane findings as they land
9. Full gate battery + xhigh code review on the diff; commit verified increments

**Limitations:** Vercel-side env values unverifiable from repo (rotation must be confirmed by owner); e2e/lighthouse not re-run locally this session (CI covers them; will run for the remediation diff where feasible); GitHub settings changes require owner-scoped token permissions — attempted via `gh`, reported if blocked.

---

## Remediation addendum (same day, 2026-07-08)

Every locally-fixable finding from all four lanes was implemented and verified. TDD where logic changed (both new-logic fixes watched red → green).

| Finding | Fix | File(s) |
|---|---|---|
| A-01 | Burned-secret deny-list: SHA-256 digests of the three leaked values (computed from git history, plaintexts never re-enter the tree) checked on every line, keyword-independent, allow-list-bypassing; 3 tests red→green | `docSecrets.ts`, `docSecrets.test.ts` |
| A-02 | **Blocked by permission system** — ruleset creation on `main` needs explicit owner authorization (see "Owner actions" below); JSON payload prepared | — |
| A-03 | Dependabot vulnerability alerts + dependency graph **enabled via API and verified** (`PUT /vulnerability-alerts` → GET 204) | GitHub settings |
| A-04 | Security headers on all routes: CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy` (full CSP deferred — needs nonce plumbing) | `vercel.ts` |
| A-05 | Timing-equalizer: unknown-email auth now burns one scrypt verify against a constant valid-format hash; spy test red→green | `users.ts`, `users.test.ts` |
| A-06/A-07 | Comment + historical-banner fixes | `auth.config.ts`, `AUDIT.md`, `audit_report.md` |
| A-08 | `/dashboard` added to Lighthouse CI collection | `lighthouserc.json` |
| F-01…F-12, Q-01, Q-02 | As detailed in §E/§F fix columns | 18 component/lib files |

**Gate battery on the remediated tree (Node 25.8.2):** typecheck ✓ · lint ✓ · vitest **502 passed / 6 skipped** (+4 tests vs pre-fix 498) · check:secrets ✓ (45 files) · build ✓. e2e specs were grep-verified to have no coupling to any changed string/selector; the full e2e+axe+lighthouse battery runs in CI on the PR.

**Owner actions still required (cannot be done from this session):**
1. **Confirm secret rotation in Vercel/Neon** (A-01/F-12 carried) — local `.env` is verified rotated; production env is not inspectable from the repo.
2. **Authorize the `main` ruleset** (A-02): require PR + status checks (`typecheck + lint + vitest`, `playwright + axe`, `lighthouse perf + a11y`, `gitleaks secret scan`, `dependency review`, `codeql (javascript-typescript)`), block force-pushes/deletion, 0 required approvals (solo repo). One `gh api -X POST …/rulesets` call or Settings → Rules.
3. **Open the PR** from `audit/2026-06-09` → `main` and watch the dependency-review job go green now that the dependency graph is enabled (its first-ever effective run).
4. Optional follow-ups: e2e gaps (console-error assertion, keyboard-nav coverage, authenticated axe scan), full CSP with nonces, Q-03 per-source confidence.

**Dependabot first-light triage (alerts appeared the moment A-03 enabled them — 14 open: 5 high/6 moderate/3 low).** `npm audit --omit=dev` narrows the production path to two chains, neither an actionable runtime risk:
- `path-to-regexp` ReDoS (high) via `@vercel/config → @vercel/routing-utils` — build/config-time only (typed `vercel.ts`), route patterns are static, and the only offered fix is a breaking downgrade to `@vercel/config@0.0.32`. Wait for upstream bump.
- `postcss` <8.5.10 XSS-in-stringify (moderate) — a copy nested inside `next` itself; build-time; npm's "fix" is next@9.3.3 (nonsense). Resolves when Next bumps its pin.
- Everything else (`ws`, `tmp`, `vite`, `esbuild`, `js-yaml`, `uuid`, `@babel/core`) sits under dev toolchains (vitest/playwright/lhci). Revisit on the next routine dependency refresh; none ship to production.
