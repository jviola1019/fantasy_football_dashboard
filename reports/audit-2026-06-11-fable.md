# RAE Audit — 2026-06-11 (Fable 5 verification pass)

**Branch:** `audit/2026-06-09` @ `d854214` (16 commits ahead of the public `origin/main` the external audit reviewed)
**Method:** file-by-file verification of an external (GPT) audit against local HEAD, plus independent sweep. Gates run this session: typecheck ✓ · lint ✓ · vitest **484 passed / 6 skipped** (Node 25.8.2 local). e2e/lighthouse/build evidence: prior full sweep in `reports/audit-2026-06-09/MASTER-AUDIT.md` §17b (e2e 152 ✓, LH `/` 90/100/100/100, build ✓).

---

## A. Repo map

346 tracked files. `src/lib` (137) — adapters (sleeper/espn/fantasypros/ktc/nflverse/weather), stats (`distribution`, `logistic`, `seasonCalibration`), `seasonSim`, `trade/*`, `envelope/{load,derive}`, governance/SourceMeta. `src/components` (60) — shell, 9 route panels, `ui/*` (PanelTabs etc.), SVG charts (no canvas/WebGL anywhere). `src/app` (39) — onboarding `/` + `(app)/{dashboard,players,analytics,draft,waivers,trades,reports,settings}` + 12 API routes (auth, health, 7 crons, refresh, notifications, init-db). `src/db` (7) — dual-driver Drizzle (better-sqlite3 / postgres-js), snapshot store, 3 schema/drift tests. `e2e` 17 specs; `scripts` 6 (secrets guard, smoke, freshness, 3 backtests); `docs` 11 model/calibration docs; `reports/audit-2026-06-09` prior 7-worker audit + phase-1/2 remediation ledger. CI: `ci.yml` (quality → e2e + lighthouse, main-only) + `smoke.yml`.

## B. Executive verdict

The external audit was directionally right but ran against a stale HEAD. Verified outcome: **one real new defect** (the `opportunity_snapshots` SQLite gap — confirmed, with a deeper root cause than stated), **three still-open config debts** (dependency pinning, Vercel install command, image allowlist), **a stack of doc-continuity defects**, and **several claims that are refuted or already fixed on this branch** (one-line file compression: false; six WebGL canvases: false — zero canvas in the tree; "season backtest section empty": false — a real n=10 backtest exists with honest caveats; health-route disclosure, calibration theater, fabricated P10/P90, scrypt params: all fixed in the phase-1/2 remediation). The highest-stakes open item is unchanged from the prior ledger: **`origin/main` still serves the unredacted secrets doc until this branch merges, and rotation is a user action that cannot be verified from the repo.**

## C. Issue register

