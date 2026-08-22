# Audit 2026-08-20 — remediation ledger

**Repository** `jviola1019/fantasy_football_dashboard` ·
**Product** RAE — Roster Analytics Engine (renamed 2026-08-22; see below)

| | |
|---|---|
| Source branch | `fix/2026-08-06-forensic-remediation` |
| Audited source head | `69634d33a1347486a1d61eec33bde4a10cad4a2d` |
| Remote head at start | `69634d33a1347486a1d61eec33bde4a10cad4a2d` (**verified unmoved**) |
| Base branch / merge-base | `main` / `efb124bd7f5bf867f3fb29040d5cb1d680a6f7b3` |
| New fix branch | `fix/2026-08-20-audit-remediation` (created from the audited SHA) |
| PR | #21 OPEN **DRAFT** — stays draft while any P1 is open |
| Audit date | 2026-08-20 |

## 0. Capability inventory

Determined by execution, never from configuration files.

| Capability | State | Evidence |
|---|---|---|
| Local repository | `AVAILABLE` | `git status --short` clean at `69634d3` |
| Git | `AVAILABLE` | `git version 2.53.0.windows.3` |
| Terminal | `AVAILABLE` | Git Bash + PowerShell 5.1, win32 |
| GitHub | `AVAILABLE` | `gh` 2.95.0, account `jviola1019`, scopes `gist, read:org, repo` |
| GitHub Actions + logs | `AVAILABLE` | `gh run list` returned CI/CodeQL/Security runs on the audited SHA |
| Browser | `AVAILABLE` | Playwright chromium 1208/1217/1223/1228 installed |
| Playwright | `AVAILABLE` | `npm run e2e` wired to `playwright test` |
| SQLite | `AVAILABLE` | `better-sqlite3` native binding present |
| Isolated real PostgreSQL | `AVAILABLE` | **new** isolated cluster, PG **17.11**, `C:\tmp\rae-pgtest`, `127.0.0.1:55432`, db `rae_test`, role `raetest`. Separate from the operator's service on 5432, which is password-gated and was NOT touched. |
| Vercel | `BLOCKED` | Vercel CLI not installed; Vercel MCP unauthorized in a non-interactive session |
| Production database | `BLOCKED` | no credentials; not required and not attempted |
| Production deployment | `BLOCKED` | requires human approval; not attempted |
| Secret manager | `BLOCKED` | no authorized access — see §11 |
| Sleeper | `AVAILABLE` | `GET /v1/state/nfl` → 200 |
| ESPN | `UNKNOWN` | needs `ESPN_S2`/`SWID` for a private league; no public league id supplied |
| nflverse | `AVAILABLE` | releases endpoint → 200 |
| FantasyPros | `AVAILABLE` | cheatsheets endpoint → 200 |
| FantasyCalc | `AVAILABLE` | `values/current` → 200 |
| KTC / DynastyProcess | `AVAILABLE` | DynastyProcess `values.csv` → 200 |
| **MyFantasyLeague (new)** | `AVAILABLE` | public `export` API: `leagueSearch`, `league`, `draftResults`, `playerScores`, `leagueStandings`, `playoffBrackets` all 200 (302 → league host, needs redirect-follow). Rate-limits with HTTP 429 — throttle required. |
| Fleaflicker | `UNKNOWN` | API answers but returns "can not find league 1"; no league-discovery endpoint found |
| Plugins / MCP | `PARTIAL` | context7 available; figma/neon/supabase/vercel/huggingface MCP **unauthorized** (a non-interactive session cannot run OAuth) |

## Product decisions taken (per §3 / §11 / §19)

- **§3 → Strategy B.** The operator delegated the choice with the constraint
  "simplistic yet extremely accurate and readable for a regular user, mobile and
  desktop". Rationale and usability tradeoff: `docs/model-presentation-decision.md`.
- **§11 → generate a replacement token, persist nowhere.** A 256-bit candidate was
  produced and handed to the operator in-session only. It is written to no file and
  no commit. Independent verification that the *historical* token is dead remains
  `BLOCKED` (no secret-manager access) — operator runbook supplied.
- **§19 → acquire a genuinely untouched holdout from MyFantasyLeague.** Measured
  yield: **18,723** unique candidate league ids for season 2023 from 10 search
  terms; a 12-league structural probe found 7 full-draft redraft leagues at 8, 12,
  14 and 16 franchises. This replaces a 5-cluster development sample with hundreds
  of independent clusters and real format diversity.

## Finding ledger

Status values: `OPEN`, `IN-PROGRESS`, `FIXED`, `BLOCKED`, `CLOSED-VERIFIED`, `NOT-A-DEFECT`.

| § | P | Finding | Status |
|---|---|---|---|
| 3 | P1 | Shipped rank-ratio model fails out of sample; failure notice is not adjacent to the decision-facing percentages | `OPEN` |
| 4 | P1/P2 | PAR is an experiment, not a production replacement; the five leagues are now development data | `OPEN` |
| 5 | P2 | Pseudo-replication of player-seasons across leagues in PAR training data is unquantified | `OPEN` |
| 6 | P2 | Isotonic monotonicity is a structural assumption and must be labeled as one | `OPEN` |
| 7 | P1 | Live PPR/HALF/STD unit consistency | `OPEN` |
| 8 | P1 | Sleeper injury/status provenance is stamped fresh from a cached snapshot | `OPEN` |
| 9 | P1 | `injured-starter` is marked evaluated on roster membership alone | `OPEN` |
| 10 | P2 | 29 PostgreSQL integration tests are skipped in ordinary CI | `OPEN` |
| 11 | P1 | Historical `DB_INIT_TOKEN` invalidation is unverified | `BLOCKED` |
| 12 | P2 | League-format defaults are assumptions; need independent sensitivity | `OPEN` |
| 13 | — | Provenance classification of every decision-facing value | `OPEN` |
| 14 | — | Security/auth clean-room review + negative tests | `OPEN` |
| 15 | — | Supply chain, `GHSA-9wv6-86v2-598j` expiry 2026-11-11, Node-20 action runtime migration | `OPEN` |
| 16 | — | PR #21 body + README badge carry stale test counts | `OPEN` |

