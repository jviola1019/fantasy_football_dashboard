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

### Model validation — the harness now EXISTS, and the model failed

`scripts/backtest-valuation.ts` (`npm run backtest:valuation`) scores the shipped
chain — draft ADP → replacement level → `trueValue` → `runNexusSimulation` →
playoff odds — against actual qualification on **50 team-seasons, 5 completed
leagues, 2022–2025**.

| Metric | Model | Climatology (p=0.60) |
|---|---|---|
| Brier | 0.3098 | 0.2400 |
| AUC | **0.3058**, CI [0.1333, 0.4450] | 0.5 |
| Brier skill | **−0.2908**, CI [−0.4588, −0.1320] | 0 |

Both CIs exclude the null **on the wrong side**. The model is significantly worse
than forecasting the base rate and its ranking is inverted. `runNexusSimulation`
now says so in its own assumptions, per CLAUDE.md's "do not present an
uncalibrated model as production-safe".

**A unit error the harness found on its first run.** `starterWeeklyMean` mapped
`trueValue = 50` — *replacement level* — onto the average *starter's* points.
Every real roster therefore floated above its own field: every team averaged 164
weekly points against a 115 field, so all 50 team-seasons predicted ~100% playoff
odds (Brier 0.4000, AUC exactly 0.5000). Fixed by anchoring at the average
startable trueValue, **derived in closed form** from the depth cushion (79.2), not
fitted. Pinned by `simulation.anchor.test.ts` + `simulation.calibration.test.ts`.

**Coverage proof**: the anchor fix moved `backtest:valuation` 0.4000 → 0.3098
while leaving `calibrate:season` (0.0770) and `backtest:sleeper` (0.1657)
bit-identical — direct evidence the old two never touched `runNexusSimulation`.

**Ablation**: raw draft capital AUC 0.5033 vs shipped chain 0.3058 — the
*transform* is destroying signal, not the input. Mechanism: rank-ratio VBD's
advantage grows with position depth, so it systematically under-values scarce
positions (QB3 → 87.5 vs RB3 → 95.7 in a 10-team league).

**Not done, deliberately**: no parameter was flipped or refitted to improve the
score. With 5 effective clusters that is curve-fitting. The indicated next change
is points-above-replacement instead of rank-ratio VBD, which needs projected
points per player and belongs behind its own evidence.

Full write-up: [reports/2026-08-06/backtest-valuation.md](reports/2026-08-06/backtest-valuation.md).

### Third pass (2026-08-18) — PAR, deduplication, and hygiene

**Points-above-replacement built and scored.** `src/lib/models/pointsCurve.ts`
fits expected season points by positional draft rank using isotonic regression
(PAVA, non-increasing), and `npm run backtest:valuation` now scores it against
the shipped rank-ratio transform through the identical simulation.

Like-for-like on the 30 team-seasons PAR can score:

| | Brier | AUC | AUC 95% CI |
|---|---|---|---|
| RANK (shipped) | 0.3353 | 0.2546 | **[0.1333, 0.4450]** — inverted |
| PAR (candidate) | 0.3338 | **0.4398** | **[0.3750, 0.5417]** — includes 0.5 |

Rank-ratio is *significantly inverted*; PAR is not. **But AUC did not cross 0.5**,
which was the success criterion, and neither beats a constant on Brier. PAR is
less wrong, not right.

**PAR is NOT the production default**, and the blocker is data, not modelling: it
needs a points curve at runtime and the app has no source for one. The only curve
available is fitted on five leagues from one manager group, all 10-team PPR — too
thin to bake in, especially behind a comparison that still loses to a constant.
Flipping the default is a one-line change once a broader curve source exists.

**A second scale error, found the same way.** Anchoring PAR on the best player in
the pool put starters at a mean trueValue of 71.4 against the simulation's 79.2
anchor, collapsing Brier to 0.5530 while ordering *improved* — the signature of a
level error. Fixed by anchoring on the average startable player, which is the
contract the simulation imposes. Brier recovered to 0.3338.

