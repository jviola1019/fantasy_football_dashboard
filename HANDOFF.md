# HANDOFF — forensic remediation of the 2026-08-06 audit

**Branch** `fix/2026-08-06-forensic-remediation` · **base** `efb124b` (= `origin/main`, verified unmoved)
**Plan** `~/.claude/plans/you-are-the-lead-proud-canyon.md` · **Evidence** `reports/2026-08-06/`

**No merge, no deployment, no credential rotation, no history rewrite, no force push, and no
production database mutation has occurred.**

---

## Second-pass audit (2026-08-17) — P1/P2 round

A follow-up audit against branch head `c156652` raised six P1 and four P2 items. All are now closed;
see [reports/2026-08-06/audit-p1-p2.md](reports/2026-08-06/audit-p1-p2.md) for the full ledger.

| Item | Finding | Status | Commit |
|---|---|---|---|
| P1 §2 | Production build broken — `next.config.mjs` imports a `.ts` file | **PASS** | `0b3be99` |
| P1 §3 | Dynasty leagues still parsed through the redraft branch | **PASS** | `0b3be99` |
| P1 §4 | Trade provenance hardcoded "redraft" | **PASS** | `0b3be99` |
| P1 §5 | Auth throttle not atomic (lost updates) | **PASS** | `6e1a96a` |
| P1 §6 | No lifecycle reconciliation | **PASS** | `d6eeeeb` |
| P1 §7 | Gitleaks red on full history | **PASS** | `c068963` |
| P2 §8 | Trade Center used `leagues[0]`, not the selected league | **PASS** | `825ffd0` |
| P2 §9 | `DEPTH_CUSHION` described as "calibrated" without evidence | **PASS** | `35de09a` |
| P2 §10 | SUPERFLEX occupancy assumption untested | **PASS** | `35de09a` |
| P2 §11 | ESPN dynasty heuristic presented as authoritative | **PASS** | `35de09a` |

### Why the build failure mattered more than it looked

`next.config.mjs` imported `./src/lib/security/csp.ts`. Node ≥ 22.18 strips TypeScript types natively,
so on the dev machine (v25.8.2) `npm run build` passed — and **that passing build was reported as
release evidence in earlier handoffs. It should not have been.** CI runs Node 20.20.2, which cannot,
and failed with `ERR_UNKNOWN_FILE_EXTENSION ".ts"`. Because the Playwright and Lighthouse jobs gate on
the build, **Playwright, axe and Lighthouse were all SKIPPED** — a red pipeline that read as an absence
of results rather than a failure. Any claim resting on those three gates before `0b3be99` is unsupported.

Guarded by `securityHeaders.node20.test.ts`, which loads the config in a child Node process with
`--no-experimental-strip-types`, reproducing Node 20's loader on any host.

### Corrections to the second-pass audit

- **Gitleaks**: the audit described one synthetic `AUTH_SECRET` fixture on this branch. It is **13
  findings / 4 distinct values / 7 commits**, and the majority are a *real* (already-rotated)
  `DB_INIT_TOKEN`. Critically, **6 of the 7 commits are already ancestors of `origin/main`**, so the
  audit's suggested branch-history rewrite would have left 12 of 13 findings untouched. History was
  treated as immutable and the tip cleaned instead.
- **A third valuation bug, unreported by the audit**: FantasyCalc's `redraftValue` is
  *format-independent* — Jahmyr Gibbs returns 10017 at 8/12/14 teams and at ppr 0/0.5/1, identical
  every time — while `value` tracks the query. Reading `redraftValue` discarded every format
  adjustment `buildFantasyCalcUrl` had just requested, pricing all three of the operator's non-12-team
  ESPN leagues as 12-team full-PPR.
- **The throttle race was far worse than "two failures counted as one"**: measured, ten parallel
  failures persisted `attempts = 1`, and three hundred parallel global failures also persisted 1.
  Every dimension collapsed to a single count.

### Assumptions now labelled, not claimed