### Evidence established by reading source at `69634d3`

- **§7** — format selection *does* already happen before the numeric crosses the
  boundary (`src/lib/envelope/load.ts:154` calls `pickProjectionPoints(p, scoring)`).
  The residual defects are narrower than the audit brief states, but real:
  1. `pickProjectionPoints` falls back to `pts_ppr` when the format-specific field
     is null (`src/lib/leagues/scoringPoints.ts:18-19`), so a STD league can mix
     PPR-unit players into a STD-unit team measured against a 9.5 STD field.
  2. `SimulationParams.weeklyProjections` is documented "Real weekly **pts_ppr**"
     (`src/lib/simulation.ts:19-20`) — false for HALF/STD leagues.
  3. The user-visible assumption string claims "its real Sleeper **pts_ppr**
     projection" (`src/lib/simulation.ts:236`) — a provenance misstatement.
  4. No unit is carried across the boundary, so nothing structurally prevents a
     future mix.
- **§8** — `materializeSleeperRoster` (`src/lib/leagues/fetchLive.ts:303-329`)
  stamps `fetchedAt: new Date().toISOString()`, `ttlSeconds: 120`,
  `freshness: "fresh"`, `validation: "valid"` on every record, while
  `injury_status` originates in `playersMap` = `snapshot.players` from
  `getLatestPlayersSnapshot()`. `snapshot.fetchedAt` is in scope at line 219 and is
  discarded. **Confirmed as stated.**
- **§9** — `src/lib/lifecycle/notifications.ts:303`,
  `if (rosterKnown) evaluated.push("injured-starter")`, where
  `rosterKnown = input.roster.length > 0` (line 256). Roster membership is not
  injury knowledge. **Confirmed as stated.**
- **§3** — the "NOT VALIDATED OUT-OF-SAMPLE" string is `sim.assumptions[4]`.
  `RiskOfRegret` renders `assumptions.slice(0, 3)` truncated to 60 chars, so it is
  excluded; `RiskDetails` renders the full list but only inside the "Risk Analysis"
  tab. The default "Multiverse" tab shows `ConfidenceBands` —
  "Championship 12.4% [8.1 – 17.0]" under the heading "95% Confidence Bands" —
  with **no adjacent warning**. **Confirmed as stated.**

## Execution plan (verify + commit each segment)

1. **P1 code** — §7 scoring units, §8 injury provenance, §9 injury evidence gating.
2. **P1 UX** — §3 Strategy B.
3. **P2 CI** — §10 Postgres service job + local isolated-cluster evidence.
4. **Model validation infrastructure** — §5 dependence quantification, §6 curve
   assumption documentation, frozen protocol, MFL acquisition harness.
5. **Holdout execution** — acquire, execute **once**, report including failure.
6. **Close-out** — §12 sensitivity, §13 provenance, §14 security negatives,
   §15/§16 supply chain + docs, §11 runbook, clean-room re-review, PR update.

## Authorizations NOT exercised

No merge, no deployment, no credential rotation, no history rewrite, no production
database mutation, no destructive external write.

---

# Execution record

## Finding ledger — final status

| § | P | Finding | Status | Evidence |
|---|---|---|---|---|
| 3 | P1 | Model failure not disclosed beside the numbers | `FIXED` | Strategy B; `docs/model-presentation-decision.md`; `e2e/20-model-failure-disclosure.spec.ts` 14/14 desktop+mobile |
| 4 | P1/P2 | PAR is an experiment, five leagues are development data | `FIXED` | PAR still not shipped; frozen protocol `holdout-protocol.md`; existing leagues declared development data |
| 5 | P2 | Pseudo-replication unquantified | `FIXED` | `playerId`/`leagueId` now required; `curveSampleDiagnostics`; design effect **1.31** measured; three treatments compared; `par-dependence-analysis.md` |
| 6 | P2 | Curve assumptions described as findings | `FIXED` | `docs/points-curve-assumptions.md` — 7-row assumption ledger, incl. the unrepresented-uncertainty gap |
| 7 | P1 | PPR/HALF/STD unit consistency | `FIXED` | `WeeklyProjectionByFormat` to the sim boundary; position-aware fallback **measured**, not assumed; `simulation.scoringUnits.test.ts` 16/16 |
| 7b | **P1 (new)** | Live projection path never matched a single player | `FIXED` | `sleeper:` namespace applied once in `snapshotToWeeklyProjections`; regression-tested |
| 8 | P1 | Injury provenance stamped fresh from a cached snapshot | `FIXED` | composite `SourceMeta` bounded by the oldest input; `fetchLive.test.ts` 42/42 |
| 9 | P1 | `injured-starter` evaluated on roster membership alone | `FIXED` | `InjuryEvidence` gate, fail-closed; emission never suppressed; unit + **PostgreSQL** coverage |
| 10 | P2 | 31 PostgreSQL tests skipped in ordinary CI | `FIXED` | dedicated `postgres` job on pinned `postgres:17.5-alpine`, **fails if skipped**; 31/31 locally on real PG 17.11 |
| 11 | P1 | Historical `DB_INIT_TOKEN` invalidation unverified | `BLOCKED` | no secret-manager access; runbook at `docs/runbooks/db-init-token-rotation.md`; replacement token generated in-session, persisted nowhere |
| 12 | P2 | League-format defaults are assumptions | `FIXED` | sweep extended 48 → **96 shapes** (adds no-kicker, 0/3-FLEX, redraft/keeper/dynasty); `replacement-sensitivity.txt` |
| 13 | — | Provenance classification | `FIXED` | 8-way epistemic classification + licensing/retention table appended to `docs/data-source-map.md` |
| 14 | — | Security/auth clean-room + negative tests | `CLOSED-VERIFIED` | all seven categories already covered and passing — see below |
| 15 | — | Supply chain + Node-20 action runtime | `FIXED` (scan) / `PLANNED` (runtime) | all gates green; migration plan below |
| 16 | — | Stale test counts | `FIXED` | README count badge replaced with workflow badges; the 442 claim removed |
| — | — | ~~`/analytics` overflows horizontally at 320px~~ | **FIXED 2026-08-22** | It was never just `/analytics`: **every route** overflowed by the same 52px (`scrollWidth` 372 vs 320). One element explained all of it — the command bar's right-hand cluster at 248px. Fixed by letting the bar wrap below `sm`, hiding nothing. 24 new tests (12 routes × 320/360px) |