| ID | Sev | Conf | Finding | Files | Root cause | Fix | Gate |
|---|---|---|---|---|---|---|---|
| F-01 | S1 | High | `opportunity_snapshots` missing from both hand-written SQLite DDL copies; reads silently `null` via `.catch(() => null)`; writes 500 on SQLite. Prod Postgres unaffected (`ensureTable` self-heal). | `src/db/index.ts` (both DDL blocks), `src/lib/envelope/load.ts:111` | Drift guard (`schemaDrift.test.ts`) compares the two DDL copies **to each other**, never to the canonical Drizzle schema; `snapshotStore.test.ts` exercises only `playersSnapshots`. Postgres has the right guard (`schemaPg.test.ts` "INIT_SQL covers every pgTable"); SQLite lacks its mirror. | Generate SQLite snapshot DDL from `SNAPSHOT_TABLES` (single source, as Postgres already does); add SQLite mirror of the M4 guard (every `sqliteTable` in `schema.ts` exists after `applySqliteSchemaIfNeeded`); parameterize store tests over all six `tableKey`s. | New tests fail before fix, pass after; vitest green. |
| F-02 | S1 | High | 16 packages pinned `latest` (incl. `next`, `react`, `react-dom`, `zod`, `typescript`, `eslint`, `vitest`); `next-auth` on beta; Vercel `installCommand: "npm install --no-audit --no-fund"` vs CI `npm ci`. Every deploy may silently re-resolve `latest`. | `package.json`, `vercel.ts:6` | Convenience pinning never revisited. | Pin exact (or caret) versions from the current lockfile; set Vercel install to `npm ci --no-audit --no-fund`; keep `next-auth` beta but pin it consciously; add Dependabot/Renovate for controlled updates. | Lockfile-only resolution; CI + preview deploy green on pinned set. |
| F-03 | S2 | High | `remotePatterns` hostname-only for `sleepercdn.com` / `a.espncdn.com` (implicit `**` path wildcard). | `next.config.mjs:6-9` | Defaults accepted. | Add `pathname` prefixes (e.g. Sleeper `/avatars/**`, `/content/**`; ESPN `/i/headshots/**` — verify against `headshots.ts` actual URLs). | Images still render on all routes (e2e); no broken avatars. |
| F-04 | S2 | High | Cron comments assert minute-level staggering (09:15/09:20/09:25) that Hobby-plan cron (hourly precision, ±59 min) does not guarantee; line 81 acknowledges Hobby, so comments are internally inconsistent. | `vercel.ts:51-83` | Comments written for Pro semantics. | Reword: "intended order; on Hobby, precision is hourly ±59 min — order not guaranteed"; or make crons order-independent (they already are idempotent — say so). | Comment matches plan reality. |
| F-05 | S2 | High | `openToken()` returns unprefixed plaintext unchanged ("migration tolerance") with no migration plan, scan, or deadline. | `src/lib/accountTokens.ts:18-20` | Bridge left open-ended. | Add a one-shot migration (re-seal unprefixed rows on read or via admin route), a count metric in gated `/api/health`, and a removal release for the tolerance branch. | 0 unprefixed rows in prod; tolerance code deleted; tests updated. |
| F-06 | S2 | Med | No CodeQL, dependency review, SBOM, or full-repo secret scan; the wired guard (`check-doc-secrets.ts`) scans only tracked `*.md`/`*.json`/`.env*`. | `.github/workflows/ci.yml`, `src/lib/security/docSecrets.ts:97-101` | Guard built for the specific S0 incident, not general supply chain. | Add `github/codeql-action`, `actions/dependency-review-action`, and gitleaks (or extend scanner to source files); optional SBOM via `anchore/sbom-action`. | New workflows green on a clean run; seeded test secret is caught. |
| F-07 | S2 | High | Doc-continuity defects: README:220 ("axe audits should be added" — they exist and gate CI at README:275); `playwright.config.ts:8` "6 WebGL canvases" (zero exist); `DEPLOY_TO_VERCEL.md:70` "six WebGL panels", :78 "all six tables" (12+), :86 "Blob snapshot planned PR 6" (DB-snapshot crons shipped instead); `schema-pg.ts:157` "all five snapshot tables" (six). | listed | Docs lag two redesigns. | Single sweep commit fixing each line; treat as defects per guardrails. | grep for each stale phrase returns nothing. |
| F-08 | S3 | High | `seasonSim.ts:11` doc comment: "genuinely calibrated playoff / championship probabilities" — overclaims vs the repo's own honest docs (synthetic self-consistency + low-power n=10 real backtest). | `src/lib/seasonSim.ts:3-21` | Comment predates calibration-honesty work. | Reword: "internally calibrated — estimates match the simulator's own season frequencies (docs/season-calibration.md); real-data validation is pilot-scale (docs/season-backtest-2025.md, n=10)." | Comment matches validation matrix (§D). |
| F-09 | S3 | Med | `Db` type exported as `BetterSQLite3Database`; Postgres client force-cast `as unknown as Db` — type system asserts a compatibility the comment merely promises. | `src/db/index.ts:7,184` | Expedient unification. | Either a discriminated union behind a narrow query interface, or keep the cast but add a runtime-compat test (snapshot store ops against both drivers) and document the invariant where the cast happens. Lower priority than F-01. | Compat test green on both drivers. |
| F-10 | S3 | Med | Tab targets: `text-xs` + `py-2.5` ≈ 36–38 px high — meets WCAG 2.2 AA (24 px) but below the 44 px comfort bar on mobile. Requires measurement, not assumed failure. | `src/components/ui/PanelTabs.tsx:91` | Density bias. | Measure rendered height at mobile viewport; if <44 px, bump `py` or `min-h` on touch breakpoints. | Measured ≥44 px on mobile e2e viewport. |
| F-11 | S3 | Low | All 13 pages `force-dynamic`; the blob/ISR strategy named in DEPLOY doc never built. Data now comes from DB snapshots so the original 19 MB build blocker is gone — revisit static/PPR for `/` and `/login` at least. | `src/app/**/page.tsx`, `DEPLOY_TO_VERCEL.md:86` | Workaround outlived its cause. | Measure TTFB first; then trial ISR/`use cache` on the fixture-backed onboarding route. | LH perf ≥ current baseline (90) after change. |
| F-12 | S0* | High | (*Carried from prior ledger, not re-verifiable from repo*) `origin/main` still serves unredacted secrets until this branch merges; rotation is a user action. | `DEPLOY_TO_VERCEL.md`/`AUDIT.md` history on main | — | Merge this branch; confirm rotation done in Vercel/Neon. | Raw fetch of main serves redacted doc; old keys invalid. |