**Duplication and divergence removed.** The flex-weight table was a literal in
both `draft/rosterTargets.ts` and `fantasypros/enrich.ts`, and enrich carried the
comment *"so the two models cannot disagree"* — they already did: rosterTargets
hardcoded superflex occupancy at 1.0 while enrich honoured the coefficient. Both
now read `src/lib/league/lineupDemand.ts`, which also owns
`positionReplacementRank` and the average-startable anchor. A test asserts the
draft board and the valuation model move together.

**`pruneThrottle` wired.** It had ZERO callers, so `auth_attempts` grew forever —
a row per (account, IP, global) key per window. Now runs in the daily
lifecycle cron with a 24h retention (the longest window+lock is 30 minutes), and
reports `throttleRowsPruned`.

**Hygiene.** Six overlapping audit/plan docs moved from the repository root to
`docs/history/` with an index stating what superseded them. `FINAL_AUDIT.md`
cited a `lifecycle/trades` library that never existed — corrected in place rather
than deleted, so the evidence of doc drift survives. 13 superseded UI screenshots
(3.76 MB) dropped from tracking; tracked `reports/` went 4.6 MB → 0.87 MB. The
README now documents all 20 npm scripts (it named nine).

A correction to an earlier figure in this document: tracked `reports/` was 4.6 MB,
not the ~13 MB quoted before — the 8.9 MB `reports/lighthouse/` directory was
already untracked.

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
  CHAOS EXPOSURE is orphaned alone on row 2 of a 4-column KPI grid. **Partly addressed 2026-08-22**:
  the route was re-ranked (Next Best Actions is now the full-width first row), so the tile
  proportions have changed and these measurements are stale. The KPI orphan is unmeasured since.
- **News article age is never surfaced** (captured and used for weighting, zero UI references), so a
  user cannot tell if a trending signal is 2h or 20h old. Snapshot is daily — a Vercel Hobby cron cap.
- ~~**LEAGUE PULSE bars are coloured by position while red is the risk colour**~~ — **CLOSED.**
  `PULSE_BAR_COLOR` is `var(--blue)`; position is carried by `PositionBadge`, which it always was.
  This entry was stale: it stayed listed as OPEN after the fix landed.
- ~~**derivedMetrics position grades** use a hardcoded slot list~~ — **CLOSED.** `derivedMetrics.ts`
  derives slots from the league format and handles SUPERFLEX and K. Also stale.
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
- **The shipped model FAILED out-of-sample validation** (harness now built — see above). Brier 0.3098
  vs a 0.2400 climatology baseline; AUC 0.3058 with CI [0.1333, 0.4450]. Playoff odds are a structured
  scenario, not a prediction, and the simulation declares that in its assumptions. The remaining work
  is a modelling change (points-above-replacement instead of rank-ratio VBD), not a measurement gap.
- **n is still small and not independent.** 5 leagues from one manager group across four seasons —
  same players, correlated skill, all 10-team PPR. Every interval is wide and format generalisation
  is untested. Widening needs public completed leagues, which Sleeper exposes no directory for.
- **Variance does not scale with scoring format.** The field's `betweenTeamSigma` is proportional to
  the field mean and shrinks in STD, while a player's weekly sigma is an absolute points figure. Same
  mean edge, slightly less noise → STD and PPR odds differ ~2pp for an identical roster. Second-order
  next to the anchor error; pinned to <4pp by `simulation.test.ts`.
- `npm run check:freshness` exits 1 in this environment: it probes the **deployed** app and needs
  `CRON_SECRET`, which was not available. **BLOCKED**, not a code failure — it is not a CI gate.

## Requires owner approval (not done)

Production deploy · **ESPN credential rotation (recommended — the cookies were pasted into a chat
transcript, so they should be considered exposed)** · enabling `dependabot_security_updates` and
`automated-security-fixes` · branch ruleset · deleting the stale `audit/2026-06-09` branch ·
merging the PR.

---

## Hierarchy pass + P0-4 / P0-5 / P4 (2026-08-22 → 23)

Full detail in [reports/2026-08-20/REMEDIATION-PLAN.md](reports/2026-08-20/REMEDIATION-PLAN.md).