## §14 — negative tests, located and executed (not re-written)

Every category the audit lists already had coverage. Verified by execution
(89 passed / 22 skipped across auth, leagues, crypto, db):

| required negative test | location |
|---|---|
| stale JWT after password change | `src/lib/auth/session.test.ts:38` |
| two-session revocation is global | `session.test.ts:59` |
| deleted-user token rejection | `session.test.ts:72` |
| token with no version claim | `session.test.ts:79` |
| token for a different user id | `session.test.ts:91` |
| does not revoke other users' sessions | `session.test.ts:97` |
| failed password change revokes nothing | `session.test.ts:113` |
| cross-user league read / list / delete | `src/lib/leagues.test.ts:54,66,89` |
| cross-account league id | `leagues.test.ts:140` |
| cross-user ESPN credential read | `leagues.test.ts:153` |
| cross-user notification dismissal | `src/lib/lifecycle/notifications.test.ts:184` |
| cross-user report/league data (browser) | `e2e/07-no-shared-data.spec.ts:32` |
| tampered ciphertext / auth tag / wrong key | `src/lib/crypto.test.ts:18,24,30` |
| missing or malformed encryption key | `crypto.test.ts:36` |
| parallel failed logins / throttle concurrency | `src/lib/auth/throttle.concurrency.test.ts` + `throttle.pg.integration.test.ts` |

## §15 — Node-20 action runtime migration plan

Not a blocker, and deliberately **not** executed in this audit: bumping every
action major is a change whose only real verification is a CI run on the default
branch, and doing it inside a P1 remediation would confound the two.

| action | current | target | note |
|---|---|---|---|
| `actions/checkout` | `v4` (Node 20) | `v5` | mechanical |
| `actions/setup-node` | `v4` (Node 20) | `v5` | mechanical; keep `node-version: 20` separate from the runtime bump |
| `actions/upload-artifact` | `v4` (Node 20) | `v5` | check artifact-name uniqueness semantics |
| `actions/dependency-review-action` | `v4` | `v5` | verify config keys unchanged |
| `github/codeql-action/*` | `v3` | `v4` | **do last** — CodeQL majors change the SARIF/init contract |
| `gitleaks/gitleaks-action` | `v2` | latest | verify the history-allowlist policy still applies |
| `google/osv-scanner-action` | `v2.2.4` | latest v2 | already pinned to a patch |

Sequence: one PR per action, `checkout` first, `codeql` last, each merged only on
a green run. Do not batch — a batched bump makes a failure ambiguous.

**Also review before 2026-11-11:** the single development-only exception
`GHSA-9wv6-86v2-598j` (`path-to-regexp`). `npm run check:exceptions` fails the
build once it lapses, which is the intended forcing function.

## Executed command results

| command | exit | result |
|---|---|---|
| `npm run typecheck` | 0 | PASS |
| `npm run lint` | 0 | PASS |
| `npm run test` (vitest) | 0 | PASS — 881 passed / 39 skipped |
| `npm run build` | 0 | PASS |
| `npm run e2e` (playwright + axe) | 0 | PASS — 219 passed / 1 skipped |
| PostgreSQL integration (real PG 17.11) | 0 | PASS — 31/31 |
| `npm run check:secrets` | 0 | PASS — 277 files, no secret-shaped literals |
| `npm run check:exceptions` | 0 | PASS — 1 exception, none expired |
| `npm run check:advisories` | 0 | PASS — no resolved version below a floor |
| `npm audit --omit=dev --audit-level=moderate` | 0 | PASS — 0 vulnerabilities |
| `gitleaks detect --redact -v` | 0 | PASS — 232 commits, no leaks |
| `npm run check:projection-units` | 0 | PASS — every declared reception-neutral position verified identical |
| `npm run sensitivity:replacement` | 0 | PASS — 96 league shapes, 0 ordering violations |
| `npm run backtest:valuation` | 0 | executed; reports failure honestly |

---

# Additional findings and evidence (post-first-CI)

## CI on a stacked PR ran nothing at all

`ci.yml`, `security.yml` and `codeql.yml` all declared
`pull_request: branches: [main]`. PR #26 targets the forensic branch, not `main`,
so **no workflow fired**: no typecheck, no vitest, no Playwright, no CodeQL, no
secret scan. The PR rendered as clean because nothing had run to say otherwise.

Widened to `[main, "fix/**"]` in all three. Cost is bounded — it only fires when
such a PR exists. This is arguably the most consequential process defect found in
this audit: every stacked remediation PR before it was unverified.

## CodeQL then failed the PR — 7 new alerts, 3 high

Immediately after the trigger fix, the first real CodeQL run on this branch
returned **7 new alerts (3 high, 4 medium)**, all in the acquisition scripts
written during this audit:

| rule | severity | count | substance |
|---|---|---|---|
| `js/file-system-race` | high | 3 | `existsSync(p)` then `readFileSync(p)` — TOCTOU |
| `js/http-to-file-access` | medium | 3 | API-supplied league id interpolated into a file path |
| `js/file-access-to-http` | medium | 1 | cached file contents used to build a request URL |

The path-traversal exposure was real: a league id of `../../x` from the API would
have escaped `OUT_DIR`. Fixed by **enforcing the numeric contract** (`isSafeId`,
`isSafeSeason`) at every boundary — URL construction, frame population, cached
frame read-back, and again at the `writeFileSync` itself — plus race-free
attempt-and-handle helpers replacing every check-then-use pair.

Fixed, not suppressed. The alerts were correct, and "it is only a research
script" is precisely the reasoning that puts unvalidated remote input into a
filesystem path.

## Remaining executed commands

| command | exit | result |
|---|---|---|
| `npm run lighthouse` | 0 | **PASS** — assertions green; **accessibility 100 on every route**, CLS 0, best-practices 96-100, perf 74-92 |
| `npm run calibrate:season` | 0 | PASS — reliability table regenerated, `docs/season-calibration.md` byte-identical (determinism holds) |
| `npm run backtest:sleeper` | 0 | PASS — pooled Brier **0.1657**, **bit-identical** to the pre-change value. Confirms §7/§7b did not perturb the off-season path, which is the path this harness exercises |
| `npm run check:freshness` | 1 | **BLOCKED**, not FAIL — the endpoint's snapshot block is operator-gated and requires `CRON_SECRET`, which this session does not have. The guard correctly reported that it could not evaluate rather than passing vacuously |
| `rm -rf node_modules && npm ci` | — | **Not run locally, deliberately.** CI runs `npm ci --no-audit --no-fund` on Node 20 / ubuntu for this exact commit on every workflow, which is stronger evidence for the deployable target than a local Node 25 install. Re-installing locally also risks a native `better-sqlite3` rebuild failure mid-audit (see the Node-20 constraint in project memory) |

## CI evidence on PR #26

First full run after the trigger fix, at `9fc8721`:

| check | result |
|---|---|
| `typecheck + lint + vitest` | **pass** |
| **`postgres integration`** | **pass (2m4s)** — the §10 job works on real runners |
| `codeql (javascript-typescript)` | pass |
| `CodeQL` (code-scanning results) | **fail → fixed at `8663fa9`** (see above) |
| `tracked-file secret scan` | pass |
| `gitleaks secret scan` | pass |
| `OSV lockfile scan` | pass |
| `lockfile advisory scan` | pass |
| `dependency review` | pass |
| `playwright + axe` | ran |
| `lighthouse perf + a11y` | ran |


---

# §19 — holdout EXECUTED

Ran once on 2026-08-21, on the committed 21-league artifact. Full result and
interpretation: [`holdout-result.md`](./holdout-result.md).

| | |
|---|---|
| sample | **160 team-seasons, 13 clusters**, seasons 2021/2023 |
| league sizes | 10, 12, 14, 16 |
| playoff fields | 4, 6, 8 |
| shipped chain | Brier **0.2822** · log loss 0.8004 · AUC **0.5569** · ECE 0.1613 |
| structural climatology | Brier 0.2404 · log loss 0.6737 · ECE 0.0000 |
| raw draft capital | AUC 0.5149 |
| Brier skill | **-0.1738**, 95% CI **[-0.2550, -0.0910]** (4913 distinct resamples) |
| AUC 95% CI | **[0.4630, 0.6300]** (4732 distinct resamples) |
| criterion 1 — AUC CI above 0.5 | **NOT MET** |
| criterion 2 — Brier skill CI above 0 | **NOT MET** |

**Verdict: no positive external skill.** Nothing was tuned on this data.

## The finding that required correcting earlier work

| claim | development (3-5 clusters) | holdout (13 clusters) | verdict |
|---|---|---|---|
| ranking significantly **inverted** | AUC 0.2546 CI [0.1333, 0.4450] | AUC **0.5569** CI **[0.4630, 0.6300]** | **did NOT replicate** |
| calibration worse than base rate | skill CI [-0.4588, -0.1320] | skill CI **[-0.2550, -0.0910]** | **replicated, significant** |

The user-facing disclosure had been asserting "ranked teams worse than chance
(AUC 0.25)". Better evidence refutes it, so it was rewritten on every surface and
a test now prevents the phrasing returning. **Overstating a model's failure is
still misstating it.**

The calibration failure is the real one, and the reliability table shows the
mechanism: forecasts spread 7%-92% while observed rates hug the 0.475 base rate.
Twelve teams told ~7% qualified 42% of the time. That over-dispersion is exactly
the harm §3 addressed — the holdout **vindicates Strategy B**.

## Limitations

13 clusters not the 200 targeted (Amendment 1 — API rate limiting, not
selection); two seasons; PPR assumed for all MFL leagues; the §6 self-check is
vacuous by construction and the harness says so; playoff qualification is coarse;
one platform.

## §22 clean-room re-verification (final tree)

| check | result |
|---|---|
| `origin/fix/2026-08-06-forensic-remediation` | `69634d33a134…` — **UNMOVED** from the audited SHA |
| `origin/main` | `efb124bd7f58…` — unmoved |
| working tree | clean |
| PR #21 | OPEN, **draft** |
| PR #26 | OPEN, **draft** |
| `TODO` / `FIXME` in `src` (non-test) | **0** |
| `.skip` in `src` | all env-gated integration/live suites; PG now runs in CI |
| `new Date().toISOString()` | audited; the roster-record site is the §8 fix, the rest are cron/HTTP fetch stamps where "now" is correct |
| `leagues[0]` | all sites are the active-league cookie fallback (the closed F-010 finding), not silent first-league selection |
| `pts_ppr` | no false-provenance claim survives; the last one, in `data-source-map.md`, was corrected |
| `.gitleaksignore` | **13 entries, all 4-field exact `commit:path:rule:line` fingerprints, zero wildcards** — a narrowly-scoped allowlist, not class suppression. This is also precisely why gitleaks passing is not evidence the historical `DB_INIT_TOKEN` is dead (§11) |

