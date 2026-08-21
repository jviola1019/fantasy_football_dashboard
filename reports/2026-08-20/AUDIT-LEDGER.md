# Audit 2026-08-20 — remediation ledger

**Repository** `jviola1019/fantasy_football_dashboard` ·
**Product** RAE — Reputation Arbitrage Engine

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
| — | — | `/analytics` overflows horizontally at 320px | `OPEN (pre-existing)` | `scrollWidth` 372 vs 320, **identical on the pre-change tree**; culprits are the top bar, tab strip and a data table — none touched by this work |

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