`DEPTH_CUSHION = 1.2` and `superflexQbOccupancy = 1.0` are **model assumptions, not calibrated
values** — no observed-outcome target exists for either and none was manufactured. Their influence is
measured across 48 league shapes in
[reports/2026-08-06/replacement-sensitivity.md](reports/2026-08-06/replacement-sensitivity.md):
worst-case cross-position inversion 4.2% (cushion) and 1.7% (occupancy), with at most one player of
top-24 churn. Reproduce with `npm run sensitivity:replacement`.

---

**All 12 original audit findings are addressed.** Two user-added items (F-010, F-012) remain PARTIAL
with their remainders named below; everything from the original audit is closed.

---

## Finding ledger

| ID | Finding | Status | Commit |
|---|---|---|---|
| F-001 | Vulnerable Next.js lockfile | **PASS** | `f11b9d5` |
| F-008 | *(new — missed by the audit)* CRITICAL next-auth fail-open | **PASS** | `f11b9d5` |
| F-002 | 2025 bye data drives 2026 alerts | **PASS** | `8dc4e05` |
| F-003 | Notification dedup nonfunctional | **PASS** | `9ed7f17` |
| F-011 | *(new)* Latent Postgres timestamp write failure | **PASS** | `9ed7f17` |
| F-005 | Auth abuse + password hashing | **PASS** — scrypt2 + bounds (`21ec0f3`), durable throttle + enumeration (`ba64260`) |
| F-006 | Dependency scanning not continuous | **PASS** | `186c596` |
| F-009 | *(user-added)* Credential leak sweep | **PASS** — `671989b` |
| F-010 | *(user-added)* League-format propagation | **PASS** — draft targets + lineup mesh (`671989b`), ESPN slot 7/23 fix + league type/keepers (`91a03e7`), keeper model (`bc09796`), settings confirmation UI (`ae9f072`), dynasty values (`ef56abf`), replacement level (`c156652`), sim anchor (`b1674cf`) |
| F-012 | *(user-added)* UI/UX, design and news review | **PARTIAL** — review + a11y fixes done (`ec07bce`); landing-page grid, dashboard dead space, news age visibility recorded OPEN |
| F-004 | Password change does not revoke JWT sessions | **PASS** — `96deb1a` (see constraint below) |
| F-007 | CSP hardening | **PASS** — `18ad3a9`; report-only pending production-preview evidence |

## Corrections to the audit (verified by execution, not assumed)

- Next.js advisories: audit said 5; the GitHub Advisory Database returns **9** for `>=16.0.0 <16.2.11`
  (4 HIGH). Missed: `GHSA-89xv-2m56-2m9x`, `GHSA-p9j2-gv94-2wf4`, `GHSA-6gpp-xcg3-4w24`, `GHSA-68g3-v927-f742`.
- Correct target is **16.3.x**, not the 16.2.11 floor the audit named: only 16.3.x pins patched
  `sharp@^0.35.3` and bundles patched `postcss@8.5.23`. 16.2.12 ships the vulnerable versions of both.
- **`next-auth@5.0.0-beta.31` is CRITICAL-vulnerable** (`GHSA-8fpg-xm3f-6cx3` — auth checks fail open).
  Entirely absent from the audit, and directly on the F-004/F-005 code paths.
- Audit claimed Dependabot alerts were disabled — **false**; they are enabled (45 alerts on `main`).
  Actually off: `dependabot_security_updates`, `automated-security-fixes`, and no `dependabot.yml`.
- The retired 2025 bye table was not merely stale: **WAS was wrong** (listed 14, actually 12), and
  Sleeper-sourced Washington players were silently skipped entirely (the table keyed only `WSH`).

## Gate evidence — baseline vs now