## Stop-condition audit (§21)

| condition | triggered? |
|---|---|
| source SHA moved during implementation | no — verified twice |
| production model still presented as validated | no — Strategy B, and the disclosure was corrected again when the holdout refuted part of it |
| scoring units still inconsistent | no |
| stale injury evidence can resolve an alert | no — fail-closed, tested on SQLite and PostgreSQL |
| future PAR validation reuses development data as holdout | no — forbidden by the frozen protocol and by the handoff |
| Postgres cannot be exercised | no — 31/31 locally and green in CI |
| **historical credential invalidation needs unavailable operator access** | **YES → reported `BLOCKED`, with a runbook** |
| production credentials required | no |
| mandatory CI/security gates red | no — CodeQL failed once, was fixed, and passes |
| destructive action without approval | none taken |

Exactly one stop condition is triggered, and §21's required response — return
`BLOCKED` rather than claim completion — is what this report does.

## Final CI state — PR #26 @ `b796491`

**13 / 13 checks pass. Zero failures, zero pending.**

| check | result |
|---|---|
| `typecheck + lint + vitest` | pass |
| `playwright + axe` | pass |
| `lighthouse perf + a11y` | pass |
| **`postgres integration`** | **pass** — the §10 job, on a pinned `postgres:17.5-alpine`, with the skip-detector armed |
| `CodeQL` (code-scanning results) | pass — the 7 alerts it raised earlier are fixed, not suppressed |
| `codeql (javascript-typescript)` | pass |
| `tracked-file secret scan` | pass |
| `gitleaks secret scan` | pass |
| `OSV lockfile scan` | pass |
| `lockfile advisory scan` | pass |
| `dependency review` | pass |
| `Vercel` / `Vercel Preview Comments` | pass |

Note this is the first time any of these ran on a stacked remediation PR — before
the trigger fix, `pull_request: branches: [main]` meant none of them fired.

Both PRs remain **draft**. §11 is `BLOCKED` on operator action, and the holdout
returned a failure the operator should read before merging.


---

# Post-hoc diagnostics + protocol 2 (requested follow-up)

## Post-hoc statistical testing on the 13-cluster sample

Run as **characterisation, not adjudication** — the criterion was fixed before
scoring and failed; no later test can substitute for it. All p-values are cluster
permutation (labels shuffled within league, never across).

| test | statistic | null mean | p | reading |
|---|---|---|---|---|
| ANOVA F (forecast ~ outcome) | 2.2448 | 2.9338 | 0.5043 | no discrimination |
| AUC (one-sided) | 0.5569 | **0.5620** | 0.5570 | no discrimination |
| Hosmer-Lemeshow (parametric bootstrap) | 59.9253 | 34.2620 | **0.0183** | **significantly miscalibrated** |

Two things worth recording:

1. **The permutation null for AUC centres on 0.562, not 0.50.** Unequal cluster
   sizes and berth rates shift it. So the observed 0.5569 — which looked mildly
   above chance against a naive 0.5 — is *exactly at* chance against the correct
   null.
2. **The calibration test was wrong in its first version and was corrected before
   reporting.** It used label permutation, which destroys calibration under the
   null too, so the null statistic (60.57) was as large as the observed (59.93),
   the test had no power, and it returned a falsely reassuring p = 0.46 that
   contradicted the pre-declared Brier-skill interval. Replaced with a parametric
   bootstrap whose null generates outcomes from the model's own forecasts.

Stratified: **every league-size bucket scores worse than its own climatology**
(10-team 0.2906 vs 0.2400 · 12-team 0.2805 vs 0.2421 · 14-team 0.2528 vs 0.2449 ·
16-team 0.2916 vs 0.2344).

Full report: [`holdout-diagnostics.md`](./holdout-diagnostics.md).

## Protocol 2 — frozen, built, awaiting trigger

[`holdout-protocol-2.md`](./holdout-protocol-2.md) frozen at `77fb562`, harness at
`f431859`. Three Holm-corrected hypotheses (all three required), four
non-adjudicating diagnostics including leave-one-league-out isotonic
recalibration and a minimum-detectable-effect calculation. Execution trigger is
150 leagues; the harness enforces it rather than relying on discipline.

**Merge remains blocked** on two independent grounds: §11 is an unresolved P1,
and the model has not validated.

---

# Protocols 2 and 3 — executed, and what they changed in the product

## Protocol 2 — enlarged holdout, ground-truth labels

150 archived leagues → **68 clusters, 800 rows**. Outcome label corrected to
**observed bracket participation** (Amendment 2, recorded pre-execution) after
validation found the inferred label wrong for 33% of leagues.

| id | hypothesis | statistic | p | Holm | reject? |
|---|---|---|---|---|---|
| H1 | AUC > 0.5 | 0.5867 (perm null 0.5661) | 0.1010 | 0.0167 | no |
| H2 | Brier skill > 0 | −0.1632 | 1.0000 | 0.0250 | no |
| H3 | resolution − reliability > 0 | −0.0289 | 1.0000 | 0.0500 | no |

**NOT VALIDATED.** Nothing tuned.

Diagnostics: miscalibration (0.0381) is **4×** informativeness (0.0093);
out-of-fold recalibration recovers skill −0.1632 → −0.0076 without beating
climatology; and a logistic regression fitted **directly** to the outcome on
draft-only features reaches only AUC 0.5379 / skill −0.0391.

