# HANDOFF — forensic remediation of the 2026-08-06 audit

**Branch** `fix/2026-08-06-forensic-remediation` · **base** `efb124b` (= `origin/main`, verified unmoved)
**Plan** `~/.claude/plans/you-are-the-lead-proud-canyon.md` · **Evidence** `reports/2026-08-06/`

**No merge, no deployment, no credential rotation, and no production database mutation has occurred.**
This branch is **partially complete** — see the ledger. Do not treat it as a finished remediation.

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
| F-010 | *(user-added)* League-format propagation | **PARTIAL** — draft targets + lineup mesh done (`671989b`); **trade dynasty, VOR replacement level and sim scoring anchor NOT done** |
| F-012 | *(user-added)* UI/UX, design and news review | **PARTIAL** — review + a11y fixes done (`ec07bce`); landing-page grid, dashboard dead space, news age visibility recorded OPEN |
| F-004 | Password change does not revoke JWT sessions | **PASS** — `96deb1a` (see constraint below) |
| F-007 | CSP hardening | **NOT STARTED** — the only untouched finding |

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
| build | 0 | 0 | PASS |
| e2e (Playwright + axe) | 157 passed / 1 skipped | **171 passed / 1 skipped** | PASS — +14 target-size |
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

## Next steps, in priority order

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

### 1. F-007 — CSP (the only untouched finding)
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
- **Trade actions read the wrong league**: `firstLeague()` returns `leagues[0]`, ignoring the
  active-league cookie every other surface uses ([trade/actions.ts:31-37](src/app/trade/actions.ts#L31-L37)).
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

## Requires owner approval (not done)

Production deploy · **ESPN credential rotation (recommended — the cookies were pasted into a chat
transcript, so they should be considered exposed)** · enabling `dependabot_security_updates` and
`automated-security-fixes` · branch ruleset · deleting the stale `audit/2026-06-09` branch ·
merging the PR.