### Design — the deferred findings, executed

The design audit's verdict was *"the information is almost always present — the
failure is hierarchy, not honesty."* All five deferred findings are closed except
the chart-palette half of D-5.

- **D-6 · a type scale now exists.** There was none: 264 sites across four
  unreconciled systems, 78% of CSS type in the 8–11px band. Twelve sizes become
  eight (9 → 44px), Tailwind's ladder overridden so `text-xs` and
  `var(--text-xs)` mean the same thing, and `typeScale.test.ts` fails the build
  if a raw `px` size reappears.
- **D-8 · every route has a visible `<h1>`** (they were all `sr-only`) and solid
  amber is now reserved for the primary action — the loudest object on
  `/dashboard` used to be a non-interactive season chip.
- **D-7 · `/analytics` went from 28 boxed regions to 10**, `/draft` 13 → 6.
  One border level per panel; the selectable player cards keep theirs because
  there a border is a real affordance.
- **D-9 · tabs name the region they control.** Five panels had `role="tab"` with
  no `tabpanel` and no `aria-controls` anywhere. axe treats `aria-controls` as
  advisory, so this passed every scan for the component's whole life.
- **Removed rather than added:** six duplicate provenance badges per route, and
  a `FIXTURE FIXTURE` double-label in the command bar.

### P0-4 · the season-simulation "confidence bands"

Reproduced with `npm run measure:bands` before changing anything. The audit's
"~30× too narrow, ECE 28–30pp" was **overstated**: the real figures are **11.1×**
and **16.13pp**, and are recorded corrected.

The defect the report missed is worse: **the interval did not contain its own
point estimate** — `Playoffs 69.6% [68.1 – 69.6]`. The point came from one
full-iteration run, the band from 20 shorter replicates; nothing forced them to
agree. A test claimed to cover exactly this and could not fail, because it
compared the interval to its own bootstrap mean rather than to the number on
screen. **Eighth instance of the green-check-that-isn't-checking class.**

Renamed to `ReplicationRange`, re-centred on the displayed estimate, and the
unmeasured `widen()` multipliers (×1.5 / ×2.5) are deleted.

### P0-5 · a stale opportunity snapshot presented as current

`fetchedAt` was dropped at the load boundary, so opportunity activated on
**presence alone** — a snapshot of any age was stamped onto every record,
removed from `missingFields`, and described as coming "from the latest season's
games". `/api/health` already evaluated this exact snapshot against a declared
contract; the operator surface knew and the user surface did not. The contract
is now shared, expired snapshots are withheld, stale ones are labelled, and the
age is always stated. **No new thresholds were invented.**

### P4 · dead code removed

Each symbol was confirmed to have exactly one occurrence — its own definition —
before deletion: `SESSION_VERSION_CLAIM`, `espnRosterEntryToRecord`,
`src/lib/espn/index.ts`, and 8 uncalled Sleeper wrappers.

### Gates at this point

`typecheck` 0 · `lint` 0 · **vitest 946 passed / 39 skipped** · `build` clean ·
**Playwright 331 passed / 1 skipped / 0 failed** (exit code captured directly,
not through a pipe) · axe 0 serious/critical on all routes.

One regression was introduced and caught by the gate, not by reading the diff:
`.route-header-num` used `--blue` at `opacity: 0.75`, which composites to
4.13:1 at 11px and failed axe on all seven routes. **Opacity is a contrast
change wearing a costume.**

### Still open

*(This list was written before the P1/P2/P3/D-5 pass below; see that section for
what is now closed.)*
- **The unit suite is intermittently flaky under full-suite concurrency.** One
  run showed 4 failures in `throttle.test.ts` / DB-reset hooks with
  `Hook timed out in 10000ms`; the same files pass in isolation and the next two
  full runs were green. A suite that fails intermittently in the DB hook will
  eventually be dismissed as "just flaky" and then hide something real. Not yet
  diagnosed.

---

## P1 / P2 / P3 / D-5 (2026-08-23)

Full detail with measurements in
[reports/2026-08-20/REMEDIATION-PLAN.md](reports/2026-08-20/REMEDIATION-PLAN.md).