**Two reporting errors, found and fixed before recording; confirmatory numbers
byte-identical across both runs, both disclosed.** The AUC-invariance note was
wrong for leave-one-*league*-out, and the power calculation used a 0.5 null while
the test used 0.5661 — which had inverted the conclusion from "underpowered" to
"adequately powered".

## Protocol 3 — the reputation edge, tested for the first time

Target chosen after scanning the codebase: `trueValue` drives draft tiers, keeper
valuation, waiver priority and every ranking shown, and **none of it had ever
been validated**. 115 leagues, 21,714 rows, **1,211 distinct player-seasons**,
clustered on player-season.

| id | hypothesis | statistic | 95% CI | reject? |
|---|---|---|---|---|
| H1 | edge predicts beating draft cost | +0.0579 | [0.0181, 0.0979] | **yes** |
| **H2** | **same, WITHIN position** | **−0.0480** | **[−0.0757, −0.0197]** | **no — INVERTED** |
| H3 | concordance at matched cost | 0.5316 | [0.5168, 0.5465] | **yes** |

**NOT DEMONSTRATED.** H2 is the hypothesis that separates "we find mispriced
players" from "draft scarce positions earlier", and it fails in the wrong
direction. Same-position concordance is 0.5097 — chance.

The cross-position result is roster arithmetic, not inefficiency:

| position | mean edge | mean residual |
|---|---|---|
| K | 45.03 | +0.3669 |
| DEF | 39.33 | +0.2756 |
| **QB** | **−0.37** | **+1.1550** |

Quarterbacks have the **lowest** edge and by far the **highest** outperformance —
the exact opposite of the mechanism's prediction.

And the arbitrage step earns nothing: `trueValue` alone correlates 0.0628 with
beating draft cost versus 0.0579 for `trueValue − perceivedValue`. **Subtracting
the consensus rank — the entire named mechanism — makes it slightly worse.**

A third closed-form/design mismatch was disclosed here too: D3's
minimum-detectable-correlation contradicts H1's bootstrap, and D3 is the wrong
one (it assumes independent observations while being fed a cluster count).

## Product consequence — the §3 rule applied where §3 did not reach

Playoff percentages were already presented as scenarios. **Draft and waiver
rankings are presented as advice**, which makes an unsupported claim there worse.
Three UI assertions were refuted by protocol 3 and have been corrected:

| was | now |
|---|---|
| "Find edges. Exploit inefficiencies." | "Positional scarcity and market context." |
| "ARBITRAGE PLAYS — \|edge\| ≥ 8" | "LARGEST SCARCITY GAPS — \|gap\| ≥ 8" |
| "Arbitrage Opps" / "High-edge plays" | "Large Gaps" / "Scarcity gaps, not proven bargains" |
| "Edge" column | "Scarcity gap" |

The KPI also no longer turns green on a high count — highlighting "more
opportunities" was the interface asserting the very claim the data refutes.

`EdgeDisclosureNotice` renders on first paint in Market Intelligence and Waiver
Wire. Wording is single-source in `src/lib/models/edgeDisclosure.ts`;
`edgeDisclosure.test.ts` (13 tests) forbids the refuted phrasing returning, and
e2e asserts both that the notice is visible without interaction and that no route
says arbitrage/exploit/mispriced.

**Not claimed:** that the rankings are worse than nothing. `perceivedValue` is
consensus ECR, a strong baseline this test does not knock down. What is shown is
that RAE's adjustment on top of consensus does not add value, and within position
subtracts some.

## Retracted lead — the QB result was my own artifact

An earlier version of this ledger called the +1.16 sd quarterback residual a
promising lead. **It is retracted.** Measured directly, QBs have a mean raw
within-league points z-score of **+0.7551** — they simply score more than other
positions. Protocol 3 fits the expected-cost curve **position-blind**, so any
high-scoring position shows a positive residual mechanically. The residual
ordering by position tracks the raw-points ordering almost exactly.

This deepens rather than softens the verdict: H1 and H3 are confounded by
positional scoring level, so **H2 — which holds position fixed — is the only
clean test in protocol 3, and it failed in the inverted direction.**

Concrete lesson for any successor protocol: fit the cost curve **within
position**, or carry position as a covariate. A position-blind baseline cannot
support a cross-position claim.

---

# Protocol 4 — the first signal that passed

Frozen `0cd6c2d` before any metric existed; harness frozen `8816b69`; executed
once at `2e88a22`. Protocol: [holdout-protocol-4.md](./holdout-protocol-4.md).
Result: [holdout-result-4.md](./holdout-result-4.md).

## Why this question

Protocols 1–3 kept failing for one reason, and it was structural rather than a
tuning problem: **every predictor in RAE's valuation is a monotone function of
consensus rank.** A model assembled from the market's own opinion is the market.
That single fact explains protocol 1, protocol 2's D3 losing to the base rate
even when fitted directly to the answer, and protocol 3's inverted within-position
result all at once.

The only escape is information consensus has not priced. RAE collects exactly one
such signal and had never used it in valuation: **nflverse opportunity**. It is
independent of ADP structurally — ADP freezes at the draft, usage updates weekly.

## What was tested

Does usage through week 8 predict weeks 9–17 **beyond what points already scored
through week 8 predict**? The baseline is production to date, not a stale ADP,
because a week-9 waiver decision has eight weeks of results available and
choosing the weaker opponent would have been rigging the test.

nflverse 2021–2024 (CC-BY), RB/WR/TE, **958 player-seasons over 452 distinct
players** — roughly ten times protocol 3's 43 clusters.

