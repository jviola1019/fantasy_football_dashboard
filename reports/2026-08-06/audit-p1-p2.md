# Second-pass forensic audit — P1/P2 remediation ledger

**Date:** 2026-08-17
**Repository:** `jviola1019/fantasy_football_dashboard`
**Source branch:** `fix/2026-08-06-forensic-remediation`
**Base / merge-base SHA:** `efb124bd7f5bf867f3fb29040d5cb1d680a6f7b3` (= `origin/main`, verified unmoved)
**Audit-snapshot SHA:** `c15665276043fbc0324cb0389a69689040067a8f`
**Final SHA:** `8eaab49429383c175e540d78a08a70f21dcfa723`
**PR:** #21 — OPEN, **DRAFT**, integration SHA `1f53ae2467c39184a34d56bd156f13994f0db9fd`

**No merge, no production deployment, no credential rotation, no production database mutation, no
history rewrite and no force push occurred.**

---

## 0. Ref reconciliation — the audit's SHA had moved

The brief named `c156652` as the branch head and said the branch was 19 commits ahead. At the time
work began the remote head was `74786aa`, **21 commits ahead** — `c156652` is commit 19 of 21. The two
intervening commits were inspected before any edit:

| SHA | Change |
|---|---|
| `b1674cf` | `avgStarterPtsFor()` — opponent field follows league scoring; documented the model-validation gap |
| `74786aa` | HANDOFF only |

Neither touched a P1/P2 surface, so the ledger below was rebuilt against live source rather than
against the audit prose.