### P1 — all six closed

`listLeagues` had no `ORDER BY` and `leagues[0]` is the default active league ·
a failed refresh returned HTTP 200 with an empty roster · a **1.5 PPR league was
classified STANDARD** and priced at `ppr=0` · **three-team trades were graded as
two-sided with team C's haul under team B's name** · empty snapshots were written
as success (two more crons had the same shape) · `createLeague` could
permanently brick a league on a transient credential failure.

**The P1-1 fix broke a test, and the test was the thing that was wrong.** It
asserted insertion order on two leagues created in the same millisecond — a
guarantee no database ever made. Two of four runs failed. Fixed properly; three
consecutive clean full runs since.

### P2 — six fixed, one disclosed

- **P2-1** the CSV backtest path derived its forecast from the outcome it scored
  (AUC 1.0 by construction) and called itself a "lower bound". Reframed as a
  **harness self-test** with the AUC now *asserted*, and a banner saying the page
  measures nothing about the model.
- **P2-2** an ECE computed from a constant 0.5 was reported as "the projections'
  TRUE calibration error". Now absent instead.
- **P2-3** the PAR curve pooled season points across scoring formats — the same
  positionally asymmetric distortion it exists to remove. `scoringFormat` is now
  recorded and mixing is reported. **Latent today** (all five backtest leagues
  are 10-team PPR), silent before.
- **P2-4** `spearman` gave `[5,5,5,5]` the ranks `[1,2,3,4]` — an arbitrary
  ordering invented from nothing. Mid-rank tie handling now.
- **P2-5** every backtest input is fetched live and none is snapshotted, so
  "seeded and deterministic" described the arithmetic and not the run.
  **Mitigated**: an input fingerprint makes two runs comparable. Snapshotting is
  still open.
- **P2-6** `betweenTeamSigma` double-counted within-team variance. **Measured at
  +8.4%**, not the reported ~14%, by a seeded 4,000-league simulation
  (`npm run measure:sigma`). A second defect surfaced while fixing it:
  `betweenTeamSigma || 1` coerced a *measured* zero to a fabricated 1.
- **P2-7** leave-one-week-out was described as leakage-free. It removes temporal
  leakage but not player-level dependence. **Disclosed, not fixed** — a correct
  fix is grouped CV, which is a protocol change requiring pre-registration.

### P3 — all six untested surfaces covered

`timingSafe` · `redact` · `requireUser` · the cron gate · the credentials login
path · `toEnvelope`. **Two needed a structural change first**, because
untestable and untested are not the same problem and the first causes the
second:

- The **cron gate was copy-pasted into seven route files**. Extracted to
  `requireCronAuth`, and `cronAuth.test.ts` now *scans the filesystem*: every
  route under `src/app/api/cron` must call it, none may read `CRON_SECRET`
  itself, and the scan asserts it found at least seven routes so a wrong path
  cannot pass vacuously.
- **The login path could not be imported** — `auth.ts` pulls in `next-auth` and
  therefore `next/server`. That is why the one function exchanging a password
  for a session had zero coverage while `auth.config.test.ts` sat beside it
  testing a *different file*. `authorizeCredentials` moved to
  `src/lib/auth/credentials.ts`, which imports no next-auth.

### D-5 — the last deferred design finding

SVG presentation attributes cannot resolve `var()`, so every chart hard-coded
hex — and a whole **pre-repaint palette survived there**: `#77d7b0` where green
is now `#35c08a`, `#d9866f` where red is `#eb5f54`, `#8d9aa0` where muted is
`#8898aa`. The charts were painted in the colours of a design that no longer
existed.

`src/lib/theme.ts` is now the JS mirror of the CSS tokens, and `theme.test.ts`
**fails the build if the two disagree**, if a new CSS colour token has no mirror,
or if any retired hex reappears in a component. That test is the point — without
it, `theme.ts` would just be a second place for the palette to drift.

### Gates