**Refuted claims from the external audit** (do not act on): one-line/compressed file formatting (all named files normally formatted — e.g. `package.json` 67 lines, max width 63); "six WebGL canvases hydrating" as a live performance problem (zero canvas/WebGL in the component tree; Heatmap2D is SVG; exactly two framer-motion components, both reduced-motion-aware); "real-data backtest section empty" (filled, honest); health/`?snapshots=1` disclosure, calibration theater, fabricated P10/P90, scrypt defaults, missing opportunity-refresh function config — all fixed on this branch per `MASTER-AUDIT.md` §17b with commits.

## D. Statistical/model validation matrix

| Feature | Externally validated | Internally checked only | Not validated | Evidence | Next step |
|---|---|---|---|---|---|
| Trade values | Concurrent validity: pooled Spearman ρ=0.648, 95% CI [0.602,0.692], n=784 player-seasons | verdict thresholds | future predictive power | `docs/trade-calibration.md` | Optional: prospective season holdout |
| Season sim | Pilot only: n=10 team-seasons, Brier 0.1657 (<0.20 target), ECE 0.2583 — in-sample strength, honestly labeled | Synthetic self-consistency: coverage 0.875@90%, ECE ≤0.01 | Multi-league out-of-sample | `docs/season-backtest-2025.md`, `docs/season-calibration.md` | Scale backtest across many public completed leagues; pre-season strength inputs |
| Weekly start/sit | Out-of-fold logistic from projected points: Brier 0.2237→0.2108, ECE 0.0940→0.0270 (offline) | Rank→prob mapping is discrimination-only (script says so) | Production weights not fitted from this | `docs/brier-results.md`, `scripts/brier-backtest.ts` | Label UI "ordinal signal" vs "calibrated"; consider shipping the logistic mapping |
| Core metric weights | — | hand-tuned linear weights (known, QNT-01, deferred) | fitting | `models.ts` | Grid-search when real outcome data accumulates |
| UI honesty | — | ReliabilityDiagram shows "Awaiting backtest data" when empty; Outcome heatmap labeled P(outcome\|wins) | — | components + tests | Keep; fix F-08 comment |

## E. UI/UX blueprint (tabs)