| Gate | Baseline (`efb124b`) | Now | Status |
|---|---|---|---|
| typecheck | 0 | 0 | PASS |
| lint | 0 | 0 | PASS |
| vitest | 502 passed / 6 skipped | **636 passed / 19 skipped** | PASS — stable over 2 consecutive runs |
| CSP violations (10 routes x 2 viewports) | policy did not exist | **0 violations, 34/34** | PASS — enforcement is one constant away |
| build | 0 | 0 | PASS |
| e2e (Playwright + axe) | 157 passed / 1 skipped | **205 passed / 1 skipped** | PASS — +14 target-size, +34 CSP/headers |
| axe a11y | — | 12/12 routes clean | PASS |
| `npm audit --omit=dev` | 10 vulns (7 high, 3 critical) | **0** | PASS |
| Postgres integration | did not exist | 11 passed on real PG 17.11 | PASS |
| `check:secrets` | 49 files | **255 files**, clean | PASS — scope widened to src/scripts/.github |
| `check:advisories` / `check:exceptions` | did not exist | pass | PASS |
| `calibrate:season` | — | playoff Brier 0.0770 / ECE 0.0096; champ Brier 0.0855 | PASS (targets 0.2 / 0.1) |
| `backtest:sleeper` | — | 10 team-seasons, Brier 0.1657, ECE 0.2583 | PASS (ran); n=10, ECE high — pre-existing |
| `lighthouse` | not run | **BLOCKED** | Windows chrome-launcher EPERM + BFCache gatherer errors; 0 assertion output. Environmental, not app. CI runs it on ubuntu. |
| `check:freshness` | — | **BLOCKED** | Requires `CRON_SECRET`, deliberately not handled locally |

## Environment

- Node v25.8.2 local / Node 20 CI · npm 11.11.1
- **PostgreSQL 17.11 installed locally** (winget), service running, isolated `rae_test` database:
  `RAE_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/rae_test`
- MCP servers (Neon/Supabase/Vercel/Figma) **BLOCKED** — OAuth needs an interactive session.
- Vercel CLI not installed.

### Live account matrix (verified)

Sleeper `jviola1019` = `740151420728283136`. ESPN SWID authenticates (`anon:false`).

| Platform | League | Teams | Reception pts | Type |
|---|---|---|---|---|
| Sleeper | `1389332513259790336` Creamy Les Coot 4.0 (2026) | 10 | 1.0 | redraft, **`pre_draft`** |
| Sleeper | `1265735061127311360`, `1257101996586975233` (2025) | 10 | 1.0 | redraft, complete |
| ESPN | `1117005295` My 2024 League | 8 | 1.0 | redraft |
| ESPN | `1546190` Scumbags | 10 | 1.0 | **keeper (1)** |
| ESPN | `680288896` The Roberta Rat Pack | 12 | **0.5 half-PPR** | redraft |
| ESPN | `1955461726` Vols | 10 | 1.0 | redraft |

**No dynasty, superflex, best-ball, or standard (0 PPR) league exists in the real accounts** — those
formats need fixtures, and any claim of coverage for them must say so.

---

## Open work (as of `b1674cf`)

### A. Model validation harness — DESIGNED, NOT BUILT
See [docs/model-validation-plan.md](docs/model-validation-plan.md). The finding that drives it:
both existing harnesses returned **bit-identical** numbers across four runs spanning two model
changes, because neither touches the shipped path. `calibrate:season` is synthetic;
`backtest:sleeper` uses `runSeasonSimulation` fed real weekly scores. The dashboard uses
`runNexusSimulation` (trueValue -> points), which has **no out-of-sample validation at all**.

Feasibility CONFIRMED — Sleeper exposes what is needed, leak-free:
`GET /v1/league/{id}/drafts` -> `GET /v1/draft/{draft_id}/picks` returns 150 picks for the 2025
league, 10 rosters x 15, each with `pick_no` (overall draft position = pre-season market
consensus), `roster_id`, `player_id`, `is_keeper` and position metadata.

Design: reconstruct week-1 rosters from those picks; derive the value signal from `pick_no`
(pre-season ADP is the leak-free stand-in for a historical ECR snapshot, which is NOT retrievable
— rankings snapshots prune after 7 days); run the real `runNexusSimulation` with each league's
actual `LeagueFormat`; score `playoffProbability` against actual qualification with the existing
`scoreForecasts`. Report **n** beside every metric.