| id | hypothesis | statistic | 95% CI | Holm |
|---|---|---|---|---|
| H1 | usage adds over production | **0.2289** | [0.1636, 0.2943] | reject null |
| H2 | the same test **within position** | **0.2259** | [0.1652, 0.2884] | reject null |
| H3 | higher usage wins at matched production | **0.5749** | [0.5496, 0.5948] | reject null |

All three cleared Holm correction, which protocol 4 §6 declared in advance as the
success criterion.

**H2 is the load-bearing row.** Protocol 3's retracted quarterback finding was
manufactured by a position-blind baseline, so protocol 4 standardised features
within (season, position) and re-tested the entire claim within position. The
estimate did not move — 0.2259 against a pooled 0.2289. That is the signature of
an effect that is not positional composition.

## The four limits, stated with the finding rather than beneath it

1. **The gain is modest.** Out of fold, points-to-date alone reaches Spearman
   0.7342; adding usage reaches 0.7479 — **+0.0137**. Significant is not large,
   and the confirmatory table read alone would oversell it.
2. **p < 0.0002 is the bootstrap floor** (1/5001; zero of 5000 resamples fell at
   or below the null), not a vanishingly small number.
3. **Part of it is mechanical.** In PPR a reception is itself a point, so this is
   partly volume persisting rather than latent talent being uncovered. Still
   useful for a start/sit or waiver call; not a claim about hidden skill.
4. **In-season only.** Nothing here licenses a pre-season draft change, where no
   usage exists by definition. Protocols 1–3 tested that regime and it failed.
   Both results stand; they concern different regimes.

## What shipped, and what deliberately did not

**Shipped:** opportunity now carries a validation state, which CLAUDE.md requires
and it previously lacked entirely. `OpportunityEvidenceNotice` renders on the
waiver panel on first paint, in a green variant so a reader pattern-matching on
"red box = warning" does not misread a positive result. It never shows the
headline alone: the copy carries the real magnitude (0.734 → 0.748, described as
small) and the scope limit as body text, not a footnote. Six e2e tests assert the
limits travel with the claim, because for a result that PASSED the failure mode
is an overstated headline rather than a buried warning.

**Deliberately not shipped: any weight change.** Protocol 4 §8 forbids tuning a
weight on this data and forbids shipping on a diagnostic alone, so the D1
regression coefficients were not read off into the waiver formula. The existing
weight stands; what changed is that it is now evidenced rather than asserted.
Setting a better weight requires protocol 5 with its own held-out split.

`opportunityValidation()` also keeps `out-of-scope-preseason` distinct from
unavailable — "we have no data" and "we tested this and the answer does not apply
here" are different claims, and the pre-season waiver note now makes the second.

---

# Security — a green check that was not coverage

Reading the gitleaks job **log** rather than its check mark showed it reported
success while scanning only the pushed commit range: **"29 commits scanned"** in
a repository of 299. A secret committed before the current branch could never
fail it, so that green mark was evidence about the diff, not the repository.

Added `gitleaks FULL-HISTORY secret scan` to `security.yml`, which walks all
history and honours `.gitleaksignore`, so the thirteen adjudicated findings stay
suppressed by exact fingerprint while any new finding — including one in an old
commit — fails.

**Verified by log, not by check mark:** `275 commits scanned`, 5.52 MB,
`no leaks found`.

A history scan confirmed no production credential is committed anywhere: the only
matches are localhost `rae_test` Postgres URLs for ephemeral CI service
containers, and placeholder values in `.env.example`. `.env` has never been
committed (0 commits touch it).

[`docs/runbooks/secret-rotation.md`](../../docs/runbooks/secret-rotation.md)
covers all four secrets. Its central point is that they are **not** alike:
`AUTH_SECRET`, `DB_INIT_TOKEN` and `CRON_SECRET` are authenticators and cost only
a redeploy, while `CREDENTIAL_ENCRYPTION_KEY` is a single unversioned AES-256-GCM
key with no key id in the payload and no dual-read path — **rotating it makes
every stored ESPN credential permanently undecryptable.** Re-encryption must come
first, and RAE has no re-encryption command today, so writing one is the
prerequisite rather than an optional extra.

The runbook also insists on the two steps usually skipped: verify the **old**
value is now **rejected** (confirming the new one works proves only that it was
accepted), and burn the old plaintext by SHA-256 into `BURNED_SECRET_HASHES`.

**Still `BLOCKED`, and still not claimed as done:** the actual rotation. CI proves
the repository is clean; it cannot prove a live credential was invalidated,
because that happens in a secret store this session has no authorized access to.
Fresh 256-bit values were generated and handed to the operator directly and were
written to no file, no commit, and no report — including this one.

---

# §11 rotation — attested 2026-08-22

The repository owner reports rotating **`DB_INIT_TOKEN`** in Vercel. That closes
the operator action §11 was blocked on.

**Scope, stated precisely.** `DB_INIT_TOKEN` only. `CREDENTIAL_ENCRYPTION_KEY`
was deliberately **not** rotated — the correct call, since it would have
destroyed every stored ESPN credential. `AUTH_SECRET` and `CRON_SECRET` are not
reported as rotated and are treated as unrotated. Writing "the secrets were
rotated" would have overstated what happened.

**Recorded as attested, not verified.** This session has no authorized access to
the secret store, so it cannot observe the change and does not claim to. The
distinction is the point: a green CI run proves the *repository* is clean and
says nothing about whether a live credential was invalidated.

What would upgrade attested to verified is one command, now shipping in this
branch as `npm run verify:rotation`:

```bash
RAE_VERIFY_BASE_URL=https://<your-app>.vercel.app \
  OLD_DB_INIT_TOKEN=... OLD_CRON_SECRET=... npm run verify:rotation
```

It replays the **previous** credentials against `POST /api/admin/init-db` and
`GET /api/cron/lifecycle-check` and requires a 401/403. That is the only direct
evidence a rotation took effect — confirming the new value works proves only that
it was accepted, which is a weaker claim than most rotation checklists admit.