Current `PanelTabs`: recessed segmented control, sliding pill (`layoutId` spring), `text-xs` bold uppercase. A11y is genuinely strong (WAI-ARIA tablist, roving tabindex, Home/End, reduced-motion collapse). The "decorative vs instrument" critique is a defensible brand judgment, not a defect. Options:
- **Minimal (recommended first):** keep structure; drop `active:scale-[0.97]`, reduce spring to a ≤150 ms tween or none; raise type to `text-[13px]`, reduce tracking; flatten pill to a static high-contrast fill. ~1 file.
- **Medium:** underline/rail tabs (2 px amber underline, no pill, no layout animation), stronger active text contrast, `min-h-11` touch target. Matches "instrument panel" brief; reuses all ARIA logic.
- **Full:** shared tab primitive across panel tabs + route sidebar with density tokens; only worth it if the design system is being revisited anyway.
Motion policy: framer-motion is already confined to 2 components — keep it that way; any new motion must pass `useReducedMotion`.

## F. Performance blueprint

Measured: LH `/` perf 90 / a11y 100, `/login` 87/100 (prior sweep, lhci filesystem reports). No canvas/WebGL; 2 motion components. **Inferred suspects requiring measurement, not action:** all-routes `force-dynamic` TTFB; envelope build cost per request (request-cached, but cold per request); table-heavy panels on mobile. Plan: (1) `next build` route-size table → bundle outliers; (2) Vercel Speed Insights or one-off WebPageTest for TTFB/INP on `/dashboard`; (3) React Profiler on tab switches. Quick wins if measured slow: ISR for onboarding `/` (F-11), `next/dynamic` for below-fold panels. Do not de-animate preemptively — there are only two animated components.

## G. Security/DevOps blueprint

Solid: AES-256-GCM (no fallback key), scrypt pinned `N=16384,r=8,p=1` + versioned format, timing-safe compares everywhere it matters, bearer-gated crons + health detail, user-scoped queries with isolation e2e, edge auth proxy. Add (priority order): F-12 merge+rotation confirmation → F-06 CodeQL + dependency-review + gitleaks → F-05 token-migration deadline → branch protection on `main` (still unverifiable from repo; CI is push/PR-on-main only, so feature branches ride on Vercel previews alone).

## H. Vercel/deployment blueprint

`npm ci` as installCommand (F-02); pathname-scoped `remotePatterns` (F-03); honest cron comments or plan upgrade (F-04); revisit `force-dynamic` after measurement (F-11); keep typed `vercel.ts` (already current best practice); per-function memory/duration config is already correct including opportunity-refresh.

## I. Docs continuity cleanup

One commit: README:220 rewrite (audits exist, point at `e2e/03-a11y.spec.ts` + CI); `playwright.config.ts:8` comment (timeout rationale = Windows cold start + Next dev compile, not WebGL); `DEPLOY_TO_VERCEL.md` :70 (panels are SVG/RSC), :78 ("all tables in INIT_SQL"), :86 (snapshot crons shipped; Blob superseded); `schema-pg.ts:157` five→six; `vercel.ts` cron comments (F-04). Historical audit docs (`AUDIT.md`, `FINAL_AUDIT.md`, `audit_report.md`) should gain a one-line "historical — superseded by reports/audit-*" header rather than be rewritten.

## J. Roadmap

1. **Immediate:** F-12 (merge + confirm rotation) · F-01 (schema fix + guards) · F-02 (pin deps + `npm ci` on Vercel).
2. **Short-term:** F-03 · F-07 docs sweep · F-08 comment fix · F-04 cron comments.
3. **Structural:** F-06 CI security layers · F-05 token migration · F-09 db typing · branch protection.
4. **Measure-then-act:** F-10 tab target size · F-11 force-dynamic/ISR · tab redesign option (E) · performance plan (F).