### B. Demo-league settings toggles — NOT BUILT
Schema now supports everything needed (`leagueType`, `keeperCount`, `keeperCostRule`,
`draftSlot`); this is a UI surface over the demo envelope.

### C. Original next-steps list (mostly superseded)

### DONE, with one design constraint worth knowing (F-004)

**Database sessions are not reachable in this app**, and this was verified in the installed source
rather than assumed. `@auth/core/lib/utils/assert.js:114-119` returns `UnsupportedStrategy` when
`strategy: "database"` is combined with a provider set that is *only* Credentials — which is exactly
RAE. Auth.js refuses to boot. Reaching DB sessions would require adding a non-credentials provider or
overriding `jwt.encode`/`decode` to store opaque tokens.

What shipped instead delivers the same security property: `users.sessionVersion` stamped into every
token and re-checked against the DB by `requireUser()` on every protected read, bumped in the *same
UPDATE* as the password hash. **There are now zero raw `auth()` session reads in `src/app`.**
Pre-feature tokens carry no version claim and are rejected, so everyone signs in once more.

### 1. F-007 follow-up — flip enforcement

The policy ships **report-only** and the sweep is clean (34/34, zero violations). Flipping
`CSP_REPORT_ONLY` to `false` in [src/lib/security/csp.ts](src/lib/security/csp.ts) enforces it. The
audit also asks for production-preview evidence before enforcing, which needs a deploy that has not
been approved — so that is the remaining gate, not more code.

### (historical) F-007 background
Headers live **only** in [vercel.ts](vercel.ts), so `next start`, Playwright and Lighthouse never see
them and no gate can observe them. Move them into the app, add a per-request nonce via the proxy.
Scoping is favourable: **zero client-side external fetches** (`connect-src 'self'` suffices), fonts
self-hosted via `next/font/google`, no `dangerouslySetInnerHTML`/`eval`/`next/script`. The one real
blocker is **77 `style={{…}}` attributes** across ~12 files → keep `style-src-attr 'unsafe-inline'`
as a documented residual rather than a 77-file rewrite. Report-only first, then enforce.