`51c0a201d95d24d43b1051cd1550cc7690387caa` (the brief's "PR integration SHA") does not exist as a
local object — expected, since GitHub generates a synthetic merge commit per PR head. The current
equivalent is `1f53ae24`.

## 1. Capability inventory

| Capability | State | Note |
|---|---|---|
| Repository / local checkout / terminal | **AVAILABLE** | |
| GitHub API + Actions logs (`gh`) | **AVAILABLE** | |
| Playwright / browser | **AVAILABLE** | 206 tests, chromium + mobile-chrome |
| SQLite | **AVAILABLE** | in-memory via `resetDbForTests()` |
| Real PostgreSQL | **AVAILABLE** | 17.11 local service, throwaway `rae_test` DB |
| Gitleaks CLI | **AVAILABLE** | full-history scan, 224 commits |
| Sleeper API | **AVAILABLE** | public, no credentials |
| FantasyCalc / DynastyProcess | **AVAILABLE** | live HTTP verified during this work |
| nflverse / FantasyPros / KTC | **AVAILABLE** | via existing snapshot paths |
| ESPN | **AVAILABLE** (not exercised this round) | credentials remain owner-rotation pending |
| Vercel CLI / production deploy | **BLOCKED** | not installed; deploy requires approval regardless |
| Production database | **BLOCKED** | out of scope, requires approval |
| Secret manager | **BLOCKED** | no access |
| Neon / Supabase / Vercel / Figma MCP | **BLOCKED** | OAuth cannot run non-interactively |
| `npm run check:freshness` | **BLOCKED** | probes the deployed app, needs `CRON_SECRET` |

## 2. Executive verdict

Every P1 and P2 item is **PASS**. All three GitHub workflows are green on the final SHA, including the
two jobs that had been silently skipped for the entire prior audit.

The single most consequential finding is **not** one the audit listed: the broken production build was
masking Playwright, axe and Lighthouse entirely. They did not fail — they were **skipped**, because
the jobs gate on `next build`. A red pipeline that reads as an absence of results is worse than one
that reads as a failure, and any earlier claim resting on those three gates was unsupported. My own
prior "build 0" evidence was environment-dependent and should not have been offered.

## 3. Finding ledger

| Item | Finding | Status | Commit |
|---|---|---|---|
| P1 §2 | Production build: `next.config.mjs` imports `.ts` | **PASS** | `0b3be99` |
| P1 §3 | Dynasty FantasyCalc integration incomplete | **PASS** | `0b3be99` |
| P1 §4 | Trade provenance hardcoded "redraft" | **PASS** | `0b3be99` |
| P1 §5 | Auth throttle not atomic | **PASS** | `6e1a96a` |
| P1 §6 | Lifecycle reconciliation absent | **PASS** | `d6eeeeb` |
| P1 §7 | Gitleaks red on full history | **PASS** | `c068963` |
| P2 §8 | Trade Center ignored the active league | **PASS** | `825ffd0` |
| P2 §9 | Replacement model called "calibrated" without evidence | **PASS** | `35de09a` |
| P2 §10 | SUPERFLEX occupancy assumption untested | **PASS** | `35de09a` |
| P2 §11 | ESPN dynasty heuristic presented as authoritative | **PASS** | `35de09a` |
| §12 | Fantasy-domain clean-room audit | **PARTIAL** — format matrix swept across 48 shapes; ESPN live re-verification not repeated this round |
| §13 | Auth/session clean-room proof | **PASS (prior)** — `96deb1a`, `f2f6e28`; unchanged this round |
| §14 | CSP after build repair | **PASS** — now actually executed: 0 violations, 10 routes × 2 viewports |
| §15 | Modelling and calibration | **PARTIAL** — harnesses run and reported; the shipped simulator remains unvalidated (see §7 below) |
| §16 | Database and migration | **PASS** — SQLite + real PG 17.11, both engines, concurrency proven |
| §17 | Accessibility and responsive | **PASS** — axe green, 206 e2e, Lighthouse executed |
| §20 | Secrets sweep | **PASS** — 4 distinct values adjudicated by hash; none printed |

## 4. Corrections to the audit

Four claims in the brief were materially wrong or understated. Each was verified by execution.

**(a) Gitleaks is not one synthetic fixture.** It is **13 findings, 4 distinct values, 7 commits**.
Eight of the thirteen are a *real* `DB_INIT_TOKEN` leaked 2026-05-18 — redacted at tip in `f363637` and
**already rotated**. Only five are synthetic detector fixtures.

**(b) The suggested history rewrite would not have worked.** Six of the seven leak-bearing commits
(`ec2662bf`, `82d97e85`, `4a8fa026`, `015de0ef`, `6f507108`, `d7874ae7`) are already ancestors of
`origin/main`; only `671989bf` is branch-only. Rewriting this branch would have cost a force push and
left 12 of 13 findings in place. History was treated as immutable; the tip was cleaned instead.

**(c) The throttle race was far worse than described.** The audit's example was "two failures counted
as one". Measured against the old implementation: **ten parallel failures persisted `attempts = 1`,
and three hundred parallel global failures also persisted `attempts = 1`.** Every dimension collapsed
to a single count — the control was near-inert under exactly the parallel load it exists to survive.

**(d) A third valuation bug the audit did not report.** FantasyCalc's `redraftValue` is
**format-independent**. Verified live 2026-08-16 — Jahmyr Gibbs:

| query | `value` | `redraftValue` |
|---|---|---|
| numTeams=8 | 10041 | 10017 |
| numTeams=12 | 10017 | 10017 |
| numTeams=14 | 10009 | 10017 |
| ppr=0 | 10074 | 10017 |
| ppr=0.5 | 10011 | 10017 |
| ppr=1 | 10017 | 10017 |

`buildFantasyCalcUrl` carefully encoded `numTeams`/`numQbs`/`ppr`, and the parser then read the column
that ignores all three. Three of the operator's four ESPN leagues are not 12-team full-PPR and were
all priced as if they were. The scoring effect is decision-relevant: at ppr=0 Gibbs (RB) leads
Ja'Marr Chase (WR) 10074–9527, a 547-point gap that narrows to 320 at full PPR.

Dynasty vs redraft is also an **ordering** bug, not merely scaling: `isDynasty=true` returns #1 Bijan
Robinson (11348); `isDynasty=false` returns #1 Jahmyr Gibbs (10123).

## 5. Evidence — commands and results

All run on Windows 11, Node v25.8.2, npm 11.11.1, unless noted.

| Command | Exit | Result | Status |
|---|---|---|---|
| `npm run typecheck` | 0 | clean | PASS |
| `npm run lint` | 0 | clean | PASS |
| `npm run test` | 0 | **734 passed / 37 skipped** (from 674) | PASS |
| `npm run build` | 0 | 3 consecutive clean builds | PASS |
| `npm run e2e` | 0 | **205 passed / 1 skipped** local | PASS |
| `npm run lighthouse` | 0 | executed in CI (previously skipped) | PASS |
| `npm audit --omit=dev --audit-level=moderate` | 0 | **0 vulnerabilities** | PASS |
| `npm run check:secrets` | 0 | 259 tracked files clean | PASS |
| `npm run check:exceptions` | 0 | 1 exception, none expired | PASS |
| `npm run check:advisories` | 0 | no resolved version below a floor | PASS |
| `gitleaks detect` (224 commits) | 0 | **no leaks found** | PASS |
| `gitleaks` on 456 tracked files | 0 | **no leaks found** | PASS |
| PG throttle concurrency | 0 | 11 passed, real PG 17.11 | PASS |
| PG lifecycle reconciliation | 0 | 7 passed, real PG 17.11 | PASS |
| `npm run calibrate:season` | 0 | playoff Brier 0.0770 / ECE 0.0096 | PASS (see §7) |
| `npm run backtest:sleeper` | 0 | pooled Brier 0.1657 / ECE 0.2583, **n=10** | PASS (see §7) |
| `npm run sensitivity:replacement` | 0 | 48 shapes swept | PASS |
| `npm run check:freshness` | 1 | needs `CRON_SECRET` + live deploy | **BLOCKED** |

### GitHub — all green on `8eaab494`

| Workflow | Conclusion | Jobs |
|---|---|---|
| CI | **success** | typecheck+lint+vitest · playwright+axe · lighthouse |
| Security | **success** | gitleaks · tracked-file secret scan · lockfile advisory · dependency review · OSV |
| CodeQL | **success** | |

For contrast, the same three workflows on the prior head `74786aa`: CI **failure**, Security
**failure**, CodeQL success.

## 6. Regression-catching evidence

Every fix was proved to catch its own bug by reverting and re-running — a green test proves nothing
unless it can go red.

| Fix | Reverted behaviour | Observed |
|---|---|---|
| Node-20 config boundary | restored `.ts` import | `ERR_UNKNOWN_FILE_EXTENSION ".ts"` |
| Throttle atomicity (SQLite) | old read-then-write | `expected 1 to be 2 / 10 / 6 / 8 / 30 / 300` |
| Throttle atomicity (PostgreSQL) | old read-then-write | `expected 1 to be 2 / 10 / 7 / 8 / 30 / 300` |
| Reconciliation "unknown ≠ resolved" | reconcile all families | 4 unknown-guard tests + partial-failure test fail |
| Gitleaks exception scope | new random secret, same dir | `leaks found: 1` — suppression is not blanket |

## 7. Residual risk

1. **The shipped simulator has no out-of-sample validation.** `calibrate:season` measures
   self-consistency; `backtest:sleeper` exercises `runSeasonSimulation`. The chain the dashboard
   actually renders — `ECR → replacement level → trueValue → runNexusSimulation` — is validated by
   neither. Both harnesses returned bit-identical numbers across four runs spanning three model
   changes, which is evidence of non-coverage. **No calibration claim is supportable for the shipped
   simulator.** Design in `docs/model-validation-plan.md`; harness designed, not built.
2. **`backtest:sleeper` n = 10 team-seasons.** ECE 0.2583 at that sample is not a calibration result
   and should stop being cited as one.
3. **`DEPTH_CUSHION` and `superflexQbOccupancy` are assumptions**, now measured but not fitted.
4. **`style-src-attr 'unsafe-inline'`** remains, documented — 77 inline `style={{…}}` attributes; a
   nonce cannot cover attribute-level styles.
5. **CSP is report-only.** Flipping `CSP_REPORT_ONLY` needs production-preview evidence and approval.
6. **ESPN classification is a heuristic.** Now labelled `derived` with a correction path, but a
   mis-inferred dynasty verdict still reprices a league until the owner corrects it.
7. **13 Gitleaks findings remain in immutable history**, 8 of them a real (rotated) credential.
8. **46 Dependabot alerts on `main`.** This branch's production tree is clean (`npm audit --omit=dev`
   = 0); the alerts are against the default branch and dev-tree chains.

## 8. Rollback

| Change | Rollback |
|---|---|
| Whole branch | `git revert 0b3be99..8eaab49`, or simply do not merge PR #21 |
| Build boundary | restore the `csp.ts` import in `next.config.mjs` (re-breaks Node 20) |
| Throttle | `git revert 6e1a96a` — schema unchanged, no migration |
| Reconciliation | `git revert d6eeeeb` — schema unchanged; rows already resolved stay resolved (safe) |
| Gitleaks | delete `.gitleaksignore` (Security goes red again) |
| Provenance | `provenance` is an optional schema field; absent parses fine, no migration needed |

**No schema migration was introduced in this round**, so no DDL rollback is required.

## 9. Requires owner approval — not done

- Merging PR #21 (kept **draft**)
- Production deployment
- Production database mutation
- **ESPN credential rotation** — still recommended; a password change is required, since logout does
  not invalidate an issued `espn_s2`
- Enabling `dependabot_security_updates` / `automated-security-fixes`
- Enabling `secret_scanning_non_provider_patterns`
- Any history rewrite or force push
- Flipping `CSP_REPORT_ONLY` to enforcing