## Top 10 fixes (strict order)
1. Merge branch → main + confirm secret rotation (F-12)
2. `opportunity_snapshots` SQLite DDL + canonical-schema drift guard + store tests over all six keys (F-01)
3. Pin all `latest` deps; Vercel `npm ci` (F-02)
4. `remotePatterns` pathname scoping (F-03)
5. Docs continuity sweep (F-07)
6. `seasonSim.ts` "genuinely calibrated" reword (F-08)
7. CodeQL + dependency review + gitleaks in CI (F-06)
8. `openToken` migration with deadline + prod scan (F-05)
9. Branch protection + required checks on main (carried CID-03)
10. Measurement pass (TTFB, tab target px, bundle table) gating any tab redesign / ISR work (F-10/11, E, F)

## Top 10 risks if left as-is
1. Live secrets on public main (until merge+rotation confirmed)
2. Silent `latest` major bumps breaking prod deploys CI never saw
3. SQLite/dev behavior diverging from prod schema again (guard blind spot is generic until fixed)
4. Opportunity data permanently "unavailable" in local/dev/e2e, masking pipeline regressions
5. Perpetual plaintext-token tolerance becoming an incident foot-gun
6. No code/supply-chain scanning on a credential-holding app
7. Stale docs eroding the "trustworthy governance" brand (the product's core claim)
8. "Calibrated" comment drift re-infecting UI copy in future panels
9. Unprotected main accepting unreviewed pushes
10. Hobby cron imprecision violating staggering assumptions if a future job becomes order-dependent

## Minimum ship criteria for "professionally audited"
- Secrets: redacted doc live on main raw URL; rotation confirmed by owner; secret scan green.
- Schema: every Drizzle-declared table exists under both drivers, enforced by tests that fail on omission (both directions).
- Reproducibility: no `latest` specs; `npm ci` everywhere; lockfile authoritative.
- Truth-in-claiming: every probability surface labeled per matrix §D (external / internal / pilot); no "calibrated"/"backtested" string in code or UI that the matrix doesn't support.
- Gates: typecheck, lint, vitest, e2e+axe, lighthouse (a11y=100, perf ≥90 on `/`), smoke vs prod — all green on the merge commit, with CI as a required check.
- Docs: zero stale claims findable by grepping the F-07 list; historical docs labeled historical.

**Limitations:** no live runtime profiling this session (TTFB/INP/FPS/bundle not measured); no GitHub admin access (branch protection unverified); rotation status unverifiable from repo; e2e/lighthouse cite the 06-09/06-10 sweep, not a re-run.

---

## Remediation addendum (same day, 2026-06-11)

All locally-fixable findings were implemented and verified red→green:

| Finding | Fix | Verification |
|---|---|---|
| F-01 | SQLite snapshot DDL generated from `SNAPSHOT_TABLES` (both copies); canonical-schema guard added to `schemaDrift.test.ts`; `snapshotStore.test.ts` round-trips all six tables | Both new tests watched failing on `opportunity_snapshots`, then green; 12/12 db tests |
| F-02 | 16 `latest` specs pinned to locked caret versions; Vercel `installCommand` → `npm ci` | Lockfile diff spec-only (no resolved-version changes); full battery green on pinned set |
| F-03 | `remotePatterns` scoped to `/content/nfl/players/**`, `/images/**` (sleepercdn), `/i/headshots/**` (espncdn) — verified against `headshots.ts`/`normalize.ts`/`fixtures.ts`, the only `next/image` consumers | build + e2e green; headshots render |
| F-04 | Honest cron-precision preamble in `vercel.ts` (Hobby ±59 min; jobs idempotent/order-independent) | comment-only |
| F-05 | `accountTokens.ts` had **zero callers** (OAuth never wired) — deleted outright instead of building migration machinery | grep: no references; suite green |
| F-06 | `codeql.yml` (JS/TS, weekly + push/PR) and `security.yml` (dependency-review on PRs, gitleaks full-history) added | YAML authored; **runs only on GitHub — first runs must be observed**; gitleaks may need `.gitleaksignore` fingerprints for historical redacted-doc commits |
| F-07 | README:220, playwright.config.ts WebGL comment, DEPLOY_TO_VERCEL.md ×3, schema-pg "five"→list-driven wording | grep for stale phrases clean |
| F-08 | `seasonSim.ts` header now says INTERNALLY calibrated + pilot-scale real validation, pointing at both docs | comment matches §D matrix |
| F-10 | Tabs ≥44px on coarse pointers (`pointer-coarse:min-h-11`), 36px dense row kept on desktop; e2e touch-target test added | RED measured, then GREEN: Pixel 5 = 44px |

**Major incidental discovery (root cause of "visually weak" tabs):** the unlayered `button { font: inherit; padding: 0 }` reset in `globals.css` beat Tailwind v4's `@layer utilities` on **every button in the app** — tabs rendered 19.5px tall, 13px regular text, no padding, with the utility classes dead in the DOM. Moved the reset into `@layer base`; utilities restored app-wide. The earlier "~36px" estimate in F-10 was wrong because the audit read the classes, which were not actually applying.

**Measurement-integrity note:** a stale `next start` process from 06-10 was squatting port 3000; Playwright's `reuseExistingServer` made early probes hit old HTML against the rebuilt `.next` (404'd CSS chunks, bogus 21px measurements). Kill port-3000 listeners before any local measurement session.