### 4. F-010 remainder — trade values, VOR, simulation anchor
The DRAFT half is done (`671989b`): targets now derive from `format.starters`, superflex raises the
QB target 1 -> 4, and `lineupMeshScore()` grades roster fit with an explicit hoarding penalty.
These three remain, and they are the deeper ones because they contaminate `trueValue`:
- **Dynasty is hardcoded off in all three value sources.** `KTC_VARIANT = "redraft"` is a module
  constant ([values.ts:10](src/lib/trade/values.ts#L10)), `isDynasty=false` is a string literal in the
  FantasyCalc URL (`:54`), and `:71` prefers `redraftValue`. The dynasty KTC snapshot is scraped daily
  by the cron, stored, pruned — and **never read**. `LeagueFormat` has no `leagueType` field at all,
  so this cannot be fixed without adding one and reading Sleeper `settings.type` / ESPN `draftSettings`.
- **Replacement level is a hardcoded 12-team/1QB table** ([enrich.ts:31-38](src/lib/fantasypros/enrich.ts#L31-L38)).
  It takes `scoring` but not `numTeams`/`numQbs`/`starters`, and it contaminates `trueValue` — the
  input to the sim, draft board, trade grades and every panel. A second, inconsistent table exists at
  [backtest.ts:8](src/lib/trade/backtest.ts#L8).
- **Sim scoring anchor is PPR-only**: the opponent field is `AVG_STARTER_PTS = 11.5`
  ([simulation.ts:57](src/lib/simulation.ts#L57), `:115`) while the user's team is scored in the
  league's actual format — biasing every non-PPR league's championship odds. Also `:94` picks starters
  with **no positional constraints** (a roster of 9 WRs fields a legal lineup).
- **Draft recommender is format-blind**: `DEFAULT_TARGETS` is hardcoded and the only caller never
  passes the override ([recommend.ts:23-39](src/lib/draft/recommend.ts#L23-L39),
  [DraftIntelligence.tsx:31](src/components/panels/DraftIntelligence.tsx#L31)) — superflex gets `QB:1`,
  no-K leagues are still told to draft a kicker. This is the root of the user's "picking multiple
  RBs/WRs" concern and of the requested lineup-meshing score.
- ~~**Trade actions read the wrong league**~~ — **FIXED** in `825ffd0`. `resolveActiveLeague()` is now
  the single selection contract, and Trade Center names the league, its shape, and why it was chosen.
- `leagues.settings` is written once at add-time and never updated.

### 5. F-012 remainder + docs/hygiene
Done (`ec07bce`): WCAG 2.2 target-size fixes + e2e guard, full measured UI/UX review in
[reports/2026-08-06/ui-ux-design-review.md](reports/2026-08-06/ui-ux-design-review.md), news audit.
Recorded OPEN there, deliberately not changed unilaterally:
- **Landing page 6-card 3x2 grid** is the exact "Claude-generated card grid" CLAUDE.md forbids, and
  the page shows no product visual. Recommendation written; it is a marketing redesign, not a defect.
- **/dashboard dead space**: LEAGUE HEALTH 140px unused (38% of body), NEXT BEST ACTIONS 110px (42%);
  CHAOS EXPOSURE is orphaned alone on row 2 of a 4-column KPI grid.
- **News article age is never surfaced** (captured and used for weighting, zero UI references), so a
  user cannot tell if a trending signal is 2h or 20h old. Snapshot is daily — a Vercel Hobby cron cap.
- **LEAGUE PULSE bars are coloured by position while red is the risk colour**, so a 2nd-ranked player
  renders a full red bar.
- **derivedMetrics position grades** use a hardcoded slot list — no SUPERFLEX, no K.
- Docs are the least trustworthy artifact: `FINAL_AUDIT.md` cites a `lifecycle/trades` lib that
  **does not exist**; [docs/account-isolation.md:11](docs/account-isolation.md#L11) and
  [settings/account/page.tsx:27](src/app/(app)/settings/account/page.tsx#L27) both describe JWT
  sessions — both were corrected in `96deb1a`. Remaining doc debt: consolidate 6 overlapping audit
  docs into one dated report, and `FINAL_AUDIT.md` still cites a `lifecycle/trades` lib that does not exist.
- `reports/` is 13.2 MB tracked, incl. 4.1 MB of PNGs and a 0-byte `tsc.txt`.

## Known gaps / honest caveats

- **There is no notification UI anywhere** — no bell, no inbox, no dismissal control. The F-002
  "honest UI explanation" is therefore only in the cron response and logs.
- Dev-tree `npm audit` still reports findings (lhci/puppeteer/drizzle-kit chains). Not production
  runtime; the gate is informational for dev scope by explicit policy.
- `backtest:sleeper` ECE is 0.2583 on n=10 team-seasons — pre-existing and statistically thin; not
  affected by this work, but it does not support strong calibration claims.
- **The simulator that is validated is not the simulator the product uses.** `calibrate:season`
  measures self-consistency only, and `backtest:sleeper` exercises `runSeasonSimulation`; the shipped
  chain (`ECR → replacement level → trueValue → runNexusSimulation`) has **no out-of-sample
  validation at all**. Both harnesses returned bit-identical numbers across four runs spanning three
  model changes, which is evidence of non-coverage rather than of safety. Design and leakage rules in
  [docs/model-validation-plan.md](docs/model-validation-plan.md); the harness is **designed, not
  built**. This is the largest remaining gap and no calibration claim should be made until it exists.
- `npm run check:freshness` exits 1 in this environment: it probes the **deployed** app and needs
  `CRON_SECRET`, which was not available. **BLOCKED**, not a code failure — it is not a CI gate.

## Requires owner approval (not done)

Production deploy · **ESPN credential rotation (recommended — the cookies were pasted into a chat
transcript, so they should be considered exposed)** · enabling `dependabot_security_updates` and
`automated-security-fixes` · branch ruleset · deleting the stale `audit/2026-06-09` branch ·
merging the PR.