`typecheck` 0 · `lint` 0 · **vitest 1038 passed / 39 skipped** (up from 931) ·
`build` clean · **Playwright 331 passed / 1 skipped / 0 failed**, exit code
captured directly rather than through a pipe.

---

## Draft / free-agency / chart audit (2026-08-23)

Detail in [reports/2026-08-20/REMEDIATION-PLAN.md](reports/2026-08-20/REMEDIATION-PLAN.md).

**The draft state machine works and is now pinned.** 18 browser assertions on
`/draft`: drafting to your team, marking an opponent pick, every dependent tab
recomputing, release, and reset. Kept as `e2e/24-draft-board.spec.ts` — the
existing specs asserted the panel renders, not that it responds.

**Bye week was missing entirely.** `status: "bye"` said "out this week"; nothing
said *which* week. FantasyPros has shipped `player_bye_week` in every snapshot
and `enrich.ts` dropped it at the boundary while its own comment claimed
otherwise — the same shape as P0-5. Now on the record (nullable, never
defaulted), on the live board, the recommendation queue and the big board, with
a same-position stacking warning that is worded, not just tinted.

**I introduced a column misalignment and the test caught it.** Adding the Bye
column replaced the TEAM cell instead of inserting beside it — seven headers
over six cells, every value shifted one place left, every cell still plausible.
A screenshot would not have caught it; counting cells did.

**Charts: 59 surfaces, all drawn, all labelled.** Measured per tab, because
charts behind tabs unmount — the first pass measured once at the end and found
3 of them.

**Layout: 30 page states × 4 assertions, all passing.** One real finding: the
Outcome Multiverse labels rendered at ~5 CSS px (8 user units in a viewBox
scaled 0.66), below the floor and invisible to every gate, because CSS tooling
does not measure scaled SVG user units. The labels moved out to an HTML legend.

### Gates

`typecheck` 0 · `lint` 0 · **vitest 1092 passed / 39 skipped** · `build` clean ·
draft spec **18/18** · chart audit **59/59** · layout audit **120/120**.

---

## The two non-10 areas (2026-08-23, later)

### Model — the validated half is now shipped

The refutation of protocols 1–3 **stands and was not re-litigated**. What
changed is the other half: protocols 4 and 5 validated in-season usage twice,
and it could not be shipped because RAE had usage and **no points-to-date
anywhere**. The dossier's own words: *"validated for a model RAE has not built."*

Built: `season_stats_snapshots` on both drivers · `/api/cron/stats-refresh`
(empty-write guard, season resolved from Sleeper state) · `inSeasonScore.ts`
(`z(pts/g) + 0.7613·z(touch/g)`, standardised within position) · `InSeasonBoard`
on `/waivers`, kept **separate** from the refuted edge table below it.

**The fidelity gate caught a real defect on its first run.** It failed at 0.0204
against protocol 5's published 0.0195. One cause was a genuine bug in the
shipped model — a sample sd where the validated harness used a population sd,
which changes the pooled ranking across cohorts of different sizes — and one was
a defect in the check. The tolerance was never widened. Now 0.0195 vs 0.0195,
difference 0.000006, and it runs in CI.

Without that gate RAE would have shipped a model that *resembled* the validated
one. That gap is where "validated" quietly stops being true.

### Performance — the estimator was the problem

`numberOfRuns: 1`. A single sample of a metric whose local spread was 90/82/78.
Now five runs with a **median** assertion, plus a `lighthouse-variance` CI step
that prints each run, the median and the spread, flagging any category whose
spread reaches 5 points. Reports upload as an artifact.

Optimisation deliberately comes second: tuning against a number you cannot
measure is how you chase noise.

### Fixture catalog grew 8 → 14

The in-season board standardises within position and protocol 5 skipped cohorts
below five, so with three RBs and two WRs it could only ever render its empty
state. **The threshold was not lowered to flatter the demo** — five is what was
validated. The catalog grew instead, with every new `sleeperId` verified against
the live players API.

Two tests failed as a result and **neither was a regression**: one asserted the
fixture count as a magic number in a test about imagery, and one assumed a QB
would survive into a top-8 that now holds six stronger players. Both were fixed
to assert their intent.