**Full battery on final code (Node 25.8.2):** check:secrets ✓ (44 files) · typecheck ✓ · lint ✓ · vitest **486 passed / 6 skipped** · build ✓ · e2e **155 passed / 1 skipped** (chromium + mobile-chrome, axe included) · lighthouse `/` **92/100/100/100**, `/login` **85/100/100/100** (all assertions pass). Screenshots: `reports/audit-2026-06-11-screens/` (mobile/tablet/desktop).

**Still open (not locally fixable):** F-12 merge + secret rotation (user action); branch protection on `main` (GitHub admin); observing first CodeQL/gitleaks runs; F-09 db typing (deferred, low risk); F-11 force-dynamic/ISR (measure first).

---

## Round-2 verification addendum (2026-06-11, independent agents + live re-runs)

**Independent re-verification performed:** two review agents on the diff (general code review + silent-failure hunt), production smoke, both statistical harnesses re-run, `/dashboard` Lighthouse, truth-in-claiming sweep.

**Agent findings → fixes (same day):**

1. **Code-reviewer found a real regression in the CSS fix itself (critical):** the explanatory comment contained `px-*/py-*/…` — CSS comments don't nest, the embedded `*/` terminated the comment early, and minifier error-recovery consumed the `@layer base { button … }` block (losing `cursor:pointer`/`background:none`; masked in tests because Tailwind preflight independently resets buttons). **Fixed**; compiled CSS now contains the full reset (verified by grepping the built chunk) and the build emits no CSS warnings. Reviewer cleared everything else: DDL generation (identifier-safe, idempotent, additive index OK), version pins (all ≤ lockfile-resolved, majors match), remotePatterns (covers every `next/image` URL), workflow YAML, dead-code deletion.
2. **Silent-failure hunter: "the diff fixed the table, not the blindfold"** — zero logging existed anywhere in `src/`. Implemented its six minimal fixes (TDD where logic changed, UI behavior unchanged):
   - `infraNull(key)` log-once helper (`src/lib/envelope/infraNull.ts` + tests) on every snapshot/external `.catch(() => null)` in `load.ts`; rankings now degrades like its siblings instead of aborting the live path;
   - the two empty catches in `load.ts` (live-path → fixture; demo enrichment) now log the error;
   - `snapshotStore.getLatest` logs "rows exist but failed payload validation" (tested) — a tightened Zod schema can no longer silently blank panels;
   - `/api/health?snapshots=1` gains contracts for `nflverse-opportunity` ("nfl") and `espn-news` ("espn-nfl") — the table that caused F-01 is now on the operator surface — and freshness `detail` carries a redacted read error so "missing (no such table)" ≠ "missing (cron not yet run)";
   - the ALTER TABLE catch swallows only "duplicate column name", rethrows real errors (tested);
   - the misleading "season key" doc comment on `getLatestOpportunitySnapshot` now documents the fixed `"nfl"` key contract.