Design constraints, because a verification tool that leaks the credential it is
checking would be worse than no tool:

- secrets are read from the **environment only** — never argv, which lands in
  shell history and process listings — and are never printed, not even truncated;
- it **refuses plaintext http**, since sending a retiring credential in the clear
  would leak the very value being retired;
- supplying no `OLD_*` value exits **2**, not 0 — an absent check is not a pass;
- the default run only sends credentials the server should reject, so it mutates
  nothing. `--check-new` covers the cron route alone; `init-db` applies DDL, and
  a production database mutation is a deliberate decision rather than a side
  effect of verifying.

Only the owner can run it, because only the owner holds the previous values.

---

# RESOLVED — the product name asserted the refuted claim

**Raised 2026-08-22, and RESOLVED the same day by the owner choosing option 2.**
The section below is kept as written, in the present tense it was raised in, so
the reasoning that led to the decision stays legible. The outcome is recorded
immediately after it.

Protocol 3 tested the reputation edge on 115 real drafts and found it does not
identify mispriced players; within position it was inverted. This audit therefore
removed the arbitrage language from panel copy, replaced the headline with
"Positional scarcity — not a market edge", and added an e2e guard so the refuted
phrasing cannot return.

**The product is still called the Reputation Arbitrage Engine**, and that
tagline renders on every page:

| location | text |
|---|---|
| `src/app/layout.tsx:36` | browser title, `RAE — Reputation Arbitrage Engine` |
| `src/components/shell/TopCommandBar.tsx:33` | sticky header, all app routes |
| `src/components/shell/RouteSidebar.tsx:51` | sidebar, all app routes |
| `src/components/Onboarding.tsx:15` | the first thing a new user reads |

So the strongest claim RAE makes about itself is the one its own holdout refuted,
and it is made in the largest type on the page.

The e2e guard does not catch this. Its banned pattern is
`(arbitrage play|exploit inefficien|mispriced)` — narrow enough that the product
name passes. That narrowness was never written down as a decision, which is why
it is being written down now: the guard protects panel copy and was never
intended to adjudicate the product's name.

**Why this was not fixed here.** Renaming a product is a branding decision with
consequences well outside an audit's remit — repository name, deployment, any
existing users' expectations. Changing it unilaterally would be exactly the kind
of scope expansion this audit has otherwise refused. It is recorded as an open
decision for the owner rather than quietly actioned or quietly ignored.

**The options, with the honest trade-off:**

1. **Keep the name, treat it as a proper noun.** Defensible — "RAE" is what the
   product is called, and the panels no longer make the claim. The cost is that
   a first-time reader meets the claim on the onboarding screen before ever
   seeing the disclosure.
2. **Keep RAE, retire the expansion.** Drop "Reputation Arbitrage Engine" and let
   the initialism stand alone, or re-expand it to something the evidence
   supports. Cheapest change that removes the assertion; four call sites.
3. **Rename outright.** Highest cost, and only worth it if the name is not yet
   load-bearing anywhere external.

Option 2 is the smallest change that stops the product asserting a refuted
finding, and it does not touch the repository name or any URL.

---

# RESOLVED 2026-08-22 — the product was renamed, and a dead guard was found doing it

## The rename

**RAE — Reputation Arbitrage Engine → RAE — Roster Analytics Engine.**

Owner decision, taken after the open item above was raised. The initialism is
unchanged, so no repository name, URL, or deployment target moves; what goes is
the expansion that asserted a claim protocol 3 refuted.

Changed on the product surface — browser title, sticky header, route sidebar,
onboarding screen, README, banner SVG, and the `package.json` name (private, so
the rename is free). Historical audit reports under `reports/audit-2026-06-09/`
were **left alone**: they are dated records of what the product was called then,
and editing them would be rewriting history to look better.

## The guard that was never working

Widening the wording guard to cover the bare word revealed that **the guard had
never worked at all**.

```
    const banned = /<0x08>(arbitrage play|exploit inefficien|mispriced)/i;
```

That leading byte is a literal **backspace** (0x08), not the two characters
`\` and `b`. The regex therefore required a backspace character immediately
before the word, which no rendered page contains — so `not.toMatch(banned)`
passed unconditionally. **The test asserted nothing from the moment it was
written**, in commit `5fe271e`, the very commit whose message was "stop claiming
arbitrage the product cannot demonstrate."

This is the failure mode the audit exists to catch: a green check that is
evidence of nothing. It is exactly the same shape as the gitleaks job that
passed while scanning 29 commits of 299, and it was found the same way — by
looking at what the check actually did rather than at its result.

**What the repaired guard immediately caught**, which the dead one had let
through for its entire life: `/analytics` still had a **tab labelled
"Arbitrage"**. The earlier remediation replaced the KPI labels and the eyebrow
copy but missed the tab, and nothing failed. It is now `EDGE_LABELS.gapsTab` =
"Scarcity Gaps", single-sourced with the other honest replacements, and the
internal `arbitrageCount` is renamed `largeGapCount`.

**Repairs made to the guard itself:**

- the regex is byte-clean, and every tracked `.ts`/`.tsx` file was scanned for
  stray control bytes (0x07, 0x08, 0x0b, 0x0c) — **zero found elsewhere**;
- it now asserts **on itself** — `expect("Arbitrage Opps").toMatch(banned)` — so
  a future dead regex fails loudly instead of passing silently;
- coverage widened from four routes to seven plus the onboarding screen, which
  is where the product name was most prominent and which the guard had never
  visited;
- disclosure blocks are excluded from the scan, and only those. Their job is to
  name the refuted claim in order to deny it — "does not identify mispriced
  players" needs the word to say anything — so banning it there would force the
  retraction to be vaguer than the claim it retracts.