**Live re-verification results:**
- Production smoke: **13/13 PASS** (all routes, auth redirects, health).
- Sleeper season backtest re-run from live public data: **reproduces exactly** (Brier 0.1657, ECE 0.2583, identical reliability bins); season-sim calibration harness re-run: regenerated docs **byte-identical** (zero git diff).
- Truth-in-claiming sweep of user-facing strings: clean (honest-absence language only).
- **F-11 measurement (new data):** `/dashboard` Lighthouse perf **54** — TTFB 310 ms, FCP 1.1 s, **LCP 4.9 s, TBT 1,320 ms**, CLS 0.001. The dashboard route is main-thread heavy (hydration/JS, not layout). This is the measured basis for the performance phase: bundle/route-size analysis and below-fold `next/dynamic` splitting on `/dashboard` are the indicated next steps. (`/` 92 and `/login` 85 remain green; lighthouserc asserts only those two.)

**Blocked items requiring the owner:** `gh` CLI is not installed/authenticated, so PR creation, branch-protection setup, and observing the first CodeQL/dependency-review/gitleaks runs (they trigger on PR/push-to-main, not on the feature branch) are user actions: open the PR from `audit/2026-06-09` → `main`, watch the four new checks, merge after confirming secret rotation.

---

## Round-3 — final design + model sprint (2026-06-11)

User-directed sprint addressing the first audit's UI/brand items that were diagnosed but not built, plus new directives. Decisions confirmed with the user: redesign BOTH the in-panel tabs and the left sidebar to blend in (underline/rail); spell out cryptic abbreviations with corrected spacing; skip the domain item; underline/rail tab direction.

**Design — tabs blend into the dashboard (the headline "non-AI" ask):**
- `PanelTabs`: sliding Framer-Motion pill → quiet **underline/rail** (text tabs over a hairline baseline, active = single accent underline). Dropped the `framer-motion` import from the component (less hydration/JS — also helps the `/dashboard` perf finding). Kept the full WAI-ARIA tablist, roving tabindex, keyboard nav, and `pointer-coarse:min-h-11` 44px touch target. Removed the recessed-track/pill CSS.
- `RouteSidebar`: the bright glowing active number chip → low-contrast tint + accent text (instrument-like; selection now reads via the row's own active background, not a glow).

**Abbreviation sweep (spell out for a general audience, fix spacing):**
- The literal "Repl" = the Start/Sit Edge replacement-value column (`RosterHealth.tsx`) → "Replacement"; "Proj" → "Projected"; added a plain-English note ("Edge = projected − replacement-level points…").
- `Pos` → `Position` (Market Intelligence, Draft Intelligence, Reports, Player Universe, Waiver Wire); `Own%` → `Owned %`; `Oppty` → `Opportunity` (radar); `proj pts/week` → `projected points / week`.
- **Model-continuity bug fixed:** Player Universe stat was labeled "Avg Inefficiency (VOR)" but `marketInefficiency()` computes confidence-weighted **mispricing**, not Value Over Replacement — the `(VOR)` label was factually wrong → "Avg Market Mispricing".

**Nexus Simulator — usefulness/honesty:**
- Removed the decorative **REPLAY** button + its `running`/`setTimeout` state (the audit flagged the path-draw as decorative chrome); the outcome-fan chart keeps a one-time entrance draw that honors reduced motion. Controls now read "{N} simulations" (sentence case).
- **Risk Analysis tab** rebuilt: added a plain-language intro, fixed spacing, and replaced the developer instruction shown to end users ("Run scripts/brier-backtest.ts…") with an honest user-facing caption (calibration is measured offline; the panel never fabricates a curve). No chart values hardcoded (CLAUDE.md).

**Account / duplications (TDD):**
- `createLeague` now rejects a duplicate (same user + platform + externalLeagueId + season) — the source of the "hollow duplicate" league; new `findUserLeagueByExternal` helper powers both the guard and a friendly pre-verify message in the add-league action. Tests watched red → green (leagues.test 11/11). Registration already rejects duplicate emails; deletion already cascades (FK) and requires the password — verified, no change needed.

**Model accuracy re-verification (all three backtests reproduce from live/seeded sources):**
- Player Brier (live 2025): QB 0.2368 / RB 0.1969 / WR 0.2036 / TE 0.2059, calibrated ECE ≤ 0.034 — matches `docs/brier-results.md` (regenerated, zero diff).
- Season-sim Sleeper backtest: Brier 0.1657 (reproduced). Season calibration harness: byte-identical docs.

**Round-3 battery:** typecheck ✓ · lint ✓ · vitest **494 passed / 6 skipped** (+4 tests) · build ✓ (no CSS warnings). Screenshots in `reports/audit-2026-06-11-screens/v2-*` (desktop/mobile tabs, Risk Analysis tab, players). e2e + lighthouse: see final commit.

---

## Round-4 — performance + model-continuity sprint (2026-06-11)

User-directed: complete the F-11 performance phase, ensure every model tab shows real/calibrated/continuous data with no synthetic values, reread/update docs, stricter testing.

**Performance — moved the Monte Carlo off the client main thread (the F-11 fix):**
- `deriveAppData` (a 2,500-iteration season Monte Carlo + metrics) was running in a **client** `useMemo` inside `RouteView`, and `NexusSimulator` ran **20 more** simulations (16,000 iterations) on hydration — the TBT source. `RouteView` and `ReportsView` are now **server components**; the seeded sim + the bootstrap confidence bands (`deriveConfidenceBands`, new) run on the server and stream plain serializable data to the `"use client"` panels. `NexusSimulator` only applies the cheap data-state `widen()` on the client.
- **Measured (Lighthouse, local prod build, 4× CPU throttle):**
  - `/analytics`: perf **52 → 68**, TBT **3,650 ms → 500 ms** (−86%)
  - `/dashboard`: perf **58 → 74**, TBT **1,250 ms → 270 ms** (−78%)
  - `/players`: perf 80, TBT 210 ms. CLS ≤ 0.014 everywhere. (Residual LCP ~4.6 s is render/transfer under throttle, not main-thread blocking — the flagged TBT/hydration issue is resolved.)

**Model continuity + no-synthetic audit:**
- Component scan for `Math.random`/mock/fake/synthetic/hardcode: **clean** (all displayed probabilities come from the seeded sim; demo fixtures stay labeled).
- Every panel reads from one shared `deriveAppData(envelope)`. Confirmed `MarketIntelligence`'s `VolatilitySurface` reuses the shared `sim` (a prior fix, not an independent re-sim).
- New `src/lib/envelope/continuity.test.ts` (6 tests, all green) locks the cross-model invariants: (1) `deriveAppData` is deterministic — sim + bands reproduce exactly; (2) the Nexus **Scenarios "Baseline"** column equals the Multiverse headline + Reports outlook (`round1(clamp(sim.prob))`); (3) best ≥ baseline ≥ worst with champ⊆top3⊆playoffs; (4) confidence bands are well-formed CIs in `[0,100]`; (5) Multiverse buckets are ≥0 and sum to 100; (6) a player's `trueValue` is identical across pools.

**Docs:** `data-source-map.md` (server-side band attribution + honesty rule), `README.md` (server-component rendering pipeline + continuity guard) updated.

**Round-4 battery:** typecheck ✓ · lint ✓ · vitest **500 passed / 6 skipped** (+6 continuity tests) · build ✓. e2e + lighthouse re-run for the final commit.
